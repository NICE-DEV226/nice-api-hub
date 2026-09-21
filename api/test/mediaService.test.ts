import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/providers/circuitBreaker.js';
import { draft, fails, fakeProvider, makeService, MemoryCache, tiktokTarget } from './helpers.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e: any) {
    return e;
  }
  throw new Error('expected rejection');
};

describe('MediaService', () => {
  it('serves from the primary provider', async () => {
    const a = fakeProvider('a', 'tiktok', 1);
    const b = fakeProvider('b', 'tiktok', 2);
    const { service } = makeService([b.provider, a.provider]);
    const { media, cached } = await service.resolve(tiktokTarget());
    expect(media.provider).toBe('a'); // priority order, not registration order
    expect(cached).toBe(false);
    expect(b.calls.count).toBe(0);
  });

  it('fails over to the next provider on upstream errors', async () => {
    const a = fakeProvider('a', 'tiktok', 1, fails('upstream'));
    const b = fakeProvider('b', 'tiktok', 2);
    const { service } = makeService([a.provider, b.provider]);
    expect((await service.resolve(tiktokTarget())).media.provider).toBe('b');
    expect(a.calls.count).toBe(1);
  });

  it.each(['timeout', 'blocked', 'bad_response'] as const)('treats %s as a provider fault and fails over', async (kind) => {
    const a = fakeProvider('a', 'tiktok', 1, fails(kind));
    const b = fakeProvider('b', 'tiktok', 2);
    const { service } = makeService([a.provider, b.provider]);
    expect((await service.resolve(tiktokTarget())).media.provider).toBe('b');
  });

  it('stops at "content unavailable" without blaming or trying other providers', async () => {
    const a = fakeProvider('a', 'tiktok', 1, fails('unavailable'));
    const b = fakeProvider('b', 'tiktok', 2);
    const { service, cache } = makeService([a.provider, b.provider]);
    const err = await code(service.resolve(tiktokTarget()));
    expect(err).toMatchObject({ status: 422, code: 'content_unavailable' });
    expect(b.calls.count).toBe(0);
    expect(service.breakerStates()['a']).toBe('closed');
    // ...and the verdict is negatively cached, so a dead link can't hammer providers.
    await code(service.resolve(tiktokTarget()));
    expect(a.calls.count).toBe(1);
    expect([...cache.store.values()][0]).toEqual({ kind: 'gone' });
  });

  it('returns 502 with per-provider attempts when everything fails', async () => {
    const a = fakeProvider('a', 'tiktok', 1, fails('timeout'));
    const b = fakeProvider('b', 'tiktok', 2, fails('blocked'));
    const { service } = makeService([a.provider, b.provider]);
    const err = await code(service.resolve(tiktokTarget()));
    expect(err).toMatchObject({ status: 502, code: 'upstream_unavailable' });
    expect(err.options.extensions.attempts).toEqual([
      { provider: 'a', outcome: 'timeout' },
      { provider: 'b', outcome: 'blocked' },
    ]);
  });

  it('turns unexpected exceptions into a failover, never a crash', async () => {
    const a = fakeProvider('a', 'tiktok', 1, async () => { throw new TypeError('boom'); });
    const b = fakeProvider('b', 'tiktok', 2);
    const { service } = makeService([a.provider, b.provider]);
    expect((await service.resolve(tiktokTarget())).media.provider).toBe('b');
  });

  it('opens the circuit on a failing provider and skips it afterwards', async () => {
    const a = fakeProvider('a', 'tiktok', 1, fails('upstream'));
    const b = fakeProvider('b', 'tiktok', 2);
    const { service } = makeService([a.provider, b.provider], {
      breakerFactory: () => new CircuitBreaker({ minVolume: 3, failureRatio: 0.5, cooldownMs: 60_000 }),
    });
    for (let i = 0; i < 3; i++) await service.resolve(tiktokTarget(`u${i}`));
    expect(service.breakerStates()['a']).toBe('open');
    const before = a.calls.count;
    await service.resolve(tiktokTarget('after'));
    expect(a.calls.count).toBe(before); // not even tried
  });

  it('caches successes and serves repeats without touching providers', async () => {
    const a = fakeProvider('a', 'tiktok', 1);
    const { service } = makeService([a.provider]);
    await service.resolve(tiktokTarget());
    const second = await service.resolve(tiktokTarget());
    expect(second.cached).toBe(true);
    expect(a.calls.count).toBe(1);
  });

  it('coalesces identical concurrent requests into one upstream call', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = fakeProvider('a', 'tiktok', 1, async () => { await gate; return draft(); });
    const { service } = makeService([a.provider], { cache: new MemoryCache() });
    const all = Promise.all(Array.from({ length: 10 }, () => service.resolve(tiktokTarget('same'))));
    await new Promise((r) => setTimeout(r, 20));
    release();
    const results = await all;
    expect(a.calls.count).toBe(1);
    expect(new Set(results.map((r) => r.media.fetchedAt)).size).toBe(1);
  });

  it('rejects platforms that have no provider', async () => {
    const { service } = makeService([]);
    expect(await code(service.resolve(tiktokTarget()))).toMatchObject({ status: 422, code: 'unsupported_platform' });
  });
});
