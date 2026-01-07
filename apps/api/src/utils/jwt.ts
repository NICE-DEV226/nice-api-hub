/**
 * JWT Utilities
 * Author: NICE-DEV
 */

import jwt from 'jsonwebtoken';
import { UserInfo } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'nice-api-hub-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  plan: string;
}

/**
 * Generate JWT token for user
 */
export function generateToken(user: {
  id: string;
  email: string;
  role: string;
  plan: string;
}): string {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Generate refresh token (longer expiry)
 */
export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.type !== 'refresh') return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
