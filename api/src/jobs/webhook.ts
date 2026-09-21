import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import { assertPublicHttpUrl } from '../download/urlGuard.js';

/**
 * Webhook signature, in the style customers already know from Stripe/GitHub:
 *
 *   X-NAH-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *
 * The timestamp is part of the signed payload, so a captured delivery cannot be replayed
 * outside the tolerance window.
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/** For receivers (and our own tests). Constant-time compare, rejects stale timestamps. */
export function verifyWebhook(secret: string, header: string, body: string, toleranceSeconds = 300, nowMs = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isFinite(t) || !sig || Math.abs(nowMs / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * POST a signed JSON event. The receiver URL is SSRF-checked at delivery time (not only at
 * submission), redirects are never followed, and the whole attempt has a hard timeout.
 */
export async function deliverWebhook(input: {
  url: string;
  secret: string;
  event: string;
  deliveryId: string;
  body: string;
  allowPrivateHosts: boolean;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<DeliveryResult> {
  try {
    const target = await assertPublicHttpUrl(input.url, input.allowPrivateHosts);
    const timestamp = Math.floor((input.nowMs ?? Date.now()) / 1000);
    const res = await fetch(target, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'nice-api-hub-webhooks/1',
        'x-nah-event': input.event,
        'x-nah-delivery': input.deliveryId,
        'x-nah-signature': signWebhook(input.secret, timestamp, input.body),
      },
      body: input.body,
    });
    await res.body?.cancel().catch(() => {});
    return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `receiver answered HTTP ${res.status}` };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.code };
    const name = (error as Error).name;
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connection failed' };
  }
}
