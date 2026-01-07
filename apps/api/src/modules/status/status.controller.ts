/**
 * Public Status Controller
 * Shows API health status to users
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';

/**
 * Get public status of all platforms
 */
export async function getPublicStatus(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const platforms = await prisma.apiHealth.findMany({
      select: {
        platform: true,
        status: true,
        successRate: true,
        avgLatency: true,
        lastCheckedAt: true,
      },
      orderBy: { platform: 'asc' },
    });

    // Calculate overall status
    const statuses = platforms.map(p => p.status);
    let overallStatus = 'operational';
    
    if (statuses.some(s => s === 'DOWN')) {
      overallStatus = 'major_outage';
    } else if (statuses.some(s => s === 'UNSTABLE')) {
      overallStatus = 'partial_outage';
    } else if (statuses.some(s => s === 'DEGRADED' || s === 'MAINTENANCE')) {
      overallStatus = 'degraded';
    }

    res.json({
      success: true,
      data: {
        overall: overallStatus,
        platforms: platforms.map(p => ({
          name: p.platform,
          status: p.status,
          successRate: p.successRate,
          avgLatency: p.avgLatency,
          lastUpdated: p.lastCheckedAt,
        })),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get detailed status for a specific platform
 */
export async function getPlatformStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { platform } = req.params;

    const health = await prisma.apiHealth.findUnique({
      where: { platform },
    });

    if (!health) {
      res.status(404).json({
        success: false,
        error: { message: 'Platform not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        platform: health.platform,
        status: health.status,
        metrics: {
          successRate: health.successRate,
          avgLatency: health.avgLatency,
          totalRequests: health.totalRequests,
          failedRequests: health.failedRequests,
        },
        lastError: health.lastError,
        lastUpdated: health.lastCheckedAt,
        statusChangedAt: health.statusChangedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}
