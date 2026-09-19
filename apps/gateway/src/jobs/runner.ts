import { AppError } from '../errors.js';
import type { Db } from '../infra/db.js';
import type { Metrics } from '../metrics.js';
import { resolveTarget } from '../providers/platforms.js';
import type { MediaService } from '../providers/mediaService.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { deliverWebhook } from './webhook.js';
import type { Job, JobError, JobStore } from './jobStore.js';

export interface RunnerOptions {
  concurrency: number;
  /** A job "running" longer than this is presumed orphaned by a crashed worker. */
  stallMs: number;
  maxRuns: number;
  /** Delay before each webhook attempt; its length is the maximum number of attempts. */
  webhookBackoffMs: number[];
  allowPrivateHosts: boolean;
  idleMs?: number;
  sweepEveryMs?: number;
}

interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** What customers see, in API responses and in webhook payloads. Never leaks internal ids. */
export function toPublicJob(job: Job) {
  return {
    id: job.id,
    status: job.status,
    url: job.url,
    platform: job.platform,
    createdAt: job.createdAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.webhook ? { webhook: job.webhook } : {}),
  };
}

function toJobError(error: unknown, logger: Logger): JobError {
  if (error instanceof AppError) return { status: error.status, code: error.code, detail: error.message };
  logger.error({ err: error }, 'job failed with an unexpected error');
  return { status: 500, code: 'internal_error', detail: 'An unexpected error occurred.' };
}

/**
 * In-process worker for asynchronous jobs. Any number of API replicas can run one: the queue
 * lives in Redis and claims are atomic. Delivery is at-least-once (a job whose worker died
 * is re-queued by the sweeper), so consumers should treat webhooks as idempotent.
 */
export class JobRunner {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private readonly active = new Set<Promise<void>>();

  constructor(
    private readonly deps: {
      store: JobStore;
      mediaService: MediaService;
      registry: ProviderRegistry;
      db: Db;
      logger: Logger;
      metrics: Metrics;
      options: RunnerOptions;
    },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    await Promise.allSettled([...this.active]);
  }

  private track(work: Promise<void>): void {
    const p: Promise<void> = work
      .catch((error) => this.deps.logger.error({ err: error }, 'job worker error'))
      .finally(() => this.active.delete(p));
    this.active.add(p);
  }

  private async loop(): Promise<void> {
    const { options, store, logger } = this.deps;
    let lastSweep = 0;
    while (this.running) {
      let worked = false;
      try {
        while (this.running && this.active.size < options.concurrency) {
          const id = await store.claim();
          if (!id) break;
          worked = true;
          this.track(this.processJob(id));
        }
        if (this.running && this.active.size < options.concurrency) {
          for (const id of await store.claimDueWebhooks(Date.now(), 5)) {
            worked = true;
            this.track(this.deliver(id));
          }
        }
        if (Date.now() - lastSweep >= (options.sweepEveryMs ?? 30_000)) {
          lastSweep = Date.now();
          await this.sweep();
        }
      } catch (error) {
        logger.error({ err: error }, 'job loop error (Redis unavailable?)');
      }
      if (!worked) await new Promise((r) => setTimeout(r, options.idleMs ?? 250));
    }
  }

  async processJob(id: string): Promise<void> {
    const { store, mediaService, registry, metrics } = this.deps;
    const job = await store.get(id);
    if (!job) return void (await store.ack(id)); // expired while queued
    if (job.status === 'succeeded' || job.status === 'failed') return void (await store.ack(id)); // duplicate claim

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.runs += 1;
    await store.save(job);

    try {
      const target = resolveTarget(job.url, registry.availablePlatforms());
      const { media } = await mediaService.resolve(target);
      job.status = 'succeeded';
      job.result = media;
      delete job.error;
    } catch (error) {
      job.status = 'failed';
      job.error = toJobError(error, this.deps.logger);
    }
    await this.finish(job);
    metrics.jobs.inc({ status: job.status });
  }

  /** Persist the outcome, free the account's slot, and queue the webhook if one was requested. */
  private async finish(job: Job): Promise<void> {
    const { store } = this.deps;
    job.finishedAt = new Date().toISOString();
    if (job.webhook) {
      job.webhook.status = 'pending';
      job.webhook.attempts = 0;
      job.webhook.nextAttemptAt = new Date().toISOString();
    }
    await store.save(job);
    if (job.webhook) await store.scheduleWebhook(job.id, Date.now());
    await store.ack(job.id);
    await store.release(job.accountId);
  }

  async deliver(id: string): Promise<void> {
    const { store, db, options } = this.deps;
    const job = await store.get(id);
    if (!job?.webhook || job.webhook.status === 'delivered') return;

    const { rows } = await db.query<{ webhook_secret: string }>('SELECT webhook_secret FROM accounts WHERE id = $1', [job.accountId]);
    const secret = rows[0]?.webhook_secret;
    if (!secret) {
      job.webhook.status = 'failed';
      job.webhook.lastError = 'account not found';
      return void (await store.save(job));
    }

    const event = job.status === 'succeeded' ? 'job.completed' : 'job.failed';
    const attempt = job.webhook.attempts + 1;
    const result = await deliverWebhook({
      url: job.webhook.url,
      secret,
      event,
      deliveryId: `${job.id}:${attempt}`,
      body: JSON.stringify({ event, data: toPublicJob(job) }),
      allowPrivateHosts: options.allowPrivateHosts,
    });

    job.webhook.attempts = attempt;
    if (result.ok) {
      job.webhook.status = 'delivered';
      delete job.webhook.nextAttemptAt;
      delete job.webhook.lastError;
    } else {
      job.webhook.lastError = result.error ?? 'unknown';
      const delay = options.webhookBackoffMs[attempt];
      if (delay === undefined || result.error === 'blocked_url') {
        job.webhook.status = 'failed'; // out of attempts, or the target is forbidden: retrying won't help
        delete job.webhook.nextAttemptAt;
      } else {
        job.webhook.nextAttemptAt = new Date(Date.now() + delay).toISOString();
        await store.scheduleWebhook(job.id, Date.now() + delay);
      }
    }
    this.deps.metrics.webhookDeliveries.inc({ outcome: result.ok ? 'ok' : 'error' });
    await store.save(job);
  }

  /** Recover jobs orphaned by a crashed worker (and clean up ids whose job has expired). */
  async sweep(nowMs = Date.now()): Promise<void> {
    const { store, options } = this.deps;
    for (const id of await store.processingIds()) {
      const job = await store.get(id);
      if (!job || job.status === 'succeeded' || job.status === 'failed') {
        await store.ack(id);
        continue;
      }
      const started = job.startedAt ? Date.parse(job.startedAt) : 0;
      if (job.status === 'running' && nowMs - started < options.stallMs) continue; // still legitimately running
      if (job.runs >= options.maxRuns) {
        job.status = 'failed';
        job.error = { status: 500, code: 'job_stalled', detail: 'The job did not complete after several attempts.' };
        await this.finish(job);
        this.deps.metrics.jobs.inc({ status: 'failed' });
      } else {
        job.status = 'queued';
        await store.save(job);
        await store.requeue(id);
        this.deps.logger.warn({ jobId: id, runs: job.runs }, 're-queued a stalled job');
      }
    }
  }
}
