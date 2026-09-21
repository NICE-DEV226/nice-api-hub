import type { Db } from '../infra/db.js';
import type { Metrics } from '../metrics.js';

export interface UsageEvent {
  accountId: string;
  keyId: string;
  platform: string;
  /** Provider/server-side failure (5xx), as opposed to a client error. */
  error: boolean;
  cacheHit: boolean;
  rateLimited: boolean;
}

interface Counters {
  requests: number;
  errors: number;
  cacheHits: number;
  rateLimited: number;
}

interface Logger {
  error(obj: object, msg?: string): void;
}

const MAX_BUFFER_ENTRIES = 50_000;

/**
 * Usage metering off the hot path. Events are aggregated in memory (one counter row
 * per account/day/platform) and written in a single batched UPSERT every few seconds.
 * A request costs a few map increments instead of a database round trip.
 *
 * Trade-off: a hard crash loses at most one flush interval of counters. Billing-grade
 * exactness is not the goal here; quota enforcement itself lives in Redis.
 */
export class UsageMeter {
  private buffer = new Map<string, Counters & { accountId: string; day: string; platform: string }>();
  private lastUsed = new Map<string, Date>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly metrics: Metrics,
    private readonly logger: Logger,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
  }

  record(event: UsageEvent, now = new Date()): void {
    const day = now.toISOString().slice(0, 10);
    const key = `${event.accountId}|${day}|${event.platform}`;
    let entry = this.buffer.get(key);
    if (!entry) {
      if (this.buffer.size >= MAX_BUFFER_ENTRIES) return; // shed metering, never memory
      entry = {
        accountId: event.accountId,
        day,
        platform: event.platform,
        requests: 0,
        errors: 0,
        cacheHits: 0,
        rateLimited: 0,
      };
      this.buffer.set(key, entry);
    }
    entry.requests++;
    if (event.error) entry.errors++;
    if (event.cacheHit) entry.cacheHits++;
    if (event.rateLimited) entry.rateLimited++;
    this.lastUsed.set(event.keyId, now);
    this.metrics.usageBuffered.set(this.buffer.size);
  }

  /** Flush now. Concurrent calls share one flush. Failed batches are merged back and retried. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.size === 0 && this.lastUsed.size === 0) return;
    const batch = this.buffer;
    const used = this.lastUsed;
    this.buffer = new Map();
    this.lastUsed = new Map();
    this.metrics.usageBuffered.set(0);

    try {
      const rows = [...batch.values()];
      if (rows.length > 0) {
        await this.db.query(
          `INSERT INTO usage_daily (account_id, day, platform, requests, errors, cache_hits, rate_limited)
           SELECT * FROM unnest($1::uuid[], $2::date[], $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])
           ON CONFLICT (account_id, day, platform) DO UPDATE SET
             requests     = usage_daily.requests     + EXCLUDED.requests,
             errors       = usage_daily.errors       + EXCLUDED.errors,
             cache_hits   = usage_daily.cache_hits   + EXCLUDED.cache_hits,
             rate_limited = usage_daily.rate_limited + EXCLUDED.rate_limited`,
          [
            rows.map((r) => r.accountId),
            rows.map((r) => r.day),
            rows.map((r) => r.platform),
            rows.map((r) => r.requests),
            rows.map((r) => r.errors),
            rows.map((r) => r.cacheHits),
            rows.map((r) => r.rateLimited),
          ],
        );
      }
      if (used.size > 0) {
        await this.db.query(
          `UPDATE api_keys k SET last_used_at = v.ts
             FROM unnest($1::uuid[], $2::timestamptz[]) AS v(id, ts)
            WHERE k.id = v.id AND (k.last_used_at IS NULL OR k.last_used_at < v.ts)`,
          [[...used.keys()], [...used.values()]],
        );
      }
    } catch (error) {
      this.metrics.usageFlushErrors.inc();
      this.logger.error({ err: (error as Error).message }, 'usage flush failed; will retry');
      this.merge(batch, used);
    }
  }

  private merge(batch: typeof this.buffer, used: Map<string, Date>): void {
    for (const [key, add] of batch) {
      const existing = this.buffer.get(key);
      if (existing) {
        existing.requests += add.requests;
        existing.errors += add.errors;
        existing.cacheHits += add.cacheHits;
        existing.rateLimited += add.rateLimited;
      } else if (this.buffer.size < MAX_BUFFER_ENTRIES) {
        this.buffer.set(key, add);
      }
    }
    for (const [id, at] of used) {
      const current = this.lastUsed.get(id);
      if (!current || current < at) this.lastUsed.set(id, at);
    }
  }
}
