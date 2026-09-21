import { PLATFORMS, resolveTarget } from '../src/providers/platforms.js';
import { ProviderError, type MediaDraft, type Provider } from '../src/providers/types.js';
import type { CacheEntry } from '../src/providers/cache.js';
import type { MediaCache } from '../src/providers/cache.js';
import { createMetrics } from '../src/metrics.js';
import { MediaService } from '../src/providers/mediaService.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { CircuitBreaker } from '../src/providers/circuitBreaker.js';

export const draft = (title = 'clip'): MediaDraft => ({
  title,
  author: null,
  thumbnail: null,
  durationSeconds: 12,
  variants: [{ kind: 'video', url: 'https://cdn.example/v.mp4', ext: 'mp4', mime: 'video/mp4' }],
});

export type Behaviour = () => Promise<MediaDraft>;

export function fakeProvider(id: string, platform: string, priority: number, behaviour: Behaviour = async () => draft(id)) {
  const calls = { count: 0 };
  const provider: Provider = {
    id,
    platform,
    priority,
    async fetch() {
      calls.count++;
      return behaviour();
    },
  };
  return { provider, calls };
}

export const fails = (kind: ConstructorParameters<typeof ProviderError>[0]): Behaviour => async () => {
  throw new ProviderError(kind, `${kind} failure`);
};

/** In-memory stand-in for MediaCache (unit tests only). */
export class MemoryCache {
  store = new Map<string, CacheEntry>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async setMedia(k: string, media: any) { this.store.set(k, { kind: 'media', media }); }
  async setGone(k: string) { this.store.set(k, { kind: 'gone' }); }
}

export function makeService(providers: Provider[], opts: { breakerFactory?: () => CircuitBreaker; cache?: MemoryCache } = {}) {
  const cache = opts.cache ?? new MemoryCache();
  const service = new MediaService({
    registry: new ProviderRegistry(providers, PLATFORMS),
    cache: cache as unknown as MediaCache,
    metrics: createMetrics(),
    logger: { warn() {}, error() {} },
    options: { upstreamTimeoutMs: 1000, maxConcurrency: 5, maxQueue: 5 },
    ...(opts.breakerFactory ? { breakerFactory: opts.breakerFactory } : {}),
  });
  return { service, cache };
}

export const tiktokTarget = (path = '1') => resolveTarget(`https://www.tiktok.com/@u/video/${path}`);
