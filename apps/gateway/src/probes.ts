import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import { resolveTarget } from './providers/platforms.js';
import type { BreakerState } from './providers/circuitBreaker.js';
import type { ProviderRegistry } from './providers/registry.js';
import { ProviderError } from './providers/types.js';

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
  at: string;
}

export class ProbeStore {
  constructor(private readonly redis: Redis) {}

  async get(providerId: string): Promise<ProbeResult | null> {
    try {
      const raw = await this.redis.get(`probe:${providerId}`);
      return raw ? (JSON.parse(raw) as ProbeResult) : null;
    } catch {
      return null;
    }
  }

  async set(providerId: string, result: ProbeResult, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(`probe:${providerId}`, JSON.stringify(result), 'EX', ttlSeconds);
    } catch {
      // best effort
    }
  }
}

export type PlatformStatus = 'operational' | 'degraded' | 'down' | 'unknown';

/**
 * Health is derived from what we measure ourselves (synthetic probes + circuit
 * breakers), never from customer traffic: clients sending bad URLs or bad keys
 * cannot move it.
 */
export function platformStatus(
  providers: ReadonlyArray<{ circuit: BreakerState; probe: ProbeResult | null }>,
): PlatformStatus {
  if (providers.length === 0) return 'unknown';
  const usable = providers.filter((p) => p.circuit !== 'open' && p.probe?.ok !== false);
  if (usable.length === providers.length) {
    return providers.every((p) => p.probe === null) && providers.every((p) => p.circuit === 'closed')
      ? 'unknown'
      : 'operational';
  }
  return usable.length > 0 ? 'degraded' : 'down';
}

interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/**
 * Runs each provider against a known-good URL on an interval. A Redis lock elects
 * one runner across all instances, so N replicas don't probe N times.
 */
export function startProbes(deps: {
  registry: ProviderRegistry;
  store: ProbeStore;
  redis: Redis;
  config: Pick<Config, 'probeUrls' | 'PROBE_INTERVAL_SECONDS' | 'UPSTREAM_TIMEOUT_MS'>;
  logger: Logger;
}): { stop(): void; runOnce(): Promise<void> } {
  const { registry, store, redis, config, logger } = deps;
  const instanceId = randomUUID();
  const intervalMs = config.PROBE_INTERVAL_SECONDS * 1000;

  async function runOnce(): Promise<void> {
    try {
      const got = await redis.set('probes:lock', instanceId, 'PX', Math.floor(intervalMs * 0.9), 'NX');
      if (got !== 'OK') return;
    } catch {
      return;
    }

    await Promise.allSettled(
      registry.allProviders().map(async (provider) => {
        const sample = config.probeUrls[provider.platform];
        if (!sample) return;
        const started = performance.now();
        try {
          const { url } = resolveTarget(sample, registry.platforms);
          await provider.fetch({ url, signal: AbortSignal.timeout(config.UPSTREAM_TIMEOUT_MS) });
          await store.set(
            provider.id,
            { ok: true, latencyMs: Math.round(performance.now() - started), error: null, at: new Date().toISOString() },
            config.PROBE_INTERVAL_SECONDS * 3,
          );
        } catch (error) {
          const kind = error instanceof ProviderError ? error.kind : 'internal';
          logger.warn({ provider: provider.id, kind }, 'probe failed');
          await store.set(
            provider.id,
            { ok: false, latencyMs: Math.round(performance.now() - started), error: kind, at: new Date().toISOString() },
            config.PROBE_INTERVAL_SECONDS * 3,
          );
        }
      }),
    );
  }

  void runOnce();
  const timer = setInterval(() => void runOnce(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), runOnce };
}
