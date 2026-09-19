import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { safeEqual } from './keys.js';

/**
 * Anonymous registration without e-mail: friction that is free for one person and expensive for a bot.
 *
 *  1. Proof of work. The server hands out a signed, stateless challenge; the client must find a nonce so that
 *     sha256(`${token}:${nonce}`) starts with `bits` zero bits. ~1-2 s on a laptop at 22 bits.
 *  2. Machine fingerprint (hashed with a server secret, never stored raw): one active account per machine.
 *  3. Per-IP throttling (in the route).
 *
 * None of these is a guarantee (a fingerprint can be forged, work can be bought): they raise the cost of
 * mass account creation while staying invisible to a real user.
 */

export interface PowChallenge {
  token: string;
  bits: number;
  expiresAt: string;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (pepper: string, payload: string) => createHmac('sha256', pepper).update(`pow:${payload}`).digest('base64url');

export function issueChallenge(pepper: string, bits: number, ttlSeconds = 300, nowMs = Date.now()): PowChallenge {
  const expires = nowMs + ttlSeconds * 1000;
  const payload = b64({ s: randomBytes(12).toString('base64url'), b: bits, e: expires });
  return { token: `${payload}.${sign(pepper, payload)}`, bits, expiresAt: new Date(expires).toISOString() };
}

export function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export type PowResult = { ok: true; id: string } | { ok: false; reason: 'malformed' | 'forged' | 'expired' | 'insufficient' };

/** Verify a solved challenge. `id` (the random salt) lets the caller refuse a replay. */
export function verifyPow(pepper: string, token: string, nonce: string, nowMs = Date.now()): PowResult {
  const [payload, mac] = token.split('.');
  if (!payload || !mac || nonce.length === 0 || nonce.length > 40) return { ok: false, reason: 'malformed' };
  if (!safeEqual(mac, sign(pepper, payload))) return { ok: false, reason: 'forged' };
  let claims: { s: string; b: number; e: number };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims.s || !Number.isInteger(claims.b) || !Number.isFinite(claims.e)) return { ok: false, reason: 'malformed' };
  if (claims.e < nowMs) return { ok: false, reason: 'expired' };
  const digest = createHash('sha256').update(`${token}:${nonce}`).digest();
  return leadingZeroBits(digest) >= claims.b ? { ok: true, id: claims.s } : { ok: false, reason: 'insufficient' };
}

/** Reference solver (the CLI has its own in Go); used by tests. */
export function solvePow(token: string, bits: number): string {
  for (let n = 0; ; n++) {
    if (leadingZeroBits(createHash('sha256').update(`${token}:${n}`).digest()) >= bits) return String(n);
  }
}

/** The client sends sha256(machine id); we never keep even that, only a keyed hash of it. */
export function hashDevice(pepper: string, clientHash: string): string {
  return createHmac('sha256', pepper).update(`device:${clientHash.toLowerCase()}`).digest('hex');
}

// ---- link codes ----------------------------------------------------------------------

/** No 0/O/1/I/L: a code read aloud or typed from a screen must survive a glance. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `K7QM-2XPD`: 8 symbols of a 31-letter alphabet, about 39.6 bits. Short-lived, single-use and rate-limited. */
export function generateLinkCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Accept lower case, spaces and missing dashes; reject anything that cannot be a code. */
export function normalizeLinkCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== 8 || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function linkCodeKey(code: string): string {
  return `link:${createHash('sha256').update(code).digest('hex')}`;
}
