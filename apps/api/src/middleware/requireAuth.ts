/**
 * Authentication middleware for protected routes
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../utils/jwt.js';
import { createError } from './errorHandler.js';

/**
 * Require valid JWT token for route access
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);

    if (!payload) {
      throw createError('Invalid or expired token', 401, 'INVALID_TOKEN');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        isActive: true,
      },
    });

    if (!user) {
      throw createError('User not found', 401, 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      throw createError('Account is suspended', 403, 'ACCOUNT_SUSPENDED');
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require valid JWT but allow suspended users (for status check)
 */
export async function requireAuthAllowSuspended(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);

    if (!payload) {
      throw createError('Invalid or expired token', 401, 'INVALID_TOKEN');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        isActive: true,
      },
    });

    if (!user) {
      throw createError('User not found', 401, 'USER_NOT_FOUND');
    }

    // Attach user to request (even if suspended)
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require admin role
 */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    if (req.user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require valid admin session (PIN verified)
 */
export async function requireAdminSession(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Check for admin session token in header
    const adminToken = req.headers['x-admin-token'] as string;

    if (!adminToken) {
      throw createError('Session admin requise. Veuillez vérifier votre PIN.', 401, 'ADMIN_SESSION_REQUIRED');
    }

    // Verify admin session token from database
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        adminSessionToken: true,
        adminSessionExpiry: true,
      },
    });

    if (!user) {
      throw createError('User not found', 401, 'USER_NOT_FOUND');
    }

    // Check if session token matches
    if (!user.adminSessionToken || user.adminSessionToken !== adminToken) {
      throw createError('Session admin invalide', 401, 'INVALID_ADMIN_SESSION');
    }

    // Check if session has expired
    if (!user.adminSessionExpiry || new Date() > user.adminSessionExpiry) {
      throw createError('Session admin expirée. Veuillez vous reconnecter.', 401, 'ADMIN_SESSION_EXPIRED');
    }

    next();
  } catch (error) {
    next(error);
  }
}
