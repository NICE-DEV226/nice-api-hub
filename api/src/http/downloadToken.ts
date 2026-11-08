import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Download grants: a self-contained, HMAC-signed ticket that lets a browser fetch a file
 * without presenting an API key. Minted by POST /v1/download-links for an authenticated
 * caller; redeemed once by GET /v1/file before `exp`.
 *
 * The grant binds the exact download parameters, so a leaked link can only fetch that one
 * file within its TTL — it cannot be widened into arbitrary downloads.
 */
export interface DownloadGrant {
  keyId: string;
  accountId: string;
  url: string;
  kind: 'video' | 'audio';
  maxHeight?: number;
  audioFormat?: 'original' | 'mp3';
  /** Unix seconds. */
  exp: number;
}

export const DOWNLOAD_GRANT_TTL_SECONDS = 15 * 60;

export function signDownloadGrant(secret: string, grant: DownloadGrant): string {
  const payload = Buffer.from(JSON.stringify(grant), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Returns the grant, or null when the token is malformed, forged or expired. */
export function verifyDownloadGrant(secret: string, token: string, nowMs = Date.now()): DownloadGrant | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DownloadGrant;
    if (typeof grant.exp !== 'number' || grant.exp * 1000 <= nowMs) return null;
    if (!grant.keyId || !grant.accountId || typeof grant.url !== 'string' || grant.url.length === 0) return null;
    if (grant.kind !== 'video' && grant.kind !== 'audio') return null;
    return grant;
  } catch {
    return null;
  }
}
