import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Media } from '../providers/types.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type WebhookStatus = 'pending' | 'delivered' | 'failed';

export interface JobError {
  status: number;
  code: string;
  detail: string;
}

export interface Job {
  id: string;
  accountId: string;
  keyId: string;
  url: string;
  platform: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** How many times a worker picked it up (crash recovery re-queues it). */
  runs: number;
  result?: Media;
  error?: JobError;
  webhook?: {
    url: string;
    status: WebhookStatus;
    attempts: number;
    nextAttemptAt?: string;
    lastError?: string;
  };
}

const QUEUE = 'jobs:queue';
const PROCESSING = 'jobs:processing';
const WEBHOOKS = 'jobs:webhooks';

/**
 * Job persistence on Redis (jobs are ephemeral: they expire after `ttlSeconds`).
 *
 * The queue is a reliable one: a worker atomically moves an id from `queue` to `processing`
 * (LMOVE) and removes it only when done, so a crashed worker's jobs can be found and
 * re-queued by the sweeper. Webhook retries live in a sorted set keyed by due time.
 */
export class JobStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  newId(): string {
    return `job_${randomUUID().replace(/-/g, '')}`;
  }

  async save(job: Job): Promise<void> {
    await this.redis.set(`job:${job.id}`, JSON.stringify(job), 'EX', this.ttlSeconds);
  }

  async get(id: string): Promise<Job | null> {
    const raw = await this.redis.get(`job:${id}`);
    return raw ? (JSON.parse(raw) as Job) : null;
  }

  async update(id: string, mutate: (job: Job) => void): Promise<Job | null> {
    const job = await this.get(id);
    if (!job) return null;
    mutate(job);
    await this.save(job);
    return job;
  }

  // ---- idempotency & per-account backpressure --------------------------------

  /** Returns the existing job id for this key, or null after registering `jobId` for it. */
  async claimIdempotencyKey(accountId: string, key: string, jobId: string): Promise<string | null> {
    const k = `idem:${accountId}:${key}`;
    const ok = await this.redis.set(k, jobId, 'EX', this.ttlSeconds, 'NX');
    return ok === 'OK' ? null : await this.redis.get(k);
  }

  /** Reserve one of the account's pending-job slots. */
  async reserve(accountId: string, max: number): Promise<boolean> {
    const key = `jobs:pending:${accountId}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, this.ttlSeconds);
    if (n > max) {
      await this.redis.decr(key);
      return false;
    }
    return true;
  }

  async release(accountId: string): Promise<void> {
    const key = `jobs:pending:${accountId}`;
    if ((await this.redis.decr(key)) < 0) await this.redis.set(key, '0', 'EX', this.ttlSeconds);
  }

  // ---- queue ---------------------------------------------------------------------

  enqueue(id: string): Promise<number> {
    return this.redis.lpush(QUEUE, id);
  }

  /** Atomically take the oldest queued id and mark it as being processed. */
  claim(): Promise<string | null> {
    return this.redis.lmove(QUEUE, PROCESSING, 'RIGHT', 'LEFT');
  }

  ack(id: string): Promise<number> {
    return this.redis.lrem(PROCESSING, 1, id);
  }

  processingIds(): Promise<string[]> {
    return this.redis.lrange(PROCESSING, 0, -1);
  }

  /** Put a stuck job back at the front of the line. */
  async requeue(id: string): Promise<void> {
    await this.redis.lrem(PROCESSING, 1, id);
    await this.redis.rpush(QUEUE, id);
  }

  // ---- webhook retries ---------------------------------------------------------------

  scheduleWebhook(id: string, dueMs: number): Promise<number> {
    return this.redis.zadd(WEBHOOKS, dueMs, id);
  }

  /** Claim up to `limit` due deliveries; ZREM's return value makes the claim exclusive across workers. */
  async claimDueWebhooks(nowMs: number, limit = 5): Promise<string[]> {
    const due = await this.redis.zrangebyscore(WEBHOOKS, '-inf', nowMs, 'LIMIT', 0, limit);
    const mine: string[] = [];
    for (const id of due) if ((await this.redis.zrem(WEBHOOKS, id)) === 1) mine.push(id);
    return mine;
  }
}
