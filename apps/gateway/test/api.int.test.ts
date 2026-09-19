import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/http/app.js';
import { createRedis } from '../src/infra/redis.js';
import type { Db } from '../src/infra/db.js';
import { draft, fails, fakeProvider } from './helpers.js';
import { ADMIN_TOKEN, freshInfra, hasInfra, testConfig } from './infra.js';

const TIKTOK = 'https://www.tiktok.com/@user/video/7300000000000000001';
const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe.skipIf(!hasInfra)('gateway API (Postgres + Redis, fake providers)', () => {
  let db: Db;
  let redis: Redis;
  let built: BuiltApp;
  let app: FastifyInstance;
  const tiktokPrimary = fakeProvider('tt-primary', 'tiktok', 1, fails('upstream'));
  const tiktokBackup = fakeProvider('tt-backup', 'tiktok', 2, async () => draft('from backup'));
  const youtube = fakeProvider('yt', 'youtube', 1, async () => {
    throw new (await import('../src/providers/types.js')).ProviderError('unavailable', 'private video');
  });

  const admin = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url: `/admin/v1${url}`, headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, ...(payload ? { payload: payload as object } : {}) });
  const call = (key: string | null, path: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: path, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers } });
  const media = (key: string | null, url = TIKTOK) => call(key, `/v1/media?url=${encodeURIComponent(url)}`);

  async function account(planId = 'enterprise', name = 'Test Co') {
    const res = await admin('POST', '/accounts', { name, planId });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  }
  async function issueKey(accountId: string, body: Record<string, unknown> = { label: 'k' }) {
    const res = await admin('POST', `/accounts/${accountId}/keys`, body);
    expect(res.statusCode).toBe(201);
    return { key: res.json().data.key as string, id: res.json().data.id as string };
  }

  beforeAll(async () => {
    ({ db, redis } = await freshInfra());
    built = await buildApp({
      config: testConfig(),
      db,
      redis,
      providers: [tiktokPrimary.provider, tiktokBackup.provider, youtube.provider],
    });
    app = built.app;
    await app.ready();
  });
  afterAll(async () => {
    await built.usage.stop();
    await app.close();
    await db.end();
    redis.disconnect();
  });

  describe('errors & plumbing', () => {
    it('answers unauthenticated calls with RFC 9457 problem+json and a request id', async () => {
      const res = await media(null);
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['www-authenticate']).toBe('Bearer');
      const body = res.json();
      expect(body).toMatchObject({ status: 401, code: 'unauthorized', type: 'urn:nice-api-hub:error:unauthorized' });
      expect(body.requestId).toBe(res.headers['x-request-id']);
    });

    it('never leaks stack traces or internals', async () => {
      const res = await media('nah_live_' + 'A'.repeat(32));
      expect(res.statusCode).toBe(401);
      expect(JSON.stringify(res.json())).not.toMatch(/stack|node_modules|\.ts:/);
    });

    it('honours a well-formed inbound X-Request-Id and rejects junk', async () => {
      const good = await call(null, '/healthz', { 'x-request-id': 'trace-abc-12345' });
      expect(good.headers['x-request-id']).toBe('trace-abc-12345');
      const bad = await call(null, '/healthz', { 'x-request-id': 'x\ny' });
      expect(bad.headers['x-request-id']).not.toBe('x\ny');
    });

    it('returns problem+json for unknown routes', async () => {
      const res = await call(null, '/nope');
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('exposes health, readiness, public platform status and OpenAPI', async () => {
      expect((await call(null, '/healthz')).json()).toEqual({ status: 'ok' });
      expect((await call(null, '/readyz')).json()).toMatchObject({ status: 'ready', checks: { postgres: true, redis: true } });
      const platforms = (await call(null, '/v1/platforms')).json().data;
      expect(platforms.map((p: any) => p.id).sort()).toEqual(['tiktok', 'youtube']);
      const spec = (await call(null, '/openapi.json')).json();
      expect(spec.paths['/v1/media']).toBeDefined();
      expect(spec.components.securitySchemes.apiKey.scheme).toBe('bearer');
      expect((await call(null, '/metrics')).body).toContain('http_requests_total');
    });
  });

  describe('management API', () => {
    it('requires the admin token and throttles guessing', async () => {
      expect((await app.inject({ method: 'GET', url: '/admin/v1/plans' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/admin/v1/plans', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
      let last = 0;
      for (let i = 0; i < 12; i++) {
        last = (await app.inject({ method: 'GET', url: '/admin/v1/plans', remoteAddress: '203.0.113.9', headers: { authorization: 'Bearer wrong' } })).statusCode;
      }
      expect(last).toBe(429);
    });

    it('validates input', async () => {
      expect((await admin('POST', '/accounts', { name: '', planId: 'free' })).statusCode).toBe(400);
      const unknownPlan = await admin('POST', '/accounts', { name: 'x', planId: 'nope' });
      expect(unknownPlan.statusCode).toBe(400);
      expect((await admin('GET', '/accounts/not-a-uuid')).statusCode).toBe(400);
      expect((await admin('GET', '/accounts/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    });

    it('shows a key once and stores only its hash', async () => {
      const acc = await account();
      const { key, id } = await issueKey(acc, { label: 'prod' });
      expect(key).toMatch(/^nah_live_[A-Za-z0-9_-]{32}$/);
      const stored = await db.query('SELECT key_hash, prefix FROM api_keys WHERE id = $1', [id]);
      expect(stored.rows[0].key_hash).not.toContain(key);
      expect(stored.rows[0].prefix).toBe(key.slice(0, 13));
      expect((await db.query('SELECT 1 FROM api_keys WHERE key_hash = $1', [key])).rowCount).toBe(0);
      const listed = JSON.stringify((await admin('GET', `/accounts/${acc}/keys`)).json());
      expect(listed).not.toContain(key);
    });

    it('enforces the plan key limit atomically', async () => {
      const acc = await account('free'); // max_keys = 2
      const results = await Promise.all([1, 2, 3, 4].map((i) => admin('POST', `/accounts/${acc}/keys`, { label: `k${i}` })));
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
      expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().code === 'key_limit_reached')).toBe(true);
    });

    it('writes an audit trail', async () => {
      const { rows } = await db.query("SELECT action FROM audit_log WHERE action LIKE 'key.%' OR action LIKE 'account.%'");
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('media endpoint', () => {
    it('resolves media with failover, rate-limit headers and caching', async () => {
      const { key } = await issueKey(await account());
      const first = await media(key);
      expect(first.statusCode).toBe(200);
      const body = first.json();
      expect(body.data).toMatchObject({ platform: 'tiktok', provider: 'tt-backup', title: 'from backup' });
      expect(body.data.variants[0]).toMatchObject({ kind: 'video', mime: 'video/mp4' });
      expect(body.meta).toMatchObject({ cached: false, requestId: first.headers['x-request-id'] });
      expect(first.headers['ratelimit-limit']).toBe('500');
      expect(Number(first.headers['ratelimit-remaining'])).toBeLessThan(500);

      const second = await media(key);
      expect(second.json().meta.cached).toBe(true);
      // Tracking params must not defeat the cache.
      const third = await media(key, TIKTOK + '?is_from_webapp=1&utm_source=x');
      expect(third.json().meta.cached).toBe(true);
    });

    it('validates the url parameter', async () => {
      const { key } = await issueKey(await account());
      const missing = await call(key, '/v1/media');
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ code: 'invalid_request' });
      expect(missing.json().issues[0].message).toBeTruthy();
      expect((await media(key, 'https://example.com/video')).json()).toMatchObject({ status: 422, code: 'unsupported_platform' });
      expect((await media(key, 'https://tiktok.com.evil.example/x')).statusCode).toBe(422);
      expect((await media(key, 'ftp://tiktok.com/x')).statusCode).toBe(400);
    });

    it('maps "content unavailable" to 422 without blaming the provider', async () => {
      const { key } = await issueKey(await account());
      const res = await media(key, YOUTUBE);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('content_unavailable');
    });

    it('supports X-API-Key as an alternative to Bearer', async () => {
      const { key } = await issueKey(await account());
      const res = await app.inject({ method: 'GET', url: `/v1/media?url=${encodeURIComponent(TIKTOK)}`, headers: { 'x-api-key': key } });
      expect(res.statusCode).toBe(200);
    });

    it('restricts platforms per key', async () => {
      const { key } = await issueKey(await account(), { label: 'yt-only', platforms: ['youtube'] });
      const res = await media(key, TIKTOK);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('platform_not_allowed');
    });
  });

  describe('quotas (regression: the v1 multi-key bypass)', () => {
    it('shares ONE daily quota across all keys of an account', async () => {
      await admin('PUT', '/plans/tiny', { name: 'Tiny', rps: 1000, burst: 1000, dailyQuota: 3, maxKeys: 10, platforms: null });
      const acc = await account('tiny');
      const keys = [await issueKey(acc, { label: 'a' }), await issueKey(acc, { label: 'b' }), await issueKey(acc, { label: 'c' })];

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await media(keys[i % 3]!.key)).statusCode);
      expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);

      const denied = await media(keys[0]!.key);
      expect(denied.json()).toMatchObject({ status: 429, code: 'quota_exceeded' });
      expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
      expect(denied.headers['x-quota-remaining']).toBe('0');
    });

    it('rate-limits bursts per account and recovers', async () => {
      await admin('PUT', '/plans/bursty', { name: 'Bursty', rps: 20, burst: 2, dailyQuota: null, maxKeys: 5, platforms: null });
      const { key } = await issueKey(await account('bursty'));
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await media(key)).statusCode);
      expect(codes.slice(0, 2)).toEqual([200, 200]);
      const limited = await media(key);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().code).toBe('rate_limited');
      await new Promise((r) => setTimeout(r, 150));
      expect((await media(key)).statusCode).toBe(200);
    });

    it('treats a null daily quota as unlimited, and 0 as zero (no silent coercion of JSON bodies)', async () => {
      const unlimited = await admin('PUT', '/plans/unl', { name: 'U', rps: 100, burst: 100, dailyQuota: null, maxKeys: 5, platforms: null });
      expect(unlimited.json().data).toMatchObject({ dailyQuota: null, platforms: null });
      const zero = await admin('PUT', '/plans/zero', { name: 'Z', rps: 100, burst: 100, dailyQuota: 0, maxKeys: 5, platforms: null });
      expect(zero.json().data.dailyQuota).toBe(0);
      const { key } = await issueKey(await account('unl'));
      expect((await media(key)).statusCode).toBe(200);
    });

    it('applies plan changes immediately (cache invalidation)', async () => {
      await admin('PUT', '/plans/one', { name: 'One', rps: 1000, burst: 1000, dailyQuota: 1, maxKeys: 5, platforms: null });
      const acc = await account('one');
      const { key } = await issueKey(acc);
      expect((await media(key)).statusCode).toBe(200);
      expect((await media(key)).statusCode).toBe(429);
      await admin('PATCH', `/accounts/${acc}`, { planId: 'enterprise' });
      expect((await media(key)).statusCode).toBe(200);
    });
  });

  describe('key lifecycle', () => {
    it('revocation takes effect immediately, despite the cache', async () => {
      const { key, id } = await issueKey(await account());
      expect((await media(key)).statusCode).toBe(200);
      expect((await admin('POST', `/keys/${id}/revoke`)).statusCode).toBe(200);
      const res = await media(key);
      expect(res.statusCode).toBe(401);
      expect(res.json().detail).toMatch(/revoked/);
    });

    it('rotation keeps the old key alive for the grace period only', async () => {
      const acc = await account();
      const { key: oldKey, id } = await issueKey(acc);
      const rotated = await admin('POST', `/keys/${id}/rotate`, { graceSeconds: 3600 });
      expect(rotated.statusCode).toBe(200);
      const newKey = rotated.json().data.key as string;
      expect(newKey).not.toBe(oldKey);
      expect((await media(oldKey)).statusCode).toBe(200);
      expect((await media(newKey)).statusCode).toBe(200);

      const { key: k2, id: id2 } = await issueKey(acc, { label: 'second' });
      await admin('POST', `/keys/${id2}/rotate`, { graceSeconds: 0 });
      expect((await media(k2)).statusCode).toBe(401);
    });

    it('rejects expired keys and suspended accounts, and restores on reactivation', async () => {
      const acc = await account();
      const expired = await issueKey(acc, { label: 'exp', expiresAt: new Date(Date.now() + 1500).toISOString() });
      expect((await media(expired.key)).statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 1700));
      expect((await media(expired.key)).json().detail).toMatch(/expired/);

      const { key } = await issueKey(acc, { label: 'live' });
      await admin('PATCH', `/accounts/${acc}`, { status: 'suspended' });
      const res = await media(key);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('account_suspended');
      await admin('PATCH', `/accounts/${acc}`, { status: 'active' });
      expect((await media(key)).statusCode).toBe(200);
    });
  });

  describe('metering', () => {
    it('aggregates usage off the hot path and exposes it', async () => {
      const acc = await account();
      const { key, id } = await issueKey(acc);
      const unique = `${TIKTOK}${Date.now()}`;
      await media(key, unique); // miss
      await media(key, unique); // cache hit
      await media(key, YOUTUBE); // 422
      await call(key, '/v1/media'); // 400: not metered (no platform resolved)
      expect((await db.query('SELECT 1 FROM usage_daily WHERE account_id = $1', [acc])).rowCount).toBe(0); // nothing written yet

      await built.usage.flush();
      const rows = (await db.query('SELECT platform, requests::int, cache_hits::int, errors::int FROM usage_daily WHERE account_id = $1 ORDER BY platform', [acc])).rows;
      expect(rows).toEqual([
        { platform: 'tiktok', requests: 2, cache_hits: 1, errors: 0 },
        { platform: 'youtube', requests: 1, cache_hits: 0, errors: 0 },
      ]);
      expect((await db.query('SELECT last_used_at FROM api_keys WHERE id = $1', [id])).rows[0].last_used_at).not.toBeNull();

      const own = (await call(key, '/v1/usage')).json().data;
      expect(own.plan).toBe('enterprise');
      expect(own.usage.length).toBe(2);
      const viaAdmin = (await admin('GET', `/accounts/${acc}/usage`)).json().data;
      expect(viaAdmin.length).toBe(2);
    });
  });

  describe('resilience', () => {
    it('fails open when Redis is down (auth falls back to Postgres)', async () => {
      const { key } = await issueKey(await account());
      const deadRedis = createRedis('redis://127.0.0.1:1');
      const degraded = await buildApp({
        config: testConfig(),
        db,
        redis: deadRedis,
        providers: [tiktokBackup.provider],
      });
      const res = await degraded.app.inject({ method: 'GET', url: `/v1/media?url=${encodeURIComponent(TIKTOK)}`, headers: { authorization: `Bearer ${key}` } });
      expect(res.statusCode).toBe(200);
      expect((await degraded.app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
      await degraded.usage.stop();
      await degraded.app.close();
      deadRedis.disconnect();
    });

    it('can fail closed instead, if the operator prefers strictness', async () => {
      const { key } = await issueKey(await account());
      const deadRedis = createRedis('redis://127.0.0.1:1');
      const strict = await buildApp({
        config: testConfig({ RATE_LIMIT_FAIL_MODE: 'closed' }),
        db,
        redis: deadRedis,
        providers: [tiktokBackup.provider],
      });
      const res = await strict.app.inject({ method: 'GET', url: `/v1/media?url=${encodeURIComponent(TIKTOK)}`, headers: { authorization: `Bearer ${key}` } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('overloaded');
      await strict.usage.stop();
      await strict.app.close();
      deadRedis.disconnect();
    });

    it('returns 502 listing every attempt when all providers are down', async () => {
      const dead = fakeProvider('dead', 'tiktok', 1, fails('timeout'));
      const only = await buildApp({ config: testConfig(), db, redis, providers: [dead.provider] });
      const { key } = await issueKey(await account());
      const res = await only.app.inject({ method: 'GET', url: `/v1/media?url=${encodeURIComponent(TIKTOK + '9')}`, headers: { authorization: `Bearer ${key}` } });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ code: 'upstream_unavailable', attempts: [{ provider: 'dead', outcome: 'timeout' }] });
      await only.usage.stop();
      await only.app.close();
    });
  });
});
