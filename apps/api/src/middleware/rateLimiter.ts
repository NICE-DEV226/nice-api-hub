/**
 * Rate Limiting Middleware
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Rate limits by plan
const RATE_LIMITS: Record<string, { perMinute: number; perHour: number; perDay: number }> = {
  FREE: { perMinute: 5, perHour: 10, perDay: 100 },
  BASIC: { perMinute: 20, perHour: 100, perDay: 1000 },
  PRO: { perMinute: 100, perHour: 1000, perDay: 10000 },
  ENTERPRISE: { perMinute: 1000, perHour: 10000, perDay: -1 }, // -1 = unlimited
};

/**
 * Rate limiter middleware
 * Limits requests based on user plan
 */
export function rateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const apiKeyId = req.apiKey?.id;
    const plan = req.user?.plan || 'FREE';

    if (!apiKeyId) {
      // No API key, use IP-based limiting
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      return ipRateLimiter(ip, res, next);
    }

    const limits = RATE_LIMITS[plan] || RATE_LIMITS.FREE;
    const now = Date.now();
    const minuteKey = `${apiKeyId}:minute`;
    const hourKey = `${apiKeyId}:hour`;
    const dayKey = `${apiKeyId}:day`;

    // Check minute limit
    const minuteData = rateLimitStore.get(minuteKey);
    if (minuteData) {
      if (now < minuteData.resetAt) {
        if (minuteData.count >= limits.perMinute) {
          setRateLimitHeaders(res, limits.perMinute, 0, minuteData.resetAt);
          throw createError('Rate limit exceeded (per minute)', 429, 'RATE_LIMIT_EXCEEDED');
        }
        minuteData.count++;
      } else {
        rateLimitStore.set(minuteKey, { count: 1, resetAt: now + 60000 });
      }
    } else {
      rateLimitStore.set(minuteKey, { count: 1, resetAt: now + 60000 });
    }

    // Check hour limit
    const hourData = rateLimitStore.get(hourKey);
    if (hourData) {
      if (now < hourData.resetAt) {
        if (hourData.count >= limits.perHour) {
          setRateLimitHeaders(res, limits.perHour, 0, hourData.resetAt);
          throw createError('Rate limit exceeded (per hour)', 429, 'RATE_LIMIT_EXCEEDED');
        }
        hourData.count++;
      } else {
        rateLimitStore.set(hourKey, { count: 1, resetAt: now + 3600000 });
      }
    } else {
      rateLimitStore.set(hourKey, { count: 1, resetAt: now + 3600000 });
    }

    // Check day limit (skip if unlimited)
    if (limits.perDay !== -1) {
      const dayData = rateLimitStore.get(dayKey);
      if (dayData) {
        if (now < dayData.resetAt) {
          if (dayData.count >= limits.perDay) {
            setRateLimitHeaders(res, limits.perDay, 0, dayData.resetAt);
            throw createError('Rate limit exceeded (per day)', 429, 'RATE_LIMIT_EXCEEDED');
          }
          dayData.count++;
        } else {
          rateLimitStore.set(dayKey, { count: 1, resetAt: now + 86400000 });
        }
      } else {
        rateLimitStore.set(dayKey, { count: 1, resetAt: now + 86400000 });
      }
    }

    // Set rate limit headers
    const currentMinute = rateLimitStore.get(minuteKey);
    if (currentMinute) {
      setRateLimitHeaders(
        res,
        limits.perMinute,
        limits.perMinute - currentMinute.count,
        currentMinute.resetAt
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * IP-based rate limiter for unauthenticated requests
 */
function ipRateLimiter(ip: string, res: Response, next: NextFunction): void {
  const limit = 10; // 10 requests per minute for unauthenticated
  const now = Date.now();
  const key = `ip:${ip}`;

  const data = rateLimitStore.get(key);
  if (data) {
    if (now < data.resetAt) {
      if (data.count >= limit) {
        setRateLimitHeaders(res, limit, 0, data.resetAt);
        return next(createError('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED'));
      }
      data.count++;
    } else {
      rateLimitStore.set(key, { count: 1, resetAt: now + 60000 });
    }
  } else {
    rateLimitStore.set(key, { count: 1, resetAt: now + 60000 });
  }

  const current = rateLimitStore.get(key);
  if (current) {
    setRateLimitHeaders(res, limit, limit - current.count, current.resetAt);
  }

  next();
}

/**
 * Set rate limit headers
 */
function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number
): void {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Every minute
