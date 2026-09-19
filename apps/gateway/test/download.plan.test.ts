import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planDownload } from '../src/download/plan.js';
import { isPrivateAddress, assertPublicHttpUrl } from '../src/download/urlGuard.js';
import { ffmpegArgs, contentDisposition, safeFilename, SlotLimiter } from '../src/download/stream.js';
import { mapYtDlpInfo, type YtDlpInfo } from '../src/providers/impl/ytdlp.js';

const media = (name: string) =>
  mapYtDlpInfo(JSON.parse(readFileSync(new URL(`./fixtures/ytdlp-${name}.json`, import.meta.url), 'utf8')) as YtDlpInfo);

describe('planDownload — real YouTube renditions (video-only + audio-only)', () => {
  const yt = media('youtube').variants;

  it('merges the best H.264 video with AAC audio into MP4 by default', () => {
    const plan = planDownload(yt, { kind: 'video' });
    expect(plan.inputs).toHaveLength(2);
    expect(plan.inputs[0]!.kind).toBe('video');
    expect(plan.inputs[1]!.kind).toBe('audio');
    expect(plan.inputs[0]!.height).toBe(Math.max(...yt.filter((v) => v.kind === 'video').map((v) => v.height ?? 0)));
    expect(plan.container === 'mp4' || plan.container === 'matroska' || plan.container === 'webm').toBe(true);
  });

  it('honours maxHeight', () => {
    const plan = planDownload(yt, { kind: 'video', maxHeight: 360 });
    expect(plan.inputs[0]!.height).toBe(360);
    expect(plan.inputs[0]!.codec).toMatch(/^avc/); // same height: H.264 preferred for compatibility
    expect(plan.container).toBe('mp4');
    expect(plan.inputs[1]!.codec).toMatch(/^mp4a/);
    expect(plan.mime).toBe('video/mp4');
    expect(plan.extension).toBe('mp4');
  });

  it('rejects an impossible height instead of silently upscaling', () => {
    expect(() => planDownload(yt, { kind: 'video', maxHeight: 10 })).toThrowError(/at or below/);
  });

  it('audio: best m4a as-is, or MP3 when asked', () => {
    const original = planDownload(yt, { kind: 'audio' });
    expect(original.inputs).toHaveLength(1);
    expect(original.transcodeMp3).toBe(false);
    const mp3 = planDownload(yt, { kind: 'audio', audioFormat: 'mp3' });
    expect(mp3).toMatchObject({ transcodeMp3: true, container: 'mp3', mime: 'audio/mpeg', extension: 'mp3' });
  });
});

describe('planDownload — other shapes', () => {
  it('uses a complete rendition as-is (TikTok), without merging', () => {
    const plan = planDownload(media('tiktok').variants, { kind: 'video' });
    expect(plan.inputs).toHaveLength(1);
    expect(plan.inputs[0]!.hasAudio).not.toBe(false);
  });

  it('extracts the soundtrack from a complete video when there is no audio-only rendition', () => {
    const plan = planDownload(media('tiktok').variants.filter((v) => v.kind === 'video'), { kind: 'audio' });
    expect(plan).toMatchObject({ transcodeMp3: true, stripVideo: true, container: 'mp3' });
  });

  it('SoundCloud: audio works, video is a clear 422', () => {
    const sc = media('soundcloud').variants;
    expect(planDownload(sc, { kind: 'audio' }).inputs).toHaveLength(1);
    expect(() => planDownload(sc, { kind: 'video' })).toThrowError(/no video/i);
  });
});

describe('ffmpegArgs', () => {
  const yt = media('youtube').variants;

  it('locks EVERY input to a protocol whitelist (it is a per-input option) and caps the output size', () => {
    const plan = planDownload(yt, { kind: 'video', maxHeight: 360 });
    const args = ffmpegArgs(plan, { maxBytes: 5000 });
    expect(args).toEqual(expect.arrayContaining(['-fs', '5000', '-nostdin']));
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    // each -i is immediately preceded by its own whitelist (possibly after header args)
    args.forEach((a, i) => {
      if (a === '-i') expect(args.slice(0, i)).toContain('-protocol_whitelist');
    });
    expect(args.filter((a) => a === '-protocol_whitelist')).toHaveLength(2);
    expect(args).not.toContain('file');
    // gateway-fed inputs get `pipe` only; URL inputs never get `pipe`
    const piped = ffmpegArgs(plan, { maxBytes: 1 }, ['pipe:3', 'pipe:4']);
    expect(piped.filter((a, i) => a === '-protocol_whitelist' && piped[i + 1] === 'pipe')).toHaveLength(2);
    const urls = ffmpegArgs(plan, { maxBytes: 1 });
    expect(urls.filter((a, i) => a === '-protocol_whitelist' && /pipe/.test(urls[i + 1]!))).toHaveLength(0);
    expect(urls).toContain('http,https,tcp,tls,crypto');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '1:a:0', '-movflags']));
    expect(args.at(-1)).toBe('pipe:1');
  });

  it('never forwards header names/values that could inject extra headers', () => {
    const plan = planDownload(
      [{ kind: 'video', url: 'https://cdn.example/v.mp4', ext: 'mp4', hasAudio: true, headers: { Referer: 'https://ok.example', 'X-Evil': 'a\r\nHost: evil', 'Bad Name': 'x', 'User-Agent': 'UA' } }],
      { kind: 'video' },
    );
    const args = ffmpegArgs(plan, { maxBytes: 1 });
    const h = args[args.indexOf('-headers') + 1]!;
    expect(h).toBe('Referer: https://ok.example\r\n');
    expect(args[args.indexOf('-user_agent') + 1]).toBe('UA');
  });
});

describe('SSRF guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'not-an-ip'])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('%s is public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('rejects private literals, localhost, other schemes and unresolvable hosts', async () => {
    for (const u of ['http://127.0.0.1/x', 'http://[::1]/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost/x', 'file:///etc/passwd', 'ftp://x/y', 'not a url', 'http://nonexistent-host-zzzz.invalid/x']) {
      await expect(assertPublicHttpUrl(u), u).rejects.toMatchObject({ code: 'blocked_url' });
    }
    await expect(assertPublicHttpUrl('https://8.8.8.8/x')).resolves.toBeInstanceOf(URL);
  });
});

describe('download helpers', () => {
  it('builds safe, RFC 5987 filenames', () => {
    expect(safeFilename('Big/Buck:Bunny "60fps"?', 'mp4')).toBe('Big Buck Bunny 60fps .mp4'.replace(' .', '.'));
    expect(safeFilename(null, 'mp3')).toBe('download.mp3');
    const cd = contentDisposition('Été 🎬.mp4');
    expect(cd).toContain('attachment');
    expect(cd).toContain("filename*=UTF-8''%C3%89t%C3%A9%20%F0%9F%8E%AC.mp4");
    expect(cd).not.toMatch(/[\r\n]/);
  });

  it('SlotLimiter refuses when full and releases exactly once', () => {
    const l = new SlotLimiter(1);
    const r = l.tryAcquire()!;
    expect(l.tryAcquire()).toBeNull();
    r();
    r();
    expect(l.inUse).toBe(0);
    expect(l.tryAcquire()).not.toBeNull();
  });
});
