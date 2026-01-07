/**
 * Announcement Controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';

/**
 * Get active announcements (public endpoint)
 */
export async function getActiveAnnouncements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { target } = req.query;
    const now = new Date();

    const where: any = {
      isActive: true,
      startsAt: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    };

    // Filter by target
    if (target === 'public') {
      where.target = { in: ['PUBLIC', 'ALL'] };
    } else if (target === 'users') {
      where.target = { in: ['USERS', 'ALL'] };
    }

    const announcements = await prisma.announcement.findMany({
      where,
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        target: true,
        bgColor: true,
        textColor: true,
        dismissible: true,
        isPinned: true,
        startsAt: true,
        expiresAt: true,
      },
    });

    res.json({
      success: true,
      data: { announcements },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all announcements (admin)
 */
export async function getAllAnnouncements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { page = 1, limit = 20, active } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.announcement.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        announcements,
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
 * Create announcement (admin)
 */
export async function createAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminId = req.user!.id;
    const adminEmail = req.user!.email;
    const {
      title,
      message,
      type = 'INFO',
      target,
      bgColor,
      textColor,
      dismissible = true,
      isPinned = false,
      startsAt,
      expiresAt,
    } = req.body;

    if (!title || !message || !target) {
      throw createError('Title, message and target are required', 400, 'VALIDATION_ERROR');
    }

    if (!['PUBLIC', 'USERS', 'ALL'].includes(target)) {
      throw createError('Invalid target. Must be PUBLIC, USERS or ALL', 400, 'VALIDATION_ERROR');
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        message,
        type,
        target,
        bgColor,
        textColor,
        dismissible,
        isPinned,
        startsAt: startsAt ? new Date(startsAt) : new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: adminId,
        createdByEmail: adminEmail,
      },
    });

    res.status(201).json({
      success: true,
      data: { announcement },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update announcement (admin)
 */
export async function updateAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const {
      title,
      message,
      type,
      target,
      bgColor,
      textColor,
      isActive,
      dismissible,
      isPinned,
      startsAt,
      expiresAt,
    } = req.body;

    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(message && { message }),
        ...(type && { type }),
        ...(target && { target }),
        ...(bgColor !== undefined && { bgColor }),
        ...(textColor !== undefined && { textColor }),
        ...(typeof isActive === 'boolean' && { isActive }),
        ...(typeof dismissible === 'boolean' && { dismissible }),
        ...(typeof isPinned === 'boolean' && { isPinned }),
        ...(startsAt && { startsAt: new Date(startsAt) }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
      },
    });

    res.json({
      success: true,
      data: { announcement },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete announcement (admin)
 */
export async function deleteAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    await prisma.announcement.delete({ where: { id } });

    res.json({
      success: true,
      message: 'Announcement deleted',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Toggle announcement active status (admin)
 */
export async function toggleAnnouncement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const current = await prisma.announcement.findUnique({ where: { id } });
    if (!current) {
      throw createError('Announcement not found', 404, 'NOT_FOUND');
    }

    const announcement = await prisma.announcement.update({
      where: { id },
      data: { isActive: !current.isActive },
    });

    res.json({
      success: true,
      data: { announcement },
    });
  } catch (error) {
    next(error);
  }
}
