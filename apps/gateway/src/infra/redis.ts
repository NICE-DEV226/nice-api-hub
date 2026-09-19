import { Redis } from 'ioredis';

/**
 * Fail fast: on the hot path a slow Redis is worse than an unavailable one, so
 * commands time out quickly and are never queued while disconnected.
 */
export function createRedis(url: string): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    commandTimeout: 500,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    lazyConnect: true,
  });
  redis.on('error', () => {});
  return redis;
}
