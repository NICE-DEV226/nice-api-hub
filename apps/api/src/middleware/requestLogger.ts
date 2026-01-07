/**
 * Request Logger Middleware
 * Logs API usage to database for analytics
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Extract platform name from endpoint
 */
function extractPlatform(endpoint: string): string {
  const match = endpoint.match(/\/api\/(\w+)\//);
  return match ? match[1] : 'unknown';
}

/**
 * Get country from IP (simplified - use a proper geo-ip service in production)
 */
function getCountryFromIP(_ip: string): string | undefined {
  // In production, use a service like MaxMind GeoIP
  return undefined;
}

/**
 * Log API request to database
 */
export async function logApiRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip logging for non-API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // Store original end function
  const originalEnd = res.end;
  const startTime = Date.now();

  // Override end to capture response
  res.end = function (chunk?: any, encoding?: any, callback?: any): Response {
    // Restore original end
    res.end = originalEnd;

    // Calculate latency
    const latencyData = (req as any).latencyData || {
      total: Date.now() - startTime,
      external: null,
      internal: null,
    };

    // Log to database asynchronously
    if (req.apiKey && req.user) {
      const logData = {
        apiKeyId: req.apiKey.id,
        userId: req.user.id,
        endpoint: req.path,
        platform: extractPlatform(req.path),
        method: req.method,
        statusCode: res.statusCode,
        totalLatency: latencyData.total,
        externalServiceLatency: latencyData.external,
        internalLatency: latencyData.internal,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        country: getCountryFromIP(req.ip || ''),
        isError: res.statusCode >= 400,
        errorMessage: res.statusCode >= 400 ? (res as any).errorMessage : null,
      };

      prisma.apiUsage.create({ data: logData }).catch((err) => {
        logger.error('Failed to log API usage:', err);
      });

      // Update API health metrics
      updateApiHealth(logData.platform, logData.endpoint, res.statusCode, latencyData.total);
    }

    // Call original end
    return originalEnd.call(this, chunk, encoding, callback);
  };

  next();
}

/**
 * Update API health metrics
 */
async function updateApiHealth(
  platform: string,
  endpoint: string,
  statusCode: number,
  latency: number
): Promise<void> {
  try {
    const isSuccess = statusCode < 400;

    await prisma.apiHealth.upsert({
      where: { platform },
      create: {
        platform,
        endpoint,
        isHealthy: isSuccess,
        lastStatus: statusCode,
        avgLatency: latency,
        totalRequests: 1,
        successfulRequests: isSuccess ? 1 : 0,
        failedRequests: isSuccess ? 0 : 1,
        successRate: isSuccess ? 100 : 0,
      },
      update: {
        lastStatus: statusCode,
        isHealthy: isSuccess,
        lastCheckedAt: new Date(),
        totalRequests: { increment: 1 },
        successfulRequests: isSuccess ? { increment: 1 } : undefined,
        failedRequests: !isSuccess ? { increment: 1 } : undefined,
        // Update rolling average (simplified)
        avgLatency: latency,
      },
    });
  } catch (err) {
    logger.error('Failed to update API health:', err);
  }
}
