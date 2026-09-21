import type { Redis } from 'ioredis';
import type { Principal } from './keyResolver.js';

/**
 * Two limits, evaluated atomically in one Redis round trip:
 *
 *  1. GCRA (generic cell rate algorithm) for the sustained rate + burst. One key per
 *     account, O(1) memory, exact, no fixed-window edge effects.
 *  2. A UTC-day counter for the plan's daily quota.
 *
 * The request only consumes budget when BOTH allow it, so a denied request never
 * burns quota. Time comes from the Redis server, so app instances with skewed
 * clocks agree.
 *
 * Returns: { allowed, reason, retryAfterMs, remaining, resetMs, dailyRemaining }
 */
const LUA = `
local rl_key      = KEYS[1]
local daily_key   = KEYS[2]
local interval    = tonumber(ARGV[1])   -- ms per token
local burst       = tonumber(ARGV[2])
local daily_limit = tonumber(ARGV[3])   -- -1 = unlimited
local day_ttl     = tonumber(ARGV[4])   -- seconds until UTC midnight (+ slack)

local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)

local daily_count = tonumber(redis.call('GET', daily_key) or '0')
if daily_limit >= 0 and daily_count >= daily_limit then
  return {0, 2, day_ttl * 1000, 0, 0, 0}
end

local burst_offset = interval * burst
local tat = tonumber(redis.call('GET', rl_key) or '0')
if tat < now then tat = now end
local new_tat = tat + interval
local allow_at = new_tat - burst_offset
local diff = now - allow_at

if diff < 0 then
  local daily_remaining = -1
  if daily_limit >= 0 then daily_remaining = daily_limit - daily_count end
  return {0, 1, math.ceil(-diff), 0, math.ceil(tat - now), daily_remaining}
end

redis.call('SET', rl_key, tostring(new_tat), 'PX', math.ceil(new_tat - now) + 1000)
local remaining = math.floor(diff / interval)

local daily_remaining = -1
if daily_limit >= 0 then
  local c = redis.call('INCR', daily_key)
  if c == 1 then redis.call('EXPIRE', daily_key, day_ttl) end
  daily_remaining = math.max(daily_limit - c, 0)
end
return {1, 0, 0, remaining, math.ceil(new_tat - now), daily_remaining}
`;

export interface RateLimitDecision {
  allowed: boolean;
  /** Why it was denied. */
  reason: 'rate' | 'daily_quota' | null;
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  resetSeconds: number;
  dailyLimit: number | null;
  dailyRemaining: number | null;
}

type RedisWithLimiter = Redis & {
  nahRateLimit(
    rlKey: string,
    dailyKey: string,
    interval: number,
    burst: number,
    dailyLimit: number,
    dayTtl: number,
  ): Promise<number[]>;
};

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

export type RequestCost = 'media' | 'control';

/** Same for every plan: these calls are cheap, this only stops a runaway loop. */
export const CONTROL_LIMITS = { rps: 5, burst: 60, dailyQuota: null } as const;

export class RateLimiter {
  private readonly redis: RedisWithLimiter;

  constructor(redis: Redis) {
    if (!('nahRateLimit' in redis)) {
      redis.defineCommand('nahRateLimit', { numberOfKeys: 2, lua: LUA });
    }
    this.redis = redis as RedisWithLimiter;
  }

  /**
   * `media` requests spend the plan's rate and daily quota. `control` requests (reading your account, listing
   * keys, polling a job) draw on a separate, generous bucket and never touch the daily quota: a UI that
   * refreshes its screen must not be able to use up the downloads you paid for, and nothing here is expensive.
   */
  async check(principal: Principal, now = new Date(), cost: RequestCost = 'media'): Promise<RateLimitDecision> {
    const control = cost === 'control';
    const { rps, burst, dailyQuota } = control ? CONTROL_LIMITS : principal.limits;
    const interval = 1000 / rps;
    const ttl = secondsUntilUtcMidnight(now) + 60;

    const [allowed, reason, retryMs, remaining, resetMs, dailyRemaining] =
      await this.redis.nahRateLimit(
        control ? `rlc:${principal.accountId}` : `rl:${principal.accountId}`,
        `qd:${principal.accountId}:${utcDay(now)}`,
        interval,
        burst,
        dailyQuota ?? -1,
        ttl,
      ) as [number, number, number, number, number, number];

    return {
      allowed: allowed === 1,
      reason: allowed === 1 ? null : reason === 2 ? 'daily_quota' : 'rate',
      retryAfterSeconds:
        reason === 2 ? secondsUntilUtcMidnight(now) : Math.max(1, Math.ceil(retryMs / 1000)),
      limit: burst,
      remaining,
      resetSeconds: Math.ceil(resetMs / 1000),
      dailyLimit: dailyQuota,
      dailyRemaining: dailyQuota === null || dailyRemaining < 0 ? null : dailyRemaining,
    };
  }
}
