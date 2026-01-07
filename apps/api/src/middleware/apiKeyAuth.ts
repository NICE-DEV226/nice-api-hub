/**
 * API Key Authentication Middleware
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { hashApiKey } from '../utils/apiKey.js';
import { createError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        userId: string;
        name: string;
        environment: string;
        permissions: string[];
      };
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        plan: string;
      };
    }
  }
}

/**
 * Middleware to authenticate requests using API key
 * Expects header: Authorization: Bearer nicedev_xxx_xxx
 */
export async function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw createError('Missing Authorization header', 401, 'MISSING_AUTH');
    }

    const [scheme, key] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !key) {
      throw createError('Invalid Authorization format. Use: Bearer <api_key>', 401, 'INVALID_AUTH_FORMAT');
    }

    // Hash the key to compare with stored hash
    const hashedKey = hashApiKey(key);

    // Find API key in database
    const apiKey = await prisma.apiKey.findUnique({
      where: { key: hashedKey },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            plan: true,
            isActive: true,
          },
        },
      },
    });

    if (!apiKey) {
      throw createError('Invalid API key', 401, 'INVALID_API_KEY');
    }

    if (!apiKey.isActive) {
      throw createError('API key has been revoked', 401, 'API_KEY_REVOKED');
    }

    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      throw createError('API key has expired', 401, 'API_KEY_EXPIRED');
    }

    if (!apiKey.user.isActive) {
      throw createError('User account is suspended', 403, 'USER_SUSPENDED');
    }

    // Attach API key and user info to request
    req.apiKey = {
      id: apiKey.id,
      userId: apiKey.userId,
      name: apiKey.name,
      environment: apiKey.environment,
      permissions: apiKey.permissions,
    };

    req.user = {
      id: apiKey.user.id,
      email: apiKey.user.email,
      name: apiKey.user.name,
      role: apiKey.user.role,
      plan: apiKey.user.plan,
    };

    // Update last used timestamp (async, don't wait)
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch((err) => {
      logger.error('Failed to update API key lastUsedAt:', err);
    });

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Check if API key has permission for a specific platform
 */
export function checkPlatformPermission(platform: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const permissions = req.apiKey?.permissions || [];

    // Empty array or ['*'] means all platforms allowed
    if (permissions.length === 0 || permissions.includes('*')) {
      return next();
    }

    if (!permissions.includes(platform)) {
      return next(
        createError(
          `API key does not have permission for ${platform}`,
          403,
          'PERMISSION_DENIED'
        )
      );
    }

    next();
  };
}
