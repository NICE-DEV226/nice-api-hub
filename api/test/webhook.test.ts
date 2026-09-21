import { describe, expect, it } from 'vitest';
import { deliverWebhook, signWebhook, verifyWebhook } from '../src/jobs/webhook.js';

const secret = 's'.repeat(64);
const body = JSON.stringify({ event: 'job.completed', data: { id: 'job_1' } });

describe('webhook signatures', () => {
  const now = 1_800_000_000_000;
  const header = signWebhook(secret, now / 1000, body);

  it('round-trips', () => {
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook(secret, header, body, 300, now)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and malformed headers', () => {
    expect(verifyWebhook(secret, header, body + ' ', 300, now)).toBe(false);
    expect(verifyWebhook('x'.repeat(64), header, body, 300, now)).toBe(false);
    for (const bad of ['', 'garbage', 't=abc,v1=00', `t=${now / 1000}`, `t=${now / 1000},v1=zz`]) {
      expect(verifyWebhook(secret, bad, body, 300, now), bad).toBe(false);
    }
  });

  it('rejects replays outside the tolerance window, in both directions', () => {
    expect(verifyWebhook(secret, header, body, 300, now + 301_000)).toBe(false);
    expect(verifyWebhook(secret, header, body, 300, now - 301_000)).toBe(false);
    expect(verifyWebhook(secret, header, body, 300, now + 299_000)).toBe(true);
  });

  it('binds the timestamp into the signature (cannot re-stamp an old delivery)', () => {
    const old = signWebhook(secret, now / 1000 - 3600, body);
    const restamped = old.replace(/^t=\d+/, `t=${now / 1000}`);
    expect(verifyWebhook(secret, restamped, body, 300, now)).toBe(false);
  });
});

describe('deliverWebhook guard rails', () => {
  it('refuses private targets before any connection is made', async () => {
    for (const url of ['http://127.0.0.1:1/hook', 'http://169.254.169.254/latest', 'http://localhost/x', 'file:///etc/passwd']) {
      const r = await deliverWebhook({ url, secret, event: 'e', deliveryId: 'd', body: '{}', allowPrivateHosts: false });
      expect(r, url).toEqual({ ok: false, error: 'blocked_url' });
    }
  });

  it('reports connection failures without throwing', async () => {
    const r = await deliverWebhook({ url: 'http://127.0.0.1:1/hook', secret, event: 'e', deliveryId: 'd', body: '{}', allowPrivateHosts: true, timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
