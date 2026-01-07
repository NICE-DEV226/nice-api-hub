/**
 * User controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';

/**
 * Get current user profile
 */
export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
        _count: {
          select: { apiKeys: true },
        },
      },
    });

    if (!user) {
      throw createError('User not found', 404, 'NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          apiKeysCount: user._count.apiKeys,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update user profile
 */
export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { name } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        plan: true,
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

/**
 * Get usage statistics for current user
 */
export async function getUsageStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const plan = req.user!.plan;

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get this month's date range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Count requests
    const [totalRequests, requestsToday, requestsThisMonth] = await Promise.all([
      prisma.apiUsage.count({ where: { userId } }),
      prisma.apiUsage.count({
        where: {
          userId,
          timestamp: { gte: today, lt: tomorrow },
        },
      }),
      prisma.apiUsage.count({
        where: {
          userId,
          timestamp: { gte: monthStart, lt: monthEnd },
        },
      }),
    ]);

    // Calculate remaining quota based on plan
    const dailyLimits: Record<string, number> = {
      FREE: 100,
      BASIC: 1000,
      PRO: 10000,
      ENTERPRISE: -1, // unlimited
    };

    const dailyLimit = dailyLimits[plan] || 100;
    const remainingQuota = dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - requestsToday);

    res.json({
      success: true,
      data: {
        totalRequests,
        requestsToday,
        requestsThisMonth,
        dailyLimit,
        remainingQuota,
        plan,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get usage history
 */
export async function getUsageHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { page = 1, limit = 50, platform, status } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { userId };
    if (platform) where.platform = platform;
    if (status === 'success') where.isError = false;
    if (status === 'error') where.isError = true;

    const [history, total] = await Promise.all([
      prisma.apiUsage.findMany({
        where,
        select: {
          id: true,
          endpoint: true,
          platform: true,
          method: true,
          statusCode: true,
          totalLatency: true,
          isError: true,
          errorMessage: true,
          timestamp: true,
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
        history,
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


/**
 * Check account status (allows suspended users)
 */
export async function checkAccountStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        isActive: true,
        plan: true,
        role: true,
      },
    });

    if (!user) {
      throw createError('User not found', 404, 'NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        user,
        isSuspended: !user.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
}
