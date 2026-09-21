import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/http/app.js';
import type { Db } from '../src/infra/db.js';
import { JobStore } from '../src/jobs/jobStore.js';
import { verifyWebhook } from '../src/jobs/webhook.js';
import { ProviderError, type MediaDraft, type Provider } from '../src/providers/types.js';
import { ADMIN_TOKEN, freshInfra, hasInfra, testConfig } from './infra.js';

const tiktok = (id: string) => `https://www.tiktok.com/@u/video/${id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasInfra)('POST /v1/jobs (async extraction, signed webhooks)', () => {
  let db: Db;
  let redis: Redis;
  let built: BuiltApp;
  let app: FastifyInstance;
  let receiver: Server;
  let receiverUrl: string;
  let key: string;
  let accountId: string;
  const deliveries: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  let receiverStatuses: number[] = []; // consumed one per delivery; empty => 200

  const provider: Provider = {
    id: 'fake-async',
    platform: 'tiktok',
    priority: 1,
    async fetch({ url }): Promise<MediaDraft> {
      const id = url.pathname.split('/').pop();
      if (id === '2') throw new ProviderError('unavailable', 'private');
      if (id === '4') await sleep(700); // slow job
      return { title: `clip ${id}`, author: null, thumbnail: null, durationSeconds: 1, variants: [{ kind: 'video', url: 'https://cdn.example/v.mp4', hasAudio: true }] };
    },
  };

  const auth = (k = key) => ({ authorization: `Bearer ${k}` });
  const submit = (url: string, extra: { webhookUrl?: string; idem?: string; k?: string; a?: FastifyInstance } = {}) =>
    (extra.a ?? app).inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { ...auth(extra.k), ...(extra.idem ? { 'idempotency-key': extra.idem } : {}) },
      payload: { url, ...(extra.webhookUrl ? { webhookUrl: extra.webhookUrl } : {}) },
    });
  const getJob = (id: string, k = key) => app.inject({ method: 'GET', url: `/v1/jobs/${id}`, headers: auth(k) });

  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await sleep(50);
    }
  }
  const finished = (id: string, k = key) =>
    until(async () => (await getJob(id, k)).json().data, (j) => j.status === 'succeeded' || j.status === 'failed');

  async function newAccount(name: string) {
    const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const acc = (await app.inject({ method: 'POST', url: '/admin/v1/accounts', headers, payload: { name, planId: 'enterprise' } })).json().data.id as string;
    const k = (await app.inject({ method: 'POST', url: `/admin/v1/accounts/${acc}/keys`, headers, payload: { label: 'k' } })).json().data.key as string;
    return { acc, k };
  }

  beforeAll(async () => {
    ({ db, redis } = await freshInfra());
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        deliveries.push({ headers: req.headers, body });
        res.writeHead(receiverStatuses.shift() ?? 200).end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    built = await buildApp({
      config: testConfig({ JOBS_ENABLED: 'true', JOBS_WEBHOOK_BACKOFF_MS: '0,100,200', DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'true', JOBS_MAX_PENDING_PER_ACCOUNT: '50', JOBS_CONCURRENCY: '4' }),
      db,
      redis,
      providers: [provider],
    });
    app = built.app;
    await app.ready();
    ({ acc: accountId, k: key } = await newAccount('jobs'));
  });

  afterAll(async () => {
    await built.usage.stop();
    await app.close();
    receiver.closeAllConnections();
    await new Promise((r) => receiver.close(r));
    await db.end();
    redis.disconnect();
  });

  it('accepts a job instantly (202 + Location) and completes it in the background', async () => {
    const res = await submit(tiktok('1'));
    expect(res.statusCode).toBe(202);
    const job = res.json().data;
    expect(job).toMatchObject({ status: 'queued', platform: 'tiktok' });
    expect(job.id).toMatch(/^job_[a-f0-9]{32}$/);
    expect(res.headers.location).toBe(`/v1/jobs/${job.id}`);
    expect(job.accountId).toBeUndefined(); // internal ids never leak

    const done = await finished(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({ platform: 'tiktok', provider: 'fake-async', title: 'clip 1' });
    expect(done.startedAt && done.finishedAt).toBeTruthy();
  });

  it('turns provider failures into a failed job with a stable error code', async () => {
    const id = (await submit(tiktok('2'))).json().data.id;
    const done = await finished(id);
    expect(done.status).toBe('failed');
    expect(done.error).toMatchObject({ status: 422, code: 'content_unavailable' });
    expect(done.result).toBeUndefined();
  });

  it('rejects bad input synchronously, before queueing anything', async () => {
    expect((await submit('https://example.com/x')).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/v1/jobs', headers: auth(), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/jobs' })).statusCode).toBe(401);
    expect((await getJob('not-a-job')).statusCode).toBe(400);
  });

  it('is idempotent with an Idempotency-Key', async () => {
    const a = await submit(tiktok('1'), { idem: 'order-42' });
    const b = await submit(tiktok('1'), { idem: 'order-42' });
    const c = await submit(tiktok('1'), { idem: 'order-43' });
    expect(b.json().data.id).toBe(a.json().data.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(c.json().data.id).not.toBe(a.json().data.id);
  });

  it("never shows one account's job to another", async () => {
    const id = (await submit(tiktok('1'))).json().data.id;
    const other = await newAccount('intruder');
    const res = await getJob(id, other.k);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('delivers a SIGNED webhook, retrying with backoff until the receiver accepts', async () => {
    deliveries.length = 0;
    receiverStatuses = [500, 200];
    const id = (await submit(tiktok('1'), { webhookUrl: receiverUrl })).json().data.id;
    const job = await until(async () => (await getJob(id)).json().data, (j) => j.webhook?.status === 'delivered');

    expect(job.webhook).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(deliveries).toHaveLength(2);

    const secret = (await app.inject({ method: 'GET', url: '/v1/account', headers: auth() })).json().data.webhookSecret as string;
    for (const d of deliveries) {
      expect(verifyWebhook(secret, String(d.headers['x-nah-signature']), d.body)).toBe(true);
      expect(d.headers['x-nah-event']).toBe('job.completed');
      const payload = JSON.parse(d.body);
      expect(payload).toMatchObject({ event: 'job.completed', data: { id, status: 'succeeded', result: { title: 'clip 1' } } });
      expect(payload.data.accountId).toBeUndefined();
    }
    expect(new Set(deliveries.map((d) => d.headers['x-nah-delivery'])).size).toBe(2); // distinct per attempt
    // a receiver that doesn't know the secret cannot forge one
    expect(verifyWebhook('wrong'.repeat(13), String(deliveries[0]!.headers['x-nah-signature']), deliveries[0]!.body)).toBe(false);
  });

  it('gives up after the configured attempts and reports why', async () => {
    deliveries.length = 0;
    receiverStatuses = [500, 500, 500, 500];
    const id = (await submit(tiktok('1'), { webhookUrl: receiverUrl })).json().data.id;
    const job = await until(async () => (await getJob(id)).json().data, (j) => j.webhook?.status === 'failed');
    expect(job.webhook).toMatchObject({ status: 'failed', attempts: 3, lastError: 'receiver answered HTTP 500' });
    expect(deliveries).toHaveLength(3);
    expect(job.status).toBe('succeeded'); // the job itself is unaffected by a dead receiver
  });

  it('also notifies on failure', async () => {
    deliveries.length = 0;
    receiverStatuses = [];
    const id = (await submit(tiktok('2'), { webhookUrl: receiverUrl })).json().data.id;
    await until(async () => (await getJob(id)).json().data, (j) => j.webhook?.status === 'delivered');
    expect(JSON.parse(deliveries[0]!.body)).toMatchObject({ event: 'job.failed', data: { error: { code: 'content_unavailable' } } });
    expect(deliveries[0]!.headers['x-nah-event']).toBe('job.failed');
  });

  it('refuses webhook targets on private networks (SSRF), at submission', async () => {
    const strict = await buildApp({
      config: testConfig({ JOBS_ENABLED: 'true', DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'false' }),
      db,
      redis,
      providers: [provider],
    });
    for (const target of ['http://127.0.0.1:9/x', 'http://169.254.169.254/latest', 'http://localhost/x']) {
      const res = await submit(tiktok('1'), { webhookUrl: target, a: strict.app });
      expect(res.statusCode, target).toBe(422);
      expect(res.json().code).toBe('blocked_url');
    }
    await strict.usage.stop();
    await strict.app.close();
  });

  it('caps pending jobs per account (429 + Retry-After) and frees slots as jobs finish', async () => {
    const capped = await buildApp({
      config: testConfig({ JOBS_ENABLED: 'true', JOBS_MAX_PENDING_PER_ACCOUNT: '3', DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'true' }),
      db,
      redis,
      providers: [provider],
    });
    const { k } = await newAccount('busy');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await submit(tiktok('4'), { k, a: capped.app })).json().data.id);
    const over = await submit(tiktok('4'), { k, a: capped.app });
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe('too_many_jobs');
    expect(over.headers['retry-after']).toBeTruthy();
    for (const id of ids) expect((await finished(id, k)).status).toBe('succeeded');
    expect((await submit(tiktok('1'), { k, a: capped.app })).statusCode).toBe(202);
    await capped.usage.stop();
    await capped.app.close();
  });

  it('recovers jobs orphaned by a crashed worker, and gives up on ones that keep dying', async () => {
    const store = new JobStore(redis, 300);
    const orphan = async (runs: number) => {
      const id = store.newId();
      await store.save({
        id, accountId, keyId: 'k', url: tiktok('1'), platform: 'tiktok', status: 'running', runs,
        createdAt: new Date().toISOString(), startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      });
      await redis.lpush('jobs:processing', id); // as if a worker had claimed it and then died
      await redis.incr(`jobs:pending:${accountId}`);
      return id;
    };

    const recoverable = await orphan(1);
    const doomed = await orphan(3);
    await built.jobs!.sweep();
    expect((await finished(recoverable)).status).toBe('succeeded'); // re-queued, then processed
    const dead = await finished(doomed);
    expect(dead).toMatchObject({ status: 'failed', error: { code: 'job_stalled' } });
    expect(await redis.lrange('jobs:processing', 0, -1)).not.toContain(recoverable);
  });

  it('a job that is legitimately still running is left alone by the sweeper', async () => {
    const store = new JobStore(redis, 300);
    const id = store.newId();
    await store.save({ id, accountId, keyId: 'k', url: tiktok('1'), platform: 'tiktok', status: 'running', runs: 1, createdAt: new Date().toISOString(), startedAt: new Date().toISOString() });
    await redis.lpush('jobs:processing', id);
    await built.jobs!.sweep();
    expect((await store.get(id))!.status).toBe('running');
    expect(await redis.lrange('jobs:queue', 0, -1)).not.toContain(id);
    await redis.lrem('jobs:processing', 1, id);
  });

  it('exposes the webhook secret to the account and lets an operator rotate it', async () => {
    const before = (await app.inject({ method: 'GET', url: '/v1/account', headers: auth() })).json().data;
    expect(before).toMatchObject({ plan: 'enterprise', webhookSecret: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const rotated = await app.inject({ method: 'POST', url: `/admin/v1/accounts/${accountId}/webhook-secret/rotate`, headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    expect(rotated.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/v1/account', headers: auth() })).json().data;
    expect(after.webhookSecret).not.toBe(before.webhookSecret);
  });
});
