/**
 * Admin Security Controller - PIN Authentication
 * Author: NICE-DEV
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';
import crypto from 'crypto';

const MAX_PIN_ATTEMPTS = 3;
const LOCKOUT_DURATION_MINUTES = 15;
const ADMIN_SESSION_DURATION_HOURS = 1;

/**
 * Hash a PIN using SHA256
 */
function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

/**
 * Generate a secure session token
 */
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Check if admin has PIN set up
 */
export async function checkPinStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        adminPin: true,
        adminPinLockedUntil: true,
        adminSessionToken: true,
        adminSessionExpiry: true,
      },
    });

    if (!user || user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    // Check if locked out
    const isLocked = user.adminPinLockedUntil && new Date() < user.adminPinLockedUntil;

    // Check if has valid session
    const hasValidSession = user.adminSessionToken && 
      user.adminSessionExpiry && 
      new Date() < user.adminSessionExpiry;

    res.json({
      success: true,
      data: {
        hasPinSetup: !!user.adminPin,
        isLocked,
        lockoutEndsAt: isLocked ? user.adminPinLockedUntil : null,
        hasValidSession,
        sessionExpiresAt: hasValidSession ? user.adminSessionExpiry : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Set up admin PIN (first time or reset)
 */
export async function setupPin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { pin, currentPin } = req.body;

    if (!userId) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    // Validate PIN format (6 digits)
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw createError('PIN must be exactly 6 digits', 400, 'INVALID_PIN_FORMAT');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, adminPin: true },
    });

    if (!user || user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    // If PIN already exists, require current PIN to change
    if (user.adminPin) {
      if (!currentPin) {
        throw createError('Current PIN required to change PIN', 400, 'CURRENT_PIN_REQUIRED');
      }
      if (hashPin(currentPin) !== user.adminPin) {
        throw createError('Current PIN is incorrect', 400, 'INVALID_CURRENT_PIN');
      }
    }

    // Hash and save new PIN
    const hashedPin = hashPin(pin);
    await prisma.user.update({
      where: { id: userId },
      data: {
        adminPin: hashedPin,
        adminPinAttempts: 0,
        adminPinLockedUntil: null,
      },
    });

    res.json({
      success: true,
      message: 'Admin PIN configured successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Verify PIN and create admin session
 */
export async function verifyPin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { pin } = req.body;

    if (!userId) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    if (!pin || !/^\d{6}$/.test(pin)) {
      throw createError('PIN must be exactly 6 digits', 400, 'INVALID_PIN_FORMAT');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        adminPin: true,
        adminPinAttempts: true,
        adminPinLockedUntil: true,
      },
    });

    if (!user || user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    if (!user.adminPin) {
      throw createError('Admin PIN not configured', 400, 'PIN_NOT_CONFIGURED');
    }

    // Check if locked out
    if (user.adminPinLockedUntil && new Date() < user.adminPinLockedUntil) {
      const remainingMinutes = Math.ceil(
        (user.adminPinLockedUntil.getTime() - Date.now()) / 60000
      );
      throw createError(
        `Account locked. Try again in ${remainingMinutes} minutes`,
        429,
        'ACCOUNT_LOCKED'
      );
    }

    // Verify PIN
    const hashedPin = hashPin(pin);
    if (hashedPin !== user.adminPin) {
      // Increment failed attempts
      const newAttempts = user.adminPinAttempts + 1;
      const updateData: any = { adminPinAttempts: newAttempts };

      // Lock account if max attempts reached
      if (newAttempts >= MAX_PIN_ATTEMPTS) {
        updateData.adminPinLockedUntil = new Date(
          Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000
        );
        updateData.adminPinAttempts = 0;
      }

      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      const remainingAttempts = MAX_PIN_ATTEMPTS - newAttempts;
      if (remainingAttempts > 0) {
        throw createError(
          `Invalid PIN. ${remainingAttempts} attempts remaining`,
          401,
          'INVALID_PIN'
        );
      } else {
        throw createError(
          `Account locked for ${LOCKOUT_DURATION_MINUTES} minutes`,
          429,
          'ACCOUNT_LOCKED'
        );
      }
    }

    // PIN correct - create admin session
    const sessionToken = generateSessionToken();
    const sessionExpiry = new Date(
      Date.now() + ADMIN_SESSION_DURATION_HOURS * 60 * 60 * 1000
    );

    await prisma.user.update({
      where: { id: userId },
      data: {
        adminPinAttempts: 0,
        adminPinLockedUntil: null,
        adminSessionToken: sessionToken,
        adminSessionExpiry: sessionExpiry,
      },
    });

    res.json({
      success: true,
      data: {
        adminSessionToken: sessionToken,
        expiresAt: sessionExpiry,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Validate admin session token
 */
export async function validateSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const adminToken = req.headers['x-admin-token'] as string;

    if (!userId) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    if (!adminToken) {
      throw createError('Admin session token required', 401, 'ADMIN_TOKEN_REQUIRED');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        adminSessionToken: true,
        adminSessionExpiry: true,
      },
    });

    if (!user || user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    // Validate session
    if (
      !user.adminSessionToken ||
      user.adminSessionToken !== adminToken ||
      !user.adminSessionExpiry ||
      new Date() > user.adminSessionExpiry
    ) {
      throw createError('Invalid or expired admin session', 401, 'INVALID_ADMIN_SESSION');
    }

    res.json({
      success: true,
      data: {
        valid: true,
        expiresAt: user.adminSessionExpiry,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Logout admin session
 */
export async function logoutAdminSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        adminSessionToken: null,
        adminSessionExpiry: null,
      },
    });

    res.json({
      success: true,
      message: 'Admin session terminated',
    });
  } catch (error) {
    next(error);
  }
}
