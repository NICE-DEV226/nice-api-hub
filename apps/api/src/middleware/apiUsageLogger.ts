/**
 * API Usage Logger Middleware
 * Records API usage and updates health metrics
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { recordRequest } from '../services/healthMonitor.service.js';
import { logger } from '../utils/logger.js';

/**
 * Log API usage after response is sent
 */
export function apiUsageLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  // Capture original end function
  const originalEnd = res.end.bind(res);

  // Override end to log after response
  res.end = function (chunk?: any, encoding?: any, callback?: any) {
    // Call original end first
    originalEnd(chunk, encoding, callback);

    // Log usage asynchronously (don't block response)
    setImmediate(async () => {
      try {
        // Only log API download endpoints
        if (!req.path.startsWith('/api/') || req.path === '/api') {
          return;
        }

        // Extract platform from path (e.g., /api/tiktok/download -> tiktok)
        const pathParts = req.path.split('/');
        const platform = pathParts[2] || 'unknown';
        
        const totalLatency = Date.now() - startTime;
        const latencyData = (req as any).latencyData || { total: totalLatency, external: 0, internal: totalLatency };
        
        const isError = res.statusCode >= 400;
        const userId = (req as any).apiKeyUser?.id;
        const apiKeyId = (req as any).apiKeyId;

        // Record in health monitor
        await recordRequest({
          platform,
          endpoint: req.path,
          statusCode: res.statusCode,
          isError,
          latency: latencyData.total,
          errorMessage: isError ? (req as any).errorMessage : undefined,
        });

        // Record in API usage if we have user context
        if (userId && apiKeyId) {
          await prisma.apiUsage.create({
            data: {
              userId,
              apiKeyId,
              endpoint: req.path,
              platform,
              method: req.method,
              statusCode: res.statusCode,
              totalLatency: latencyData.total,
              externalServiceLatency: latencyData.external,
              internalLatency: latencyData.internal,
              ipAddress: req.ip || req.headers['x-forwarded-for']?.toString(),
              userAgent: req.headers['user-agent'],
              isError,
              errorMessage: isError ? (req as any).errorMessage : null,
              errorCode: isError ? (req as any).errorCode : null,
            },
          });
        }
      } catch (error) {
        logger.error('[ApiUsageLogger] Error logging usage:', error);
      }
    });

    return res;
  };

  next();
}

/**
 * Middleware to capture error details for logging
 */
export function captureErrorDetails(
  err: any,
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  (req as any).errorMessage = err.message || 'Unknown error';
  (req as any).errorCode = err.code || 'UNKNOWN_ERROR';
  next(err);
}
