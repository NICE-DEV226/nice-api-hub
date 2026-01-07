/**
 * Feedback Controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';

/**
 * Submit feedback (user)
 */
export async function submitFeedback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { type, subject, message } = req.body;

    if (!type || !subject || !message) {
      throw createError('Type, subject and message are required', 400, 'VALIDATION_ERROR');
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId,
        type,
        subject,
        message,
      },
    });

    res.status(201).json({
      success: true,
      data: { feedback },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's feedbacks
 */
export async function getUserFeedbacks(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const feedbacks = await prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: { feedbacks },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all feedbacks (admin)
 */
export async function getAllFeedbacks(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.feedback.count({ where }),
    ]);

    // Get user info for each feedback
    const userIds = [...new Set(feedbacks.map(f => f.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, avatar: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const feedbacksWithUser = feedbacks.map(f => ({
      ...f,
      user: userMap.get(f.userId) || null,
    }));

    res.json({
      success: true,
      data: {
        feedbacks: feedbacksWithUser,
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
 * Update feedback status (admin)
 */
export async function updateFeedbackStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { status, adminResponse } = req.body;

    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        status,
        ...(adminResponse && { adminResponse, respondedAt: new Date() }),
      },
    });

    res.json({
      success: true,
      data: { feedback },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get feedback stats (admin)
 */
export async function getFeedbackStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const [total, pending, byType] = await Promise.all([
      prisma.feedback.count(),
      prisma.feedback.count({ where: { status: 'PENDING' } }),
      prisma.feedback.groupBy({
        by: ['type'],
        _count: true,
      }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        pending,
        byType: byType.reduce((acc, item) => {
          acc[item.type] = item._count;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (error) {
    next(error);
  }
}
