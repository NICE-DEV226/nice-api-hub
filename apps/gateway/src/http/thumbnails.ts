import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { assertPublicHttpUrl } from '../download/urlGuard.js';
import { errors } from '../errors.js';

/**
 * Thumbnail proxy: `GET /v1/thumbnail?url=` returns the preview image of a media that was just resolved.
 *
 * Why the gateway fetches it instead of the client:
 *  - the client's address is not shown to third-party CDNs;
 *  - CDNs that check Referer or user agent are handled in one place;
 *  - a client whose own DNS is slow or broken still gets a preview.
 *
 * It is NOT an open image proxy: only URLs that came out of a `/v1/media` answer within the last hour are served
 * (remembered in Redis), so it cannot be used to fetch arbitrary addresses, and every hop is checked against the SSRF guard.
 */

const ALLOW_TTL_SECONDS = 3600;
const IMAGE_TTL_SECONDS = 900;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_BYTES = 1024 * 1024;
/** Formats every client can decode. SVG is refused on purpose: it can carry script. */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const digest = (url: string) => createHash('sha256').update(url).digest('hex');
const allowKey = (url: string) => `thumb:ok:${digest(url)}`;
const imageKey = (url: string) => `thumb:img:${digest(url)}`;

/** Called for every media answer: remembers that this thumbnail may be fetched. Never throws. */
export async function rememberThumbnail(redis: Redis, url: string | null | undefined): Promise<void> {
  if (!url) return;
  await redis.set(allowKey(url), '1', 'EX', ALLOW_TTL_SECONDS).catch(() => {});
}

export interface Thumbnail {
  type: string;
  body: Buffer;
  cached: boolean;
}

export interface ThumbnailOptions {
  allowPrivateHosts: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function readCapped(res: Response, limit: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > limit) throw errors.downloadFailed('The thumbnail is too large.');
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw errors.downloadFailed('The thumbnail is too large.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
// readcapter  function for devs with caption .

export async function loadThumbnail(redis: Redis, url: string, opts: ThumbnailOptions): Promise<Thumbnail> {
  if (!(await redis.exists(allowKey(url)).catch(() => 0))) {
    throw errors.notFound('Unknown thumbnail. Resolve the media with /v1/media first.');
  }
  const hit = await redis.getBuffer(imageKey(url)).catch(() => null);
  if (hit && hit.length > 1) {
    const sep = hit.indexOf(0x0a);
    return { type: hit.subarray(0, sep).toString('utf8'), body: hit.subarray(sep + 1), cached: true };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 8000);
  let current = await assertPublicHttpUrl(url, opts.allowPrivateHosts);
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await doFetch(current, {
        redirect: 'manual',
        signal,
        headers: { accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8', 'user-agent': 'Mozilla/5.0 (compatible; nice-api-hub-thumbnail)' },
      });
    } catch {
      throw errors.downloadFailed('The thumbnail could not be fetched.');
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = await assertPublicHttpUrl(new URL(location, current).toString(), opts.allowPrivateHosts);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw errors.downloadFailed(`The thumbnail host answered ${res.status}.`);
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
      await res.body?.cancel().catch(() => {});
      throw errors.downloadFailed('The thumbnail is not a supported image type.');
    }
    const body = await readCapped(res, MAX_BYTES);
    if (body.length <= MAX_CACHED_BYTES) {
      await redis.set(imageKey(url), Buffer.concat([Buffer.from(`${type}\n`), body]), 'EX', IMAGE_TTL_SECONDS).catch(() => {});
    }
    return { type, body, cached: false };
  }
  throw errors.downloadFailed('Too many redirects from the thumbnail host.');
}
