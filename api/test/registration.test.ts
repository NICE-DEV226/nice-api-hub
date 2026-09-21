import { describe, expect, it } from 'vitest';
import { generateLinkCode, hashDevice, issueChallenge, leadingZeroBits, normalizeLinkCode, solvePow, verifyPow } from '../src/gateway/registration.js';

const pepper = 'p'.repeat(40);

describe('proof of work', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Buffer.from([0x40]))).toBe(1);
    expect(leadingZeroBits(Buffer.from([0x00, 0x0f]))).toBe(12);
    expect(leadingZeroBits(Buffer.from([0x00, 0x00, 0x00]))).toBe(24);
  });

  it('accepts a solved challenge once it is genuinely solved', () => {
    const c = issueChallenge(pepper, 12);
    const nonce = solvePow(c.token, 12);
    const r = verifyPow(pepper, c.token, nonce);
    expect(r.ok).toBe(true);
  });

  it('rejects an unsolved, forged, tampered or expired challenge', () => {
    const c = issueChallenge(pepper, 40); // effectively unsolvable, so '0' can never pass by luck
    expect(verifyPow(pepper, c.token, '0')).toMatchObject({ ok: false, reason: 'insufficient' });
    // a token signed with another secret
    const other = issueChallenge('q'.repeat(40), 1);
    expect(verifyPow(pepper, other.token, solvePow(other.token, 1))).toMatchObject({ ok: false, reason: 'forged' });
    // lowering the difficulty inside the payload breaks the signature
    const [payload, mac] = c.token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    const cheaper = Buffer.from(JSON.stringify({ ...claims, b: 1 })).toString('base64url');
    expect(verifyPow(pepper, `${cheaper}.${mac}`, '0')).toMatchObject({ ok: false, reason: 'forged' });
    // expiry
    const old = issueChallenge(pepper, 1, 10, Date.now() - 60_000);
    expect(verifyPow(pepper, old.token, solvePow(old.token, 1))).toMatchObject({ ok: false, reason: 'expired' });
    // garbage
    for (const bad of ['', 'x', 'a.b', '.']) expect(verifyPow(pepper, bad, '1').ok).toBe(false);
    expect(verifyPow(pepper, c.token, '').ok).toBe(false);
  });

  it('every challenge is unique (the salt is what blocks replays)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => {
      const c = issueChallenge(pepper, 1);
      const r = verifyPow(pepper, c.token, solvePow(c.token, 1));
      return r.ok ? r.id : 'bad';
    }));
    expect(ids.size).toBe(50);
  });
});

describe('device fingerprint', () => {
  const fp = 'a'.repeat(64);
  it('is keyed, deterministic, case-insensitive and never the raw value', () => {
    expect(hashDevice(pepper, fp)).toBe(hashDevice(pepper, fp.toUpperCase()));
    expect(hashDevice(pepper, fp)).not.toBe(hashDevice('q'.repeat(40), fp));
    expect(hashDevice(pepper, fp)).not.toContain(fp);
    expect(hashDevice(pepper, fp)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('link codes', () => {
  it('are short, unambiguous and well distributed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c = generateLinkCode();
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OIL]/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(295);
  });

  it('are forgiving about case, spaces and the dash, and strict about everything else', () => {
    expect(normalizeLinkCode('k7qm-2xpd')).toBe('K7QM-2XPD');
    expect(normalizeLinkCode(' k7qm 2xpd ')).toBe('K7QM-2XPD');
    expect(normalizeLinkCode('K7QM2XPD')).toBe('K7QM-2XPD');
    for (const bad of ['', 'K7QM', 'K7QM-2XPDD', 'K7QM-2XP0', 'K7QM-2XPI', '../../etc/passwd', 'K7QM-2XP!']) {
      expect(normalizeLinkCode(bad), bad).toBeNull();
    }
  });
});
