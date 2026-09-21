import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/http/app.js';
import type { Db } from '../src/infra/db.js';
import type { MediaDraft, Provider } from '../src/providers/types.js';
import { ADMIN_TOKEN, freshInfra, hasInfra, testConfig } from './infra.js';

// a valid 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe.skipIf(!hasInfra)('GET /v1/thumbnail (the gateway fetches the preview image)', () => {
  let db: Db;
  let redis: Redis;
  let server: Server;
  let base: string;
  let key: string;
  const apps: BuiltApp[] = [];
  const hits: Record<string, number> = {};

  const provider = (): Provider => ({
    id: 'fake',
    platform: 'tiktok',
    priority: 1,
    async fetch({ url }): Promise<MediaDraft> {
      const id = url.pathname.split('/').pop()!;
      const thumbs: Record<string, string | null> = {
        ok: `${base}/ok.png`, html: `${base}/page.html`, svg: `${base}/image.svg`, big: `${base}/big.png`,
        missing: `${base}/missing.png`, ssrf: `${base}/ok.png?ssrf`, redirect: `${base}/redir`, none: null, loop: `${base}/loop`,
      };
      return { title: id, author: null, thumbnail: thumbs[id] ?? null, durationSeconds: 1, variants: [{ kind: 'video', url: `${base}/v.mp4`, ext: 'mp4' }] };
    },
  });

  async function app(overrides: Record<string, string> = {}) {
    const built = await buildApp({ config: testConfig({ DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'true', ...overrides }), db, redis, providers: [provider()] });
    apps.push(built);
    return built.app;
  }
  const auth = () => ({ authorization: `Bearer ${key}` });
  const resolve = async (a: Awaited<ReturnType<typeof app>>, id: string) => {
    const res = await a.inject({ method: 'GET', url: `/v1/media?url=${encodeURIComponent(`https://www.tiktok.com/@u/video/${id}`)}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    return res.json().data.thumbnail as string | null;
  };
  const thumb = (a: Awaited<ReturnType<typeof app>>, url: string, headers: Record<string, string> = auth()) =>
    a.inject({ method: 'GET', url: `/v1/thumbnail?url=${encodeURIComponent(url)}`, headers });

  beforeAll(async () => {
    ({ db, redis } = await freshInfra());
    server = createServer((req, res) => {
      hits[req.url!] = (hits[req.url!] ?? 0) + 1;
      if (req.url === '/ok.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
      if (req.url === '/page.html') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<script>alert(1)</script>');
      if (req.url === '/image.svg') return void res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      if (req.url === '/big.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(5 * 1024 * 1024));
      if (req.url === '/redir') return void res.writeHead(302, { location: '/ok.png' }).end();
      if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const admin = await app();
    await admin.ready();
    const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const acc = (await admin.inject({ method: 'POST', url: '/admin/v1/accounts', headers, payload: { name: 'th', planId: 'enterprise' } })).json().data.id;
    key = (await admin.inject({ method: 'POST', url: `/admin/v1/accounts/${acc}/keys`, headers, payload: { label: 'k' } })).json().data.key;
  });

  afterAll(async () => {
    for (const b of apps) {
      await b.usage.stop();
      await b.app.close();
    }
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.end();
    redis.disconnect();
  });

  it('returns the image of a media that was just resolved, and caches it', async () => {
    const a = await app();
    const url = (await resolve(a, 'ok'))!;
    const first = await thumb(a, url);
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    expect(first.headers['x-thumbnail-cache']).toBe('miss');
    expect(Buffer.from(first.rawPayload).equals(PNG)).toBe(true);
    const second = await thumb(a, url);
    expect(second.headers['x-thumbnail-cache']).toBe('hit');
    expect(hits['/ok.png']).toBe(1); // the CDN was contacted once
  });

  it('is NOT an open image proxy: an address that was not returned by /v1/media is refused', async () => {
    const a = await app();
    for (const url of [`${base}/never-resolved.png`, 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'https://example.com/x.png']) {
      const res = await thumb(a, url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().code).toBe('not_found');
    }
  });

  it('requires an API key', async () => {
    const a = await app();
    expect((await thumb(a, `${base}/ok.png`, {})).statusCode).toBe(401);
  });

  it('refuses what is not a safe image: HTML, SVG, oversized, missing', async () => {
    const a = await app();
    for (const [id, why] of [['html', 'supported image type'], ['svg', 'supported image type'], ['big', 'too large'], ['missing', '404']] as const) {
      const url = (await resolve(a, id))!;
      const res = await thumb(a, url);
      expect(res.statusCode, id).toBe(502);
      expect(res.json().code).toBe('download_failed');
      expect(res.json().detail).toContain(why);
    }
  });

  it('follows a redirect and gives up on a redirect loop', async () => {
    const a = await app();
    const ok = await thumb(a, (await resolve(a, 'redirect'))!);
    expect(ok.statusCode).toBe(200);
    const loop = await thumb(a, (await resolve(a, 'loop'))!);
    expect(loop.statusCode).toBe(502);
    expect(loop.json().detail).toContain('redirects');
  });

  it('applies the SSRF guard: a thumbnail on a private address is refused', async () => {
    const a = await app({ DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'false' });
    const url = (await resolve(a, 'ssrf'))!; // points at 127.0.0.1
    const res = await thumb(a, url);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('blocked_url');
    expect(hits['/ok.png?ssrf']).toBeUndefined(); // the private host was never contacted
  });

  it('a media without a thumbnail simply has nothing to serve', async () => {
    const a = await app();
    expect(await resolve(a, 'none')).toBeNull();
  });
});
