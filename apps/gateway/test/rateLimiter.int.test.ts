import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '../src/gateway/keyResolver.js';
import { RateLimiter } from '../src/gateway/rateLimiter.js';
import { freshInfra, hasInfra } from './infra.js';

let n = 0;
const principal = (limits: Principal['limits']): Principal => ({
  keyId: 'k',
  accountId: `acct-${++n}-${Math.random().toString(36).slice(2)}`,
  planId: 't',
  limits,
  platforms: null,
  expiresAt: null,
  revoked: false,
  accountActive: true,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasInfra)('RateLimiter (Redis Lua, atomic)', () => {
  let redis: Redis;
  let limiter: RateLimiter;

  beforeAll(async () => {
    ({ redis } = await freshInfra());
    limiter = new RateLimiter(redis);
  });
  beforeEach(() => redis.flushdb());
  afterAll(() => redis.quit());

  it('allows a burst, then denies with a Retry-After', async () => {
    const p = principal({ rps: 10, burst: 5, dailyQuota: null });
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await limiter.check(p));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const denied = results[5]!;
    expect(denied).toMatchObject({ allowed: false, reason: 'rate' });
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(results[0]!.remaining).toBe(4);
  });

  it('refills at the sustained rate', async () => {
    const p = principal({ rps: 20, burst: 2, dailyQuota: null }); // one token / 50 ms
    await limiter.check(p);
    await limiter.check(p);
    expect((await limiter.check(p)).allowed).toBe(false);
    await sleep(120);
    expect((await limiter.check(p)).allowed).toBe(true);
  });

  it('is exact under concurrency: 60 parallel calls, burst 10 ⇒ exactly 10 allowed', async () => {
    const p = principal({ rps: 0.01, burst: 10, dailyQuota: null });
    const results = await Promise.all(Array.from({ length: 60 }, () => limiter.check(p)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it('enforces the daily quota and reports the reason', async () => {
    const p = principal({ rps: 1000, burst: 1000, dailyQuota: 3 });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.check(p));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[2]!.dailyRemaining).toBe(0);
    expect(results[3]).toMatchObject({ reason: 'daily_quota' });
    expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
    expect(results[3]!.retryAfterSeconds).toBeLessThanOrEqual(86_400);
  });

  it('a request denied by the rate limit does not burn daily quota', async () => {
    const p = principal({ rps: 0.01, burst: 2, dailyQuota: 100 });
    for (let i = 0; i < 10; i++) await limiter.check(p);
    const day = new Date().toISOString().slice(0, 10);
    expect(await redis.get(`qd:${p.accountId}:${day}`)).toBe('2');
  });

  it('isolates accounts from each other', async () => {
    const a = principal({ rps: 0.01, burst: 1, dailyQuota: null });
    const b = principal({ rps: 0.01, burst: 1, dailyQuota: null });
    expect((await limiter.check(a)).allowed).toBe(true);
    expect((await limiter.check(a)).allowed).toBe(false);
    expect((await limiter.check(b)).allowed).toBe(true);
  });

  it('unlimited daily quota reports null', async () => {
    const r = await limiter.check(principal({ rps: 100, burst: 10, dailyQuota: null }));
    expect(r).toMatchObject({ allowed: true, dailyLimit: null, dailyRemaining: null });
  });
});
