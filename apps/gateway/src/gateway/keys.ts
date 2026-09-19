import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export type KeyEnvironment = 'live' | 'test';

/** `nah_<env>_<32 url-safe chars>` = 192 bits of entropy. */
const KEY_PATTERN = /^nah_(live|test)_[A-Za-z0-9_-]{32}$/;

export function generateApiKey(environment: KeyEnvironment): { key: string; prefix: string } {
  const key = `nah_${environment}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: displayPrefix(key) };
}

/** Enough to recognise a key in a list, far too little to help guess it. */
export function displayPrefix(key: string): string {
  return key.slice(0, 13);
}

/** Cheap structural check so garbage never reaches Redis or Postgres. */
export function isWellFormedKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Keys are high-entropy random tokens, so a keyed hash (HMAC with a server-side pepper)
 * is the right tool: fast enough for the hot path, and useless to an attacker who
 * only has a database dump.
 */
export function hashApiKey(key: string, pepper: string): string {
  return createHmac('sha256', pepper).update(key).digest('hex');
}

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Pull the key from `Authorization: Bearer …` or `X-API-Key`. */
export function extractApiKey(headers: {
  authorization?: string | undefined;
  'x-api-key'?: string | string[] | undefined;
}): string | null {
  const auth = headers.authorization;
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    return match?.[1] ?? null;
  }
  const header = headers['x-api-key'];
  if (typeof header === 'string' && header.length > 0) return header;
  return null;
}
