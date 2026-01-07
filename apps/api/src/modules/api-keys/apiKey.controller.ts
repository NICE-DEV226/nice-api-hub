/**
 * API Key controller
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { generateApiKey, hashApiKey, createKeyPreview } from '../../utils/apiKey.js';
import { createError } from '../../middleware/errorHandler.js';

/**
 * List all API keys for current user
 */
export async function listApiKeys(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        keyPreview: true,
        environment: true,
        isActive: true,
        permissions: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: { apiKeys },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new API key
 */
export async function createApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { name, environment = 'DEVELOPMENT', permissions = [] } = req.body;

    if (!name || typeof name !== 'string') {
      throw createError('Name is required', 400, 'MISSING_NAME');
    }

    // Check API key limit (e.g., max 5 keys per user)
    const existingCount = await prisma.apiKey.count({
      where: { userId },
    });

    if (existingCount >= 10) {
      throw createError('Maximum API keys limit reached (10)', 400, 'KEY_LIMIT_REACHED');
    }

    // Generate the key
    const rawKey = generateApiKey(environment);
    const hashedKey = hashApiKey(rawKey);
    const keyPreview = createKeyPreview(rawKey);

    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        name,
        key: hashedKey,
        keyPreview,
        environment,
        permissions,
      },
      select: {
        id: true,
        name: true,
        keyPreview: true,
        environment: true,
        isActive: true,
        permissions: true,
        createdAt: true,
      },
    });

    // Return the raw key ONLY on creation (won't be shown again)
    res.status(201).json({
      success: true,
      data: {
        apiKey: {
          ...apiKey,
          key: rawKey, // Only returned once!
        },
        warning: 'Save this key securely. It will not be shown again.',
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a specific API key
 */
export async function getApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const apiKey = await prisma.apiKey.findFirst({
      where: { id, userId },
      select: {
        id: true,
        name: true,
        keyPreview: true,
        environment: true,
        isActive: true,
        permissions: true,
        customRateLimit: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        _count: {
          select: { apiUsage: true },
        },
      },
    });

    if (!apiKey) {
      throw createError('API key not found', 404, 'NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        apiKey: {
          ...apiKey,
          totalRequests: apiKey._count.apiUsage,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an API key
 */
export async function updateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, permissions, isActive } = req.body;

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw createError('API key not found', 404, 'NOT_FOUND');
    }

    const apiKey = await prisma.apiKey.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(permissions && { permissions }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
      select: {
        id: true,
        name: true,
        keyPreview: true,
        environment: true,
        isActive: true,
        permissions: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    res.json({
      success: true,
      data: { apiKey },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw createError('API key not found', 404, 'NOT_FOUND');
    }

    await prisma.apiKey.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'API key deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Regenerate an API key (creates new key, keeps settings)
 */
export async function regenerateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw createError('API key not found', 404, 'NOT_FOUND');
    }

    // Generate new key
    const rawKey = generateApiKey(existing.environment);
    const hashedKey = hashApiKey(rawKey);
    const keyPreview = createKeyPreview(rawKey);

    const apiKey = await prisma.apiKey.update({
      where: { id },
      data: {
        key: hashedKey,
        keyPreview,
        lastUsedAt: null,
      },
      select: {
        id: true,
        name: true,
        keyPreview: true,
        environment: true,
        isActive: true,
        permissions: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      data: {
        apiKey: {
          ...apiKey,
          key: rawKey, // Only returned once!
        },
        warning: 'Save this key securely. It will not be shown again.',
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Revoke an API key (soft delete - just deactivate)
 */
export async function revokeApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw createError('API key not found', 404, 'NOT_FOUND');
    }

    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    next(error);
  }
}
