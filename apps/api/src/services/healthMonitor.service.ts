/**
 * Health Monitor Service
 * Tracks API endpoint health and automatically updates status
 * Author: NICE-DEV
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

// Thresholds for status changes
const THRESHOLDS = {
  HEALTHY_MIN_SUCCESS_RATE: 95,      // > 95% = HEALTHY
  DEGRADED_MIN_SUCCESS_RATE: 80,     // 80-95% = DEGRADED
  UNSTABLE_MIN_SUCCESS_RATE: 50,     // 50-80% = UNSTABLE
  DOWN_MAX_SUCCESS_RATE: 50,         // < 50% = DOWN
  
  CONSECUTIVE_ERRORS_DEGRADED: 3,    // 3 consecutive errors = DEGRADED
  CONSECUTIVE_ERRORS_UNSTABLE: 5,    // 5 consecutive errors = UNSTABLE
  CONSECUTIVE_ERRORS_DOWN: 10,       // 10 consecutive errors = DOWN
  
  HIGH_LATENCY_MS: 5000,             // > 5s = considered slow
  CRITICAL_LATENCY_MS: 10000,        // > 10s = critical
  
  MIN_REQUESTS_FOR_CALCULATION: 10,  // Need at least 10 requests to calculate
};

type ApiStatus = 'HEALTHY' | 'DEGRADED' | 'UNSTABLE' | 'DOWN' | 'MAINTENANCE';

interface HealthUpdate {
  platform: string;
  endpoint: string;
  statusCode: number;
  isError: boolean;
  latency: number;
  errorMessage?: string;
}

/**
 * Record a request and update health metrics
 */
export async function recordRequest(data: HealthUpdate): Promise<void> {
  try {
    const { platform, endpoint, statusCode, isError, latency, errorMessage } = data;

    // Get or create health record
    let health = await prisma.apiHealth.findUnique({
      where: { platform },
    });

    if (!health) {
      health = await prisma.apiHealth.create({
        data: {
          platform,
          endpoint,
          status: 'HEALTHY',
          isHealthy: true,
          lastStatus: statusCode,
          successRate: 100,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          consecutiveErrors: 0,
          avgLatency: 0,
          p95Latency: 0,
          p99Latency: 0,
        },
      });
    }

    // Update counters
    const newTotalRequests = health.totalRequests + 1;
    const newSuccessfulRequests = isError ? health.successfulRequests : health.successfulRequests + 1;
    const newFailedRequests = isError ? health.failedRequests + 1 : health.failedRequests;
    const newConsecutiveErrors = isError ? health.consecutiveErrors + 1 : 0;

    // Calculate new success rate
    const newSuccessRate = newTotalRequests > 0 
      ? (newSuccessfulRequests / newTotalRequests) * 100 
      : 100;

    // Calculate rolling average latency
    const newAvgLatency = health.totalRequests > 0
      ? (health.avgLatency * health.totalRequests + latency) / newTotalRequests
      : latency;

    // Determine new status
    const newStatus = calculateStatus(
      newSuccessRate,
      newConsecutiveErrors,
      newAvgLatency,
      health.status as ApiStatus
    );

    const statusChanged = newStatus !== health.status;

    // Update health record
    await prisma.apiHealth.update({
      where: { platform },
      data: {
        lastStatus: statusCode,
        lastError: isError ? errorMessage : health.lastError,
        totalRequests: newTotalRequests,
        successfulRequests: newSuccessfulRequests,
        failedRequests: newFailedRequests,
        consecutiveErrors: newConsecutiveErrors,
        successRate: Math.round(newSuccessRate * 100) / 100,
        avgLatency: Math.round(newAvgLatency),
        status: newStatus,
        isHealthy: newStatus === 'HEALTHY',
        lastSuccessAt: isError ? health.lastSuccessAt : new Date(),
        ...(statusChanged && {
          statusChangedAt: new Date(),
          previousStatus: health.status as ApiStatus,
        }),
        lastCheckedAt: new Date(),
      },
    });

    // Log status changes
    if (statusChanged) {
      logger.warn(`[HealthMonitor] ${platform} status changed: ${health.status} → ${newStatus}`);
    }
  } catch (error) {
    logger.error('[HealthMonitor] Error recording request:', error);
  }
}

/**
 * Calculate the appropriate status based on metrics
 */
function calculateStatus(
  successRate: number,
  consecutiveErrors: number,
  avgLatency: number,
  currentStatus: ApiStatus
): ApiStatus {
  // Don't change if manually set to MAINTENANCE
  if (currentStatus === 'MAINTENANCE') {
    return 'MAINTENANCE';
  }

  // Check consecutive errors first (immediate impact)
  if (consecutiveErrors >= THRESHOLDS.CONSECUTIVE_ERRORS_DOWN) {
    return 'DOWN';
  }
  if (consecutiveErrors >= THRESHOLDS.CONSECUTIVE_ERRORS_UNSTABLE) {
    return 'UNSTABLE';
  }
  if (consecutiveErrors >= THRESHOLDS.CONSECUTIVE_ERRORS_DEGRADED) {
    return 'DEGRADED';
  }

  // Check success rate
  if (successRate < THRESHOLDS.DOWN_MAX_SUCCESS_RATE) {
    return 'DOWN';
  }
  if (successRate < THRESHOLDS.UNSTABLE_MIN_SUCCESS_RATE) {
    return 'UNSTABLE';
  }
  if (successRate < THRESHOLDS.DEGRADED_MIN_SUCCESS_RATE) {
    return 'DEGRADED';
  }

  // Check latency
  if (avgLatency > THRESHOLDS.CRITICAL_LATENCY_MS) {
    return 'DEGRADED';
  }

  return 'HEALTHY';
}

/**
 * Get health status for all platforms
 */
export async function getAllHealthStatus() {
  return prisma.apiHealth.findMany({
    orderBy: { platform: 'asc' },
  });
}

/**
 * Get health status for a specific platform
 */
export async function getPlatformHealth(platform: string) {
  return prisma.apiHealth.findUnique({
    where: { platform },
  });
}

/**
 * Manually set platform status (admin)
 */
export async function setMaintenanceMode(platform: string, enabled: boolean) {
  const health = await prisma.apiHealth.findUnique({ where: { platform } });
  
  if (!health) {
    throw new Error(`Platform ${platform} not found`);
  }

  return prisma.apiHealth.update({
    where: { platform },
    data: {
      status: enabled ? 'MAINTENANCE' : 'HEALTHY',
      previousStatus: health.status as ApiStatus,
      statusChangedAt: new Date(),
    },
  });
}

/**
 * Reset health metrics for a platform (admin)
 */
export async function resetPlatformHealth(platform: string) {
  return prisma.apiHealth.update({
    where: { platform },
    data: {
      status: 'HEALTHY',
      isHealthy: true,
      successRate: 100,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      consecutiveErrors: 0,
      avgLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      lastError: null,
      statusChangedAt: new Date(),
    },
  });
}

/**
 * Clean old metrics (run daily via cron)
 * Resets counters but keeps status
 */
export async function cleanOldMetrics() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get all health records that haven't been updated in 24h
  const staleRecords = await prisma.apiHealth.findMany({
    where: {
      lastCheckedAt: { lt: oneDayAgo },
    },
  });

  for (const record of staleRecords) {
    // If no activity in 24h, reset counters but keep last known status
    await prisma.apiHealth.update({
      where: { id: record.id },
      data: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        // Keep consecutiveErrors and status as they were
      },
    });
  }

  logger.info(`[HealthMonitor] Cleaned ${staleRecords.length} stale health records`);
}
