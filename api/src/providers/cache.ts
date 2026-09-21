import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Media } from './types.js';

export type CacheEntry = { kind: 'media'; media: Media } | { kind: 'gone' };

export function cacheKeyFor(platform: string, canonicalUrl: string): string {
  return `media:${platform}:${createHash('sha1').update(canonicalUrl).digest('hex')}`;
}

/**
 * Result cache. Upstream direct links expire, so TTLs are short. "Content gone"
 * verdicts are cached briefly too, so a dead link can't be used to hammer providers.
 * Every operation fails open: a broken cache must never break requests.
 */
export class MediaCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
    private readonly negativeTtlSeconds: number,
  ) {}

  async get(key: string): Promise<CacheEntry | null> {
    if (this.ttlSeconds === 0) return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as CacheEntry) : null;
    } catch {
      return null;
    }
  }

  async setMedia(key: string, media: Media): Promise<void> {
    await this.put(key, { kind: 'media', media }, this.ttlSeconds);
  }

  async setGone(key: string): Promise<void> {
    await this.put(key, { kind: 'gone' }, this.negativeTtlSeconds);
  }

  private async put(key: string, entry: CacheEntry, ttl: number): Promise<void> {
    if (ttl <= 0) return;
    // ±10 % jitter so entries created together don't all expire (and refetch) together.
    const jittered = Math.max(1, Math.round(ttl * (0.9 + Math.random() * 0.2)));
    try {
      await this.redis.set(key, JSON.stringify(entry), 'EX', jittered);
    } catch {
      // best effort
    }
  }
}
