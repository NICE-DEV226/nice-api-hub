import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/http/app.js';
import type { Db } from '../src/infra/db.js';
import type { MediaDraft, Provider } from '../src/providers/types.js';
import { ADMIN_TOKEN, freshInfra, hasInfra, testConfig } from './infra.js';

const run = promisify(execFile);
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasInfra || !hasFfmpeg)('GET /v1/download (real ffmpeg, real streams)', () => {
  let db: Db;
  let redis: Redis;
  let server: Server;
  let base: string;
  let files: { video: Buffer; audio: Buffer; complete: Buffer };
  const apps: BuiltApp[] = [];
  let key: string;
  const requests: string[] = [];

  const tiktok = (id: string) => `https://www.tiktok.com/@u/video/${id}`;

  function providerFor(baseUrl: string): Provider {
    return {
      id: 'fake-media',
      platform: 'tiktok',
      priority: 1,
      async fetch({ url }): Promise<MediaDraft> {
        const id = url.pathname.split('/').pop();
        const variants: MediaDraft['variants'] =
          id === '1' // YouTube-like: separate video-only and audio-only
            ? [
                { kind: 'video', url: `${baseUrl}/v.mp4`, ext: 'mp4', codec: 'avc1', height: 240, hasAudio: false, protocol: 'direct', id: 'v' },
                { kind: 'audio', url: `${baseUrl}/a.m4a`, ext: 'm4a', codec: 'mp4a', bitrateKbps: 128, protocol: 'direct', id: 'a' },
              ]
            : id === '2' // complete progressive file
              ? [{ kind: 'video', url: `${baseUrl}/av.mp4`, ext: 'mp4', codec: 'avc1', height: 240, hasAudio: true, protocol: 'direct', id: 'av' }]
              : id === '5' // server that ignores Range
                ? [{ kind: 'video', url: `${baseUrl}/norange-av.mp4`, ext: 'mp4', codec: 'avc1', height: 240, hasAudio: true, protocol: 'direct', id: 'nr' }]
              : id === '3' // slow, never-ending body
                ? [{ kind: 'video', url: `${baseUrl}/slow.mp4`, ext: 'mp4', height: 240, hasAudio: true, protocol: 'direct', id: 's' }]
                : [{ kind: 'video', url: `${baseUrl}/big.mp4`, ext: 'mp4', height: 240, hasAudio: true, protocol: 'direct', id: 'b' }]; // 3 MB, no content-length
        return { title: 'Test / clip "one"', author: null, thumbnail: null, durationSeconds: 2, variants };
      },
    };
  }

  async function app(overrides: Record<string, string> = {}, providers?: Provider[]): Promise<FastifyInstance> {
    const built = await buildApp({
      config: testConfig({ DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'true', ...overrides }),
      db,
      redis,
      providers: providers ?? [providerFor(base)],
    });
    apps.push(built);
    return built.app;
  }

  const probe = async (file: string) =>
    JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).stdout) as {
      streams: Array<{ codec_type: string; codec_name: string }>;
      format: { duration: string };
    };

  beforeAll(async () => {
    ({ db, redis } = await freshInfra());
    const dir = mkdtempSync(join(tmpdir(), 'nah-dl-'));
    const ff = (...args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', 'frag_keyframe+empty_moov', join(dir, 'v.mp4'));
    ff('-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', join(dir, 'a.m4a'));
    ff('-i', join(dir, 'v.mp4'), '-i', join(dir, 'a.m4a'), '-c', 'copy', join(dir, 'av.mp4'));
    files = { video: readFileSync(join(dir, 'v.mp4')), audio: readFileSync(join(dir, 'a.m4a')), complete: readFileSync(join(dir, 'av.mp4')) };

    server = createServer((req, res) => {
      // Honours `Range` like a real CDN (206 + Content-Range); `ignoreRange` mimics servers that don't.
      const send = (buf: Buffer, type: string, ignoreRange = false) => {
        const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
        requests.push(String(req.headers.range ?? '-'));
        if (m && !ignoreRange) {
          const start = Number(m[1]);
          if (start >= buf.length) return void res.writeHead(416, { 'content-range': `bytes */${buf.length}` }).end();
          const end = Math.min(m[2] ? Number(m[2]) : buf.length - 1, buf.length - 1);
          res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${buf.length}` });
          return void res.end(buf.subarray(start, end + 1));
        }
        res.writeHead(200, { 'content-type': type, 'content-length': buf.length });
        res.end(buf);
      };
      if (req.url === '/v.mp4') return send(files.video, 'video/mp4');
      if (req.url === '/a.m4a') return send(files.audio, 'audio/mp4');
      if (req.url === '/av.mp4') return send(files.complete, 'video/mp4');
      if (req.url === '/norange-av.mp4') return send(files.complete, 'video/mp4', true);
      if (req.url === '/slow.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        const t = setInterval(() => res.write(Buffer.alloc(1024)), 50);
        res.on('close', () => clearInterval(t));
        return;
      }
      if (req.url === '/big.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' }); // chunked: no content-length
        const chunk = Buffer.alloc(64 * 1024);
        let sent = 0;
        const t = setInterval(() => {
          for (let i = 0; i < 8 && sent < 3 * 1024 * 1024; i++) {
            res.write(chunk);
            sent += chunk.length;
          }
          if (sent >= 3 * 1024 * 1024) {
            clearInterval(t);
            res.end();
          }
        }, 5);
        res.on('close', () => clearInterval(t));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const admin = await app();
    await admin.ready();
    const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const acc = (await admin.inject({ method: 'POST', url: '/admin/v1/accounts', headers, payload: { name: 'dl', planId: 'enterprise' } })).json().data.id;
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

  const get = (a: FastifyInstance, id: string, qs = '') =>
    a.inject({ method: 'GET', url: `/v1/download?url=${encodeURIComponent(tiktok(id))}${qs}`, headers: { authorization: `Bearer ${key}` } });

  it('merges separate video-only and audio-only tracks into ONE playable MP4', async () => {
    const a = await app();
    const res = await get(a, '1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Test clip one\.mp4"; filename\*=UTF-8''Test%20clip%20one\.mp4$/);
    expect(res.headers['x-download-provider']).toBe('fake-media');

    const out = join(mkdtempSync(join(tmpdir(), 'nah-out-')), 'merged.mp4');
    writeFileSync(out, res.rawPayload);
    const info = await probe(out);
    const types = info.streams.map((s) => `${s.codec_type}:${s.codec_name}`).sort();
    expect(types).toEqual(['audio:aac', 'video:h264']);
    expect(Number(info.format.duration)).toBeGreaterThan(1.5);
  });

  it('proxies a complete file byte-for-byte, with its content-length', async () => {
    const res = await get(await app(), '2');
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.rawPayload, files.complete)).toBe(0);
    expect(res.headers['content-length']).toBe(String(files.complete.length));
  });

  it('downloads in Range chunks and copes with servers that ignore Range', async () => {
    requests.length = 0;
    const ranged = await get(await app(), '2');
    expect(requests.some((r) => r.startsWith('bytes=0-'))).toBe(true); // asked for a range first
    expect(Buffer.compare(ranged.rawPayload, files.complete)).toBe(0);

    const plain = await get(await app(), '5');
    expect(plain.statusCode).toBe(200);
    expect(Buffer.compare(plain.rawPayload, files.complete)).toBe(0); // 200 answer streamed whole
  });

  it('extracts MP3 audio (transcode) and serves the original audio as-is', async () => {
    const a = await app();
    const mp3 = await get(a, '1', '&kind=audio&audioFormat=mp3');
    expect(mp3.statusCode).toBe(200);
    expect(mp3.headers['content-type']).toBe('audio/mpeg');
    expect(mp3.headers['content-disposition']).toContain('.mp3');
    const out = join(mkdtempSync(join(tmpdir(), 'nah-out-')), 'a.mp3');
    writeFileSync(out, mp3.rawPayload);
    expect((await probe(out)).streams.map((s) => s.codec_name)).toEqual(['mp3']);

    const original = await get(a, '1', '&kind=audio');
    expect(Buffer.compare(original.rawPayload, files.audio)).toBe(0);
  });

  it('answers with a clear 422 when the request cannot be satisfied', async () => {
    const res = await get(await app(), '1', '&maxHeight=10');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'no_such_media' });
  });

  it('refuses private/loopback media hosts unless explicitly allowed (SSRF guard)', async () => {
    const guarded = await app({ DOWNLOAD_ALLOW_PRIVATE_HOSTS: 'false' });
    const res = await get(guarded, '2');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'blocked_url' });
  });

  it('caps the size of what it will stream', async () => {
    const a = await app({ DOWNLOAD_MAX_BYTES: '1048576' });
    await a.listen({ port: 0, host: '127.0.0.1' });
    const port = (a.server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/download?url=${encodeURIComponent(tiktok('4'))}`, { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    let received = 0;
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
      }
    } catch {
      // aborted by the server: expected
    }
    expect(received).toBeLessThanOrEqual(1_048_576 + 65_536);
    expect(received).toBeLessThan(3 * 1024 * 1024);
  });

  it('limits concurrent transfers (503 + Retry-After) and frees the slot when the client leaves', async () => {
    const a = await app({ DOWNLOAD_MAX_CONCURRENCY: '1' });
    await a.listen({ port: 0, host: '127.0.0.1' });
    const port = (a.server.address() as AddressInfo).port;
    const url = (id: string) => `http://127.0.0.1:${port}/v1/download?url=${encodeURIComponent(tiktok(id))}`;
    const headers = { authorization: `Bearer ${key}` };

    const controller = new AbortController();
    const first = await fetch(url('3'), { headers, signal: controller.signal });
    expect(first.status).toBe(200); // headers arrived, body keeps trickling

    const second = await fetch(url('2'), { headers });
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBeTruthy();
    expect(((await second.json()) as { code: string }).code).toBe('overloaded');

    controller.abort();
    let status = 0;
    for (let i = 0; i < 30 && status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const again = await fetch(url('2'), { headers });
      status = again.status;
      await again.arrayBuffer();
    }
    expect(status).toBe(200);
  });
});
