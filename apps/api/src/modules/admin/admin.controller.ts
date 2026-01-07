/**
 * Admin controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';

// ==================== DASHBOARD ====================
export async function getDashboard(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeUsers,
      totalRequests,
      requestsToday,
      avgLatency,
      errorCount,
      platformStats,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.apiUsage.count(),
      prisma.apiUsage.count({ where: { timestamp: { gte: today } } }),
      prisma.apiUsage.aggregate({ _avg: { totalLatency: true } }),
      prisma.apiUsage.count({ where: { isError: true, timestamp: { gte: today } } }),
      prisma.apiUsage.groupBy({
        by: ['platform'],
        _count: { platform: true },
        orderBy: { _count: { platform: 'desc' } },
        take: 5,
      }),
    ]);

    const errorRate = requestsToday > 0 ? (errorCount / requestsToday) * 100 : 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        totalRequests,
        requestsToday,
        avgLatency: Math.round(avgLatency._avg.totalLatency || 0),
        errorRate: Math.round(errorRate * 100) / 100,
        topPlatforms: platformStats.map((p) => ({
          platform: p.platform,
          requests: p._count.platform,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

// ==================== USERS ====================
export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { page = 1, limit = 20, search, plan, role, status } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { name: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (plan) where.plan = plan;
    if (role) where.role = role;
    if (status === 'active') where.isActive = true;
    if (status === 'suspended') where.isActive = false;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          role: true,
          plan: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { apiKeys: true, apiUsage: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        users: users.map((u) => ({
          ...u,
          apiKeysCount: u._count.apiKeys,
          totalRequests: u._count.apiUsage,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        apiKeys: {
          select: {
            id: true,
            name: true,
            keyPreview: true,
            environment: true,
            isActive: true,
            createdAt: true,
            lastUsedAt: true,
          },
        },
        subscription: true,
        _count: { select: { apiUsage: true } },
      },
    });

    if (!user) {
      throw createError('User not found', 404, 'NOT_FOUND');
    }

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { plan, role, reason } = req.body;
    const adminId = req.user!.id;
    const adminEmail = req.user!.email;

    // Get current user data for history
    const currentUser = await prisma.user.findUnique({
      where: { id },
      select: { plan: true },
    });

    if (!currentUser) {
      throw createError('User not found', 404, 'NOT_FOUND');
    }

    // If plan is changing, create history entry
    if (plan && plan !== currentUser.plan) {
      await prisma.planChangeHistory.create({
        data: {
          userId: id,
          previousPlan: currentUser.plan,
          newPlan: plan,
          changedBy: adminId,
          changedByEmail: adminEmail,
          reason: reason || null,
        },
      });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(plan && { plan }),
        ...(role && { role }),
      },
    });

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    await prisma.user.delete({ where: { id } });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function suspendUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({
      success: true,
      message: 'User suspended successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function activateUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    await prisma.user.update({
      where: { id },
      data: { isActive: true },
    });

    res.json({
      success: true,
      message: 'User activated successfully',
    });
  } catch (error) {
    next(error);
  }
}

// ==================== ANALYTICS ====================
export async function getAnalyticsOverview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { period = '7d' } = req.query;

    const days = period === '30d' ? 30 : period === '24h' ? 1 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [totalRequests, successCount, avgLatency, uniqueUsers] = await Promise.all([
      prisma.apiUsage.count({ where: { timestamp: { gte: startDate } } }),
      prisma.apiUsage.count({ where: { timestamp: { gte: startDate }, isError: false } }),
      prisma.apiUsage.aggregate({
        where: { timestamp: { gte: startDate } },
        _avg: { totalLatency: true },
      }),
      prisma.apiUsage.groupBy({
        by: ['userId'],
        where: { timestamp: { gte: startDate } },
      }),
    ]);

    const successRate = totalRequests > 0 ? (successCount / totalRequests) * 100 : 100;

    res.json({
      success: true,
      data: {
        period,
        totalRequests,
        successRate: Math.round(successRate * 100) / 100,
        avgLatency: Math.round(avgLatency._avg.totalLatency || 0),
        uniqueUsers: uniqueUsers.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getUsageAnalytics(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { period = '7d' } = req.query;
    const days = period === '30d' ? 30 : period === '24h' ? 1 : 7;

    // Get daily usage for the period
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usage = await prisma.apiUsage.groupBy({
      by: ['timestamp'],
      where: { timestamp: { gte: startDate } },
      _count: { id: true },
    });

    res.json({
      success: true,
      data: { usage, period },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPlatformAnalytics(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const platforms = await prisma.apiUsage.groupBy({
      by: ['platform'],
      _count: { platform: true },
      _avg: { totalLatency: true },
      orderBy: { _count: { platform: 'desc' } },
    });

    // Get success rate per platform
    const platformsWithSuccess = await Promise.all(
      platforms.map(async (p) => {
        const total = p._count.platform;
        const success = await prisma.apiUsage.count({
          where: { platform: p.platform, isError: false },
        });
        return {
          platform: p.platform,
          requests: total,
          avgLatency: Math.round(p._avg.totalLatency || 0),
          successRate: Math.round((success / total) * 100 * 100) / 100,
        };
      })
    );

    res.json({
      success: true,
      data: { platforms: platformsWithSuccess },
    });
  } catch (error) {
    next(error);
  }
}

export async function getGeographicAnalytics(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const countries = await prisma.apiUsage.groupBy({
      by: ['country'],
      _count: { country: true },
      where: { country: { not: null } },
      orderBy: { _count: { country: 'desc' } },
      take: 20,
    });

    res.json({
      success: true,
      data: {
        countries: countries.map((c) => ({
          country: c.country || 'Unknown',
          requests: c._count.country,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

// ==================== MONITORING ====================
export async function getLatencyMetrics(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const latencies = await prisma.apiUsage.findMany({
      select: { totalLatency: true, externalServiceLatency: true, platform: true },
      orderBy: { timestamp: 'desc' },
      take: 1000,
    });

    const values = latencies.map((l) => l.totalLatency).sort((a, b) => a - b);
    const len = values.length;

    const overall = {
      avg: len > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / len) : 0,
      p50: len > 0 ? values[Math.floor(len * 0.5)] : 0,
      p95: len > 0 ? values[Math.floor(len * 0.95)] : 0,
      p99: len > 0 ? values[Math.floor(len * 0.99)] : 0,
    };

    // By platform
    const byPlatform = await prisma.apiUsage.groupBy({
      by: ['platform'],
      _avg: { totalLatency: true, externalServiceLatency: true },
    });

    res.json({
      success: true,
      data: {
        overall,
        byPlatform: byPlatform.map((p) => ({
          platform: p.platform,
          avgTotal: Math.round(p._avg.totalLatency || 0),
          avgExternal: Math.round(p._avg.externalServiceLatency || 0),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getApiHealth(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const health = await prisma.apiHealth.findMany({
      orderBy: { platform: 'asc' },
    });

    res.json({
      success: true,
      data: { platforms: health },
    });
  } catch (error) {
    next(error);
  }
}

export async function getErrorMetrics(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalErrors, errorsByEndpoint, recentErrors] = await Promise.all([
      prisma.apiUsage.count({ where: { isError: true, timestamp: { gte: today } } }),
      prisma.apiUsage.groupBy({
        by: ['endpoint'],
        where: { isError: true, timestamp: { gte: today } },
        _count: { endpoint: true },
        orderBy: { _count: { endpoint: 'desc' } },
        take: 10,
      }),
      prisma.apiUsage.findMany({
        where: { isError: true },
        select: {
          endpoint: true,
          statusCode: true,
          errorMessage: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'desc' },
        take: 20,
      }),
    ]);

    const totalToday = await prisma.apiUsage.count({ where: { timestamp: { gte: today } } });
    const errorRate = totalToday > 0 ? (totalErrors / totalToday) * 100 : 0;

    res.json({
      success: true,
      data: {
        totalErrors,
        errorRate: Math.round(errorRate * 100) / 100,
        byEndpoint: errorsByEndpoint.map((e) => ({
          endpoint: e.endpoint,
          count: e._count.endpoint,
        })),
        recent: recentErrors,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ==================== LOGS ====================
export async function getLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { page = 1, limit = 50, userId, platform, status } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (userId) where.userId = userId;
    if (platform) where.platform = platform;
    if (status === 'success') where.isError = false;
    if (status === 'error') where.isError = true;

    const [logs, total] = await Promise.all([
      prisma.apiUsage.findMany({
        where,
        include: {
          user: { select: { email: true, name: true } },
          apiKey: { select: { name: true, keyPreview: true } },
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.apiUsage.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getRealtimeLogs(
  _req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial data
  const recentLogs = await prisma.apiUsage.findMany({
    include: {
      user: { select: { email: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  res.write(`data: ${JSON.stringify({ type: 'initial', logs: recentLogs })}\n\n`);

  // Keep connection alive
  const interval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  // Cleanup on close
  res.on('close', () => {
    clearInterval(interval);
    res.end();
  });
}


// ==================== PLAN CHANGE HISTORY ====================
export async function getPlanChangeHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (userId) where.userId = userId;

    const [history, total] = await Promise.all([
      prisma.planChangeHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.planChangeHistory.count({ where }),
    ]);

    // Get user info for each history entry
    const userIds = [...new Set(history.map(h => h.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, avatar: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const historyWithUsers = history.map(h => ({
      ...h,
      user: userMap.get(h.userId) || null,
    }));

    res.json({
      success: true,
      data: {
        history: historyWithUsers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}


// ==================== PLATFORM HEALTH MANAGEMENT ====================
export async function getDetailedHealth(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const platforms = await prisma.apiHealth.findMany({
      orderBy: { platform: 'asc' },
    });

    res.json({
      success: true,
      data: { platforms },
    });
  } catch (error) {
    next(error);
  }
}

export async function setPlatformMaintenance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { platform } = req.params;
    const { enabled } = req.body;

    const health = await prisma.apiHealth.findUnique({ where: { platform } });
    
    if (!health) {
      throw createError('Platform not found', 404, 'NOT_FOUND');
    }

    const updated = await prisma.apiHealth.update({
      where: { platform },
      data: {
        status: enabled ? 'MAINTENANCE' : 'HEALTHY',
        previousStatus: health.status,
        statusChangedAt: new Date(),
        // Reset counters when coming out of maintenance
        ...(!enabled && {
          consecutiveErrors: 0,
          successRate: 100,
        }),
      },
    });

    res.json({
      success: true,
      data: { platform: updated },
      message: enabled ? 'Platform set to maintenance mode' : 'Platform restored to healthy',
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPlatformHealth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { platform } = req.params;

    const updated = await prisma.apiHealth.update({
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

    res.json({
      success: true,
      data: { platform: updated },
      message: 'Platform health reset successfully',
    });
  } catch (error) {
    next(error);
  }
}


// ==================== SUBSCRIPTIONS ====================
export async function getSubscriptions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status) where.status = status;

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true, plan: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.subscription.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        subscriptions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getSubscriptionStats(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const [
      totalActive,
      totalInactive,
      byPlan,
      recentPayments,
    ] = await Promise.all([
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { status: 'INACTIVE' } }),
      prisma.user.groupBy({
        by: ['plan'],
        _count: { plan: true },
      }),
      prisma.planChangeHistory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalActive,
        totalInactive,
        byPlan: byPlan.map(p => ({
          plan: p.plan,
          count: p._count.plan,
        })),
        recentChanges: recentPayments,
      },
    });
  } catch (error) {
    next(error);
  }
}
