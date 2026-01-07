/**
 * API Key generation and hashing utilities
 * Author: NICE-DEV
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const API_KEY_PREFIX = process.env.API_KEY_PREFIX || 'nicedev';

/**
 * Generate a new API key
 * Format: {prefix}_{environment}_{randomString}
 * Example: nicedev_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 */
export function generateApiKey(environment: 'DEVELOPMENT' | 'PRODUCTION'): string {
  const envPrefix = environment === 'PRODUCTION' ? 'live' : 'dev';
  const randomPart = uuidv4().replace(/-/g, '') + crypto.randomBytes(8).toString('hex');
  return `${API_KEY_PREFIX}_${envPrefix}_${randomPart}`;
}

/**
 * Hash an API key for secure storage
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Create a preview of the API key for display
 * Shows first 15 and last 4 characters
 * Example: nicedev_live_a1b2...o5p6
 */
export function createKeyPreview(key: string): string {
  if (key.length <= 20) return key;
  return `${key.slice(0, 15)}...${key.slice(-4)}`;
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(key: string): boolean {
  const pattern = new RegExp(`^${API_KEY_PREFIX}_(live|dev)_[a-f0-9]{48}$`);
  return pattern.test(key);
}
