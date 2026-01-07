/**
 * Authentication controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';
import { generateToken, generateRefreshToken, verifyRefreshToken, verifyToken } from '../../utils/jwt.js';
import { logger } from '../../utils/logger.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Initiate Google OAuth flow
 */
export function googleAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })(req, res, next);
}

/**
 * Handle Google OAuth callback
 */
export function googleCallback(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  passport.authenticate('google', { session: false }, (err: any, user: any) => {
    if (err) {
      logger.error('Google OAuth error:', err);
      return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }

    if (!user) {
      return res.redirect(`${FRONTEND_URL}/login?error=no_user`);
    }

    // Generate tokens
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user.id);

    // Redirect to frontend with tokens
    res.redirect(
      `${FRONTEND_URL}/auth/callback?token=${accessToken}&refresh=${refreshToken}`
    );
  })(req, res, next);
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('Missing or invalid authorization header', 401, 'UNAUTHORIZED');
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
      throw createError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      throw createError('Account is suspended', 403, 'ACCOUNT_SUSPENDED');
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
 * Logout - client should discard tokens
 */
export async function logout(
  _req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  // JWT tokens are stateless, so we just tell client to discard them
  // In production, you might want to blacklist the token
  res.json({
    success: true,
    message: 'Logged out successfully. Please discard your tokens.',
  });
}

/**
 * Refresh access token using refresh token
 */
export async function refreshToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      throw createError('Refresh token is required', 400, 'MISSING_REFRESH_TOKEN');
    }

    const payload = verifyRefreshToken(token);

    if (!payload) {
      throw createError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || !user.isActive) {
      throw createError('User not found or inactive', 401, 'USER_INVALID');
    }

    // Generate new tokens
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user.id);

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
}
