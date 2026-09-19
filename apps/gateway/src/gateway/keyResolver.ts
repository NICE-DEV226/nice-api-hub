import type { Redis } from 'ioredis';
import type { Db } from '../infra/db.js';
import { errors } from '../errors.js';
import { hashApiKey, isWellFormedKey } from './keys.js';

/** Everything the hot path needs to know about a caller, cached as one JSON blob. */
export interface Principal {
  keyId: string;
  accountId: string;
  planId: string;
  limits: { rps: number; burst: number; dailyQuota: number | null };
  /** Effective platform allowlist (key ∩ plan). `null` means every platform. */
  platforms: string[] | null;
  expiresAt: string | null;
  revoked: boolean;
  accountActive: boolean;
}

interface KeyRow {
  key_id: string;
  account_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  key_platforms: string[] | null;
  account_status: string;
  plan_id: string;
  rps: string;
  burst: number;
  daily_quota: string | null;
  plan_platforms: string[] | null;
}

const CACHE_PREFIX = 'key:';
const NEGATIVE = 'null';

function intersect(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.filter((p) => b.includes(p));
}

/**
 * Resolves an API key to a `Principal`.
 *
 * Read path: Redis (60 s) → Postgres. Unknown keys are negatively cached for a short
 * time so a flood of random keys cannot turn into a flood of database queries.
 * Mutations call `invalidate()` so revocation takes effect immediately.
 */
export class KeyResolver {
  constructor(
    private readonly deps: {
      db: Db;
      redis: Redis;
      pepper: string;
      ttlSeconds?: number;
      negativeTtlSeconds?: number;
    },
  ) {}

  async authenticate(rawKey: string | null, now = new Date()): Promise<Principal> {
    if (!rawKey || !isWellFormedKey(rawKey)) throw errors.unauthorized();

    const hash = hashApiKey(rawKey, this.deps.pepper);
    const principal = await this.lookup(hash);
    if (!principal) throw errors.unauthorized('Invalid API key.');

    if (principal.revoked) throw errors.unauthorized('This API key has been revoked.');
    if (principal.expiresAt && new Date(principal.expiresAt) <= now) {
      throw errors.unauthorized('This API key has expired.');
    }
    if (!principal.accountActive) {
      throw errors.forbidden('account_suspended', 'This account is suspended.');
    }
    return principal;
  }

  async invalidate(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.deps.redis.del(...hashes.map((h) => CACHE_PREFIX + h)).catch(() => {});
  }

  private async lookup(hash: string): Promise<Principal | null> {
    const cacheKey = CACHE_PREFIX + hash;
    try {
      const cached = await this.deps.redis.get(cacheKey);
      if (cached !== null) return cached === NEGATIVE ? null : (JSON.parse(cached) as Principal);
    } catch {
      // Redis unavailable: fall through to Postgres.
    }

    const principal = await this.loadFromDb(hash);
    try {
      if (principal) {
        await this.deps.redis.set(cacheKey, JSON.stringify(principal), 'EX', this.deps.ttlSeconds ?? 60);
      } else {
        await this.deps.redis.set(cacheKey, NEGATIVE, 'EX', this.deps.negativeTtlSeconds ?? 30);
      }
    } catch {
      // Best effort.
    }
    return principal;
  }

  private async loadFromDb(hash: string): Promise<Principal | null> {
    const { rows } = await this.deps.db.query<KeyRow>(
      `SELECT k.id AS key_id, k.account_id, k.expires_at, k.revoked_at,
              k.platforms AS key_platforms, a.status AS account_status,
              a.plan_id, p.rps::text AS rps, p.burst, p.daily_quota::text AS daily_quota,
              p.platforms AS plan_platforms
         FROM api_keys k
         JOIN accounts a ON a.id = k.account_id
         JOIN plans p ON p.id = a.plan_id
        WHERE k.key_hash = $1`,
      [hash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      keyId: row.key_id,
      accountId: row.account_id,
      planId: row.plan_id,
      limits: {
        rps: Number(row.rps),
        burst: row.burst,
        dailyQuota: row.daily_quota === null ? null : Number(row.daily_quota),
      },
      platforms: intersect(row.key_platforms, row.plan_platforms),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      revoked: row.revoked_at !== null,
      accountActive: row.account_status === 'active',
    };
  }
}
