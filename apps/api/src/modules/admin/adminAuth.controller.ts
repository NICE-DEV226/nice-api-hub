/**
 * Admin Authentication Controller - PIN Security
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
export async function checkAdminPinStatus(
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
 * Set up admin PIN (first time)
 */
export async function setupAdminPin(
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

    // Validate PIN format (6 digits)
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw createError('Le PIN doit contenir exactement 6 chiffres', 400, 'INVALID_PIN_FORMAT');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, adminPin: true },
    });

    if (!user || user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    // If PIN already exists, use reset endpoint
    if (user.adminPin) {
      throw createError('PIN already configured. Use reset endpoint to change.', 400, 'PIN_ALREADY_EXISTS');
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
      message: 'PIN admin configuré avec succès',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Verify PIN and create admin session
 */
export async function verifyAdminPin(
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
      throw createError('Le PIN doit contenir exactement 6 chiffres', 400, 'INVALID_PIN_FORMAT');
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
      throw createError('PIN admin non configuré', 400, 'PIN_NOT_CONFIGURED');
    }

    // Check if locked out
    if (user.adminPinLockedUntil && new Date() < user.adminPinLockedUntil) {
      const remainingMinutes = Math.ceil(
        (user.adminPinLockedUntil.getTime() - Date.now()) / 60000
      );
      throw createError(
        `Compte verrouillé. Réessayez dans ${remainingMinutes} minutes`,
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
          `PIN incorrect. ${remainingAttempts} tentative(s) restante(s)`,
          401,
          'INVALID_PIN'
        );
      } else {
        throw createError(
          `Compte verrouillé pour ${LOCKOUT_DURATION_MINUTES} minutes`,
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
 * Reset admin PIN (requires current PIN)
 */
export async function resetAdminPin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { currentPin, newPin } = req.body;

    if (!userId) {
      throw createError('Authentication required', 401, 'UNAUTHORIZED');
    }

    if (!currentPin || !newPin) {
      throw createError('Current PIN and new PIN required', 400, 'MISSING_PINS');
    }

    if (!/^\d{6}$/.test(newPin)) {
      throw createError('Le nouveau PIN doit contenir exactement 6 chiffres', 400, 'INVALID_PIN_FORMAT');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, adminPin: true },
    });

    if (!user || user.role !== 'ADMIN') {
      throw createError('Admin access required', 403, 'FORBIDDEN');
    }

    if (!user.adminPin) {
      throw createError('PIN admin non configuré', 400, 'PIN_NOT_CONFIGURED');
    }

    // Verify current PIN
    if (hashPin(currentPin) !== user.adminPin) {
      throw createError('PIN actuel incorrect', 401, 'INVALID_CURRENT_PIN');
    }

    // Update to new PIN
    await prisma.user.update({
      where: { id: userId },
      data: {
        adminPin: hashPin(newPin),
        adminSessionToken: null, // Invalidate current session
        adminSessionExpiry: null,
      },
    });

    res.json({
      success: true,
      message: 'PIN admin modifié avec succès. Veuillez vous reconnecter.',
    });
  } catch (error) {
    next(error);
  }
}
