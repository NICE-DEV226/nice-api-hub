/**
 * Rating Controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';

/**
 * Submit or update rating (user)
 */
export async function submitRating(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { score, comment } = req.body;

    if (!score || score < 1 || score > 5) {
      throw createError('Score must be between 1 and 5', 400, 'VALIDATION_ERROR');
    }

    // Upsert - create or update
    const rating = await prisma.rating.upsert({
      where: { userId },
      create: {
        userId,
        score,
        comment,
        isApproved: false, // Needs admin approval
      },
      update: {
        score,
        comment,
        isApproved: false, // Re-approval needed after edit
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: { rating },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's rating
 */
export async function getUserRating(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const rating = await prisma.rating.findUnique({
      where: { userId },
    });

    res.json({
      success: true,
      data: { rating },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get public ratings for landing page (no auth required)
 */
export async function getPublicRatings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { limit = 10 } = req.query;
    const limitNum = Math.min(50, Math.max(1, Number(limit)));

    // Get approved public ratings
    const ratings = await prisma.rating.findMany({
      where: {
        isPublic: true,
        isApproved: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limitNum,
    });

    // Get user info
    const userIds = ratings.map(r => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const ratingsWithUser = ratings.map(r => ({
      id: r.id,
      score: r.score,
      comment: r.comment,
      createdAt: r.createdAt,
      user: userMap.get(r.userId) ? {
        name: userMap.get(r.userId)!.name,
        avatar: userMap.get(r.userId)!.avatar,
      } : null,
    }));

    // Calculate average
    const allRatings = await prisma.rating.findMany({
      where: { isPublic: true, isApproved: true },
      select: { score: true },
    });
    
    const avgScore = allRatings.length > 0
      ? allRatings.reduce((sum, r) => sum + r.score, 0) / allRatings.length
      : 0;

    res.json({
      success: true,
      data: {
        ratings: ratingsWithUser,
        stats: {
          average: Math.round(avgScore * 10) / 10,
          total: allRatings.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all ratings (admin)
 */
export async function getAllRatings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { approved, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (approved === 'true') where.isApproved = true;
    if (approved === 'false') where.isApproved = false;

    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.rating.count({ where }),
    ]);

    // Get user info
    const userIds = ratings.map(r => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, avatar: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const ratingsWithUser = ratings.map(r => ({
      ...r,
      user: userMap.get(r.userId) || null,
    }));

    res.json({
      success: true,
      data: {
        ratings: ratingsWithUser,
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
 * Approve/reject rating (admin)
 */
export async function moderateRating(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { isApproved, isPublic } = req.body;

    const rating = await prisma.rating.update({
      where: { id },
      data: {
        ...(typeof isApproved === 'boolean' && { isApproved }),
        ...(typeof isPublic === 'boolean' && { isPublic }),
      },
    });

    res.json({
      success: true,
      data: { rating },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete rating (admin)
 */
export async function deleteRating(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    await prisma.rating.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Rating deleted',
    });
  } catch (error) {
    next(error);
  }
}
