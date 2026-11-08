import { describe, expect, it } from 'vitest';
import { DOWNLOAD_GRANT_TTL_SECONDS, signDownloadGrant, verifyDownloadGrant, type DownloadGrant } from '../src/http/downloadToken.js';

const SECRET = 'test-secret-key-pepper-0123456789abcdef';

const grant = (over: Partial<DownloadGrant> = {}): DownloadGrant => ({
  keyId: 'k1',
  accountId: 'a1',
  url: 'https://www.tiktok.com/@u/video/1',
  kind: 'video',
  maxHeight: 720,
  exp: Math.floor(Date.now() / 1000) + DOWNLOAD_GRANT_TTL_SECONDS,
  ...over,
});

describe('download grants', () => {
  it('round-trips a signed grant', () => {
    const g = grant();
    const token = signDownloadGrant(SECRET, g);
    expect(verifyDownloadGrant(SECRET, token)).toEqual(g);
  });

  it('rejects a grant signed with another secret', () => {
    const token = signDownloadGrant('other-secret-other-secret-other-sec', grant());
    expect(verifyDownloadGrant(SECRET, token)).toBeNull();
  });

  it('rejects a tampered payload (different URL)', () => {
    const g = grant();
    const token = signDownloadGrant(SECRET, g);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...g, url: 'https://evil.example/x' })).toString('base64url');
    expect(verifyDownloadGrant(SECRET, `${forged}.${sig}`)).toBeNull();
    expect(verifyDownloadGrant(SECRET, `${payload}.AAAA`)).toBeNull();
  });

  it('rejects expired grants', () => {
    const token = signDownloadGrant(SECRET, grant({ exp: Math.floor(Date.now() / 1000) - 1 }));
    expect(verifyDownloadGrant(SECRET, token)).toBeNull();
  });

  it('rejects malformed tokens and missing fields', () => {
    for (const t of ['', 'abc', 'a.b.c', '.sig', 'payload.']) {
      expect(verifyDownloadGrant(SECRET, t)).toBeNull();
    }
    const noUrl = signDownloadGrant(SECRET, { ...grant(), url: '' });
    expect(verifyDownloadGrant(SECRET, noUrl)).toBeNull();
    const badKind = signDownloadGrant(SECRET, { ...grant(), kind: 'hologram' as never });
    expect(verifyDownloadGrant(SECRET, badKind)).toBeNull();
  });
});
