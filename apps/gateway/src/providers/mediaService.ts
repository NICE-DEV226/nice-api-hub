import { errors } from '../errors.js';
import type { Metrics } from '../metrics.js';
import { Bulkhead, BulkheadRejected } from './bulkhead.js';
import { cacheKeyFor, type MediaCache } from './cache.js';
import { CircuitBreaker, type BreakerState } from './circuitBreaker.js';
import type { ProviderRegistry } from './registry.js';
import type { ResolvedTarget } from './platforms.js';
import { ProviderError, type Media, type Provider } from './types.js';

export interface MediaServiceOptions {
  upstreamTimeoutMs: number;
  maxConcurrency: number;
  maxQueue: number;
}

export interface ResolveResult {
  media: Media;
  cached: boolean;
}

interface Logger {
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

type Attempt = { provider: string; outcome: string };

/**
 * The orchestrator. For each request:
 *
 *   cache ─▶ single-flight ─▶ providers in priority order:
 *              skip if circuit open ─▶ bulkhead ─▶ call with timeout
 *              ├─ success ──────────▶ cache + return
 *              ├─ content gone ─────▶ negative-cache + 422 (provider not blamed)
 *              └─ provider fault ───▶ record on breaker, fail over to the next one
 */
export class MediaService {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly bulkheads = new Map<string, Bulkhead>();
  private readonly inflight = new Map<string, Promise<Media>>();

  constructor(
    private readonly deps: {
      registry: ProviderRegistry;
      cache: MediaCache;
      metrics: Metrics;
      logger: Logger;
      options: MediaServiceOptions;
      breakerFactory?: () => CircuitBreaker;
    },
  ) {}

  async resolve(target: ResolvedTarget): Promise<ResolveResult> {
    const platformId = target.platform.id;
    const providers = this.deps.registry.providersFor(platformId);
    if (providers.length === 0) {
      throw errors.unsupportedPlatform(`Platform "${platformId}" is not available yet.`);
    }

    const canonical = target.url.toString();
    const key = cacheKeyFor(platformId, canonical);

    const cached = await this.deps.cache.get(key);
    if (cached?.kind === 'media') {
      this.deps.metrics.cacheRequests.inc({ result: 'hit' });
      return { media: cached.media, cached: true };
    }
    if (cached?.kind === 'gone') {
      this.deps.metrics.cacheRequests.inc({ result: 'gone' });
      throw errors.contentUnavailable();
    }
    this.deps.metrics.cacheRequests.inc({ result: 'miss' });

    // Single-flight: identical concurrent requests share one upstream call.
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetchThroughProviders(providers, target, key).finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, pending);
    }
    return { media: await pending, cached: false };
  }

  breakerStates(): Record<string, BreakerState> {
    const out: Record<string, BreakerState> = {};
    for (const provider of this.deps.registry.allProviders()) {
      out[provider.id] = this.breakerFor(provider.id).state;
    }
    return out;
  }

  private async fetchThroughProviders(
    providers: readonly Provider[],
    target: ResolvedTarget,
    cacheKey: string,
  ): Promise<Media> {
    const attempts: Attempt[] = [];

    for (const provider of providers) {
      const breaker = this.breakerFor(provider.id);
      if (!breaker.tryAcquire()) {
        attempts.push({ provider: provider.id, outcome: 'circuit_open' });
        this.deps.metrics.providerCalls.inc({ provider: provider.id, outcome: 'circuit_open' });
        continue;
      }

      const started = performance.now();
      try {
        const draft = await this.bulkheadFor(provider.id).run(() =>
          provider.fetch({
            url: target.url,
            signal: AbortSignal.timeout(this.deps.options.upstreamTimeoutMs),
          }),
        );
        breaker.onSuccess();
        this.observe(provider.id, 'success', started);

        const media: Media = {
          ...draft,
          platform: target.platform.id,
          sourceUrl: target.url.toString(),
          provider: provider.id,
          fetchedAt: new Date().toISOString(),
        };
        await this.deps.cache.setMedia(cacheKey, media);
        return media;
      } catch (error) {
        if (error instanceof BulkheadRejected) {
          breaker.onNeutral();
          attempts.push({ provider: provider.id, outcome: 'overloaded' });
          this.deps.metrics.providerCalls.inc({ provider: provider.id, outcome: 'overloaded' });
          continue;
        }
        if (error instanceof ProviderError && error.kind === 'unavailable') {
          breaker.onNeutral();
          this.observe(provider.id, 'unavailable', started);
          await this.deps.cache.setGone(cacheKey);
          throw errors.contentUnavailable();
        }

        breaker.onFailure();
        const outcome = error instanceof ProviderError ? error.kind : 'internal';
        this.observe(provider.id, outcome, started);
        attempts.push({ provider: provider.id, outcome });
        const log = error instanceof ProviderError ? this.deps.logger.warn : this.deps.logger.error;
        log.call(this.deps.logger, { provider: provider.id, outcome, err: (error as Error).message }, 'provider attempt failed');
      }
    }

    const onlyOverload =
      attempts.length > 0 && attempts.every((a) => a.outcome === 'overloaded' || a.outcome === 'circuit_open') &&
      attempts.some((a) => a.outcome === 'overloaded');
    if (onlyOverload) throw errors.overloaded();
    throw errors.providersExhausted(attempts);
  }

  private observe(provider: string, outcome: string, startedAt: number): void {
    this.deps.metrics.providerCalls.inc({ provider, outcome });
    this.deps.metrics.providerDuration.observe({ provider }, (performance.now() - startedAt) / 1000);
  }

  private breakerFor(id: string): CircuitBreaker {
    let breaker = this.breakers.get(id);
    if (!breaker) {
      breaker = this.deps.breakerFactory?.() ?? new CircuitBreaker();
      this.breakers.set(id, breaker);
    }
    return breaker;
  }

  private bulkheadFor(id: string): Bulkhead {
    let bulkhead = this.bulkheads.get(id);
    if (!bulkhead) {
      bulkhead = new Bulkhead(this.deps.options.maxConcurrency, this.deps.options.maxQueue);
      this.bulkheads.set(id, bulkhead);
    }
    return bulkhead;
  }
}

