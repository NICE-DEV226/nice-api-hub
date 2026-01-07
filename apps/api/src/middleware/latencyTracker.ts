/**
 * Latency Tracking Middleware
 * Author: NICE-DEV
 * 
 * Tracks 3 metrics:
 * 1. Total request latency
 * 2. External service latency (API calls to third parties)
 * 3. Internal processing latency
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Store for tracking external service calls
const externalCallTimes = new WeakMap<Request, number[]>();

/**
 * Start tracking latency for a request
 */
export function latencyTracker(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  externalCallTimes.set(req, []);

  // Override res.json to capture response time
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const totalLatency = Date.now() - startTime;
    const externalTimes = externalCallTimes.get(req) || [];
    const externalLatency = externalTimes.reduce((sum, t) => sum + t, 0);
    const internalLatency = totalLatency - externalLatency;

    // Add latency info to response headers
    res.setHeader('X-Response-Time', `${totalLatency}ms`);
    res.setHeader('X-External-Time', `${externalLatency}ms`);
    res.setHeader('X-Internal-Time', `${internalLatency}ms`);

    // Log latency
    logger.debug(`[Latency] ${req.method} ${req.path} - Total: ${totalLatency}ms, External: ${externalLatency}ms, Internal: ${internalLatency}ms`);

    // Attach latency data to request for logging middleware
    (req as any).latencyData = {
      total: totalLatency,
      external: externalLatency,
      internal: internalLatency,
    };

    return originalJson(body);
  };

  next();
}

/**
 * Record external service call time
 * Call this before and after making external API calls
 */
export function recordExternalCall(req: Request, duration: number): void {
  const times = externalCallTimes.get(req);
  if (times) {
    times.push(duration);
  }
}

/**
 * Helper to wrap external API calls and track their duration
 */
export async function trackExternalCall<T>(
  req: Request,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    recordExternalCall(req, Date.now() - start);
    return result;
  } catch (error) {
    recordExternalCall(req, Date.now() - start);
    throw error;
  }
}
