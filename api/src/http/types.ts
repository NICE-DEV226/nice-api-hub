import type { Principal } from '../gateway/keyResolver.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    /** Set by metered routes so the onResponse hook can record usage. */
    usage: { platform: string; cacheHit: boolean } | null;
  }
}

export {};
