import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyYtDlpFailure, mapYtDlpInfo, ytDlpArgs, type YtDlpInfo } from '../src/providers/impl/ytdlp.js';

// Real `yt-dlp -J` output captured on 2026-09-19, URLs truncated. See test/fixtures.
const info = (name: string): YtDlpInfo => JSON.parse(readFileSync(new URL(`./fixtures/ytdlp-${name}.json`, import.meta.url), 'utf8'));
const kind = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return e.kind as string;
  }
  return null;
};

describe('mapYtDlpInfo — real YouTube output', () => {
  const media = mapYtDlpInfo(info('youtube'));

  it('maps metadata', () => {
    expect(media.title).toContain('Big Buck Bunny');
    expect(media.author).toBe('Blender');
    expect(media.durationSeconds).toBe(635);
  });

  it('never exposes storyboards, DRC duplicates or manifests', () => {
    expect(media.variants.some((v) => v.id?.startsWith('sb'))).toBe(false);
    expect(media.variants.some((v) => v.id?.endsWith('-drc'))).toBe(false);
  });

  it('marks YouTube streams as video-only / audio-only (there is no combined format any more)', () => {
    const video = media.variants.filter((v) => v.kind === 'video');
    const audio = media.variants.filter((v) => v.kind === 'audio');
    expect(video.length).toBeGreaterThan(5);
    expect(video.every((v) => v.hasAudio === false)).toBe(true);
    expect(audio.length).toBeGreaterThanOrEqual(3);
  });

  it('drops HLS variants when direct files exist for that kind', () => {
    expect(media.variants.every((v) => v.protocol === 'direct')).toBe(true);
  });

  it('sorts best first: highest resolution, audio by bitrate', () => {
    const heights = media.variants.filter((v) => v.kind === 'video').map((v) => v.height ?? 0);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    const abr = media.variants.filter((v) => v.kind === 'audio').map((v) => v.bitrateKbps ?? 0);
    expect(abr).toEqual([...abr].sort((a, b) => b - a));
  });

  it('carries what a client needs to pick a rendition', () => {
    const v = media.variants.find((x) => x.kind === 'video' && x.height === 720)!;
    expect(v).toMatchObject({ kind: 'video', quality: expect.stringMatching(/^720p/), hasAudio: false, protocol: 'direct' });
    expect(v.id).toBeTruthy();
    expect(v.codec).toBeTruthy();
    expect(v.url).toMatch(/^https:\/\//);
  });
});

describe('mapYtDlpInfo — other real extractors', () => {
  it('TikTok: complete videos with audio, plus the CDN headers the client must send', () => {
    const media = mapYtDlpInfo(info('tiktok'));
    const complete = media.variants.filter((v) => v.kind === 'video' && v.hasAudio);
    expect(complete.length).toBeGreaterThan(0);
    expect(media.variants[0]!.kind).toBe('video');
    expect(complete.some((v) => v.headers?.['User-Agent'] || v.headers?.Referer)).toBe(true);
  });

  it('never leaks cookies, whatever the extractor put in http_headers', () => {
    const media = mapYtDlpInfo({
      title: 't',
      formats: [{ format_id: '1', url: 'https://cdn.example/a.mp4', ext: 'mp4', protocol: 'https', vcodec: 'avc1', acodec: 'aac', http_headers: { Cookie: 'sid=SECRET', 'User-Agent': 'UA', Authorization: 'Bearer x' } }],
    });
    expect(media.variants[0]!.headers).toEqual({ 'User-Agent': 'UA' });
  });

  it('X, Instagram, Facebook, Pinterest, Dailymotion: at least one playable variant each', () => {
    for (const name of ['twitter', 'instagram', 'facebook', 'pinterest', 'dailymotion', 'linkedin']) {
      const media = mapYtDlpInfo(info(name));
      expect(media.variants.length, name).toBeGreaterThan(0);
      expect(media.variants.every((v) => /^https?:\/\//.test(v.url)), name).toBe(true);
    }
  });

  it('SoundCloud: audio kind', () => {
    const media = mapYtDlpInfo(info('soundcloud'));
    expect(media.variants[0]!.kind).toBe('audio');
    expect(media.title).toContain('Sanctuary');
  });

  it('a lone top-level URL (generic extractor) becomes one variant', () => {
    const media = mapYtDlpInfo({ title: 'x', url: 'https://cdn.example/v.mp4', ext: 'mp4', protocol: 'https', format_id: 'f' });
    expect(media.variants).toHaveLength(1);
  });

  it('uses the first entry of a playlist result (multi-video posts)', () => {
    const media = mapYtDlpInfo({ _type: 'playlist', entries: [{ title: 'first', url: 'https://cdn.example/1.mp4', ext: 'mp4', protocol: 'https', format_id: '1' }] });
    expect(media.title).toBe('first');
  });

  it('refuses live streams and results with nothing playable', () => {
    expect(kind(() => mapYtDlpInfo({ is_live: true, formats: [] }))).toBe('unavailable');
    expect(kind(() => mapYtDlpInfo({ title: 'x', formats: [{ format_id: 'dash', url: 'https://x/y.mpd', protocol: 'http_dash_segments' }] }))).toBe('bad_response');
  });
});

describe('classifyYtDlpFailure — real error messages', () => {
  const cases: Array<[string, string]> = [
    ['ERROR: [youtube] zzzzzzzzzzz: This video is unavailable', 'unavailable'],
    ['ERROR: [twitter] 1: No video could be found in this tweet', 'unavailable'],
    ['ERROR: [dailymotion] x000000: Not found.', 'unavailable'],
    ['ERROR: [soundcloud] a/b: Unable to download JSON metadata: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)', 'unavailable'],
    ['ERROR: [Tumblr] 819233422280130560: No video could be found in this post', 'unavailable'],
    ["ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.", 'blocked'],
    ['ERROR: [TikTok] 1111: Your IP address is blocked from accessing this post', 'blocked'],
    ['ERROR: [Instagram] AAAA: Instagram sent an empty media response. Check if this post is accessible in your browser', 'blocked'],
    ['ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests', 'blocked'],
    ['ERROR: [facebook] 1: Cannot parse data; please report this issue on https://github.com/yt-dlp/yt-dlp/issues', 'upstream'],
    ['some unexpected crash', 'upstream'],
  ];
  it.each(cases)('%s → %s', (stderr, expected) => {
    expect(classifyYtDlpFailure(stderr).kind).toBe(expected);
  });

  it('"blocked" wins over "gone" when both words appear', () => {
    expect(classifyYtDlpFailure('ERROR: HTTP Error 403: Forbidden - video unavailable').kind).toBe('blocked');
  });
});

describe('ytDlpArgs', () => {
  it('passes the URL after `--` so it can never be parsed as an option', () => {
    const args = ytDlpArgs({ bin: 'yt-dlp', jsRuntime: 'node' }, '-o /etc/passwd');
    expect(args.slice(-2)).toEqual(['--', '-o /etc/passwd']);
    expect(args).toContain('--ignore-config');
  });

  it('adds cookies and proxy only when configured', () => {
    expect(ytDlpArgs({ bin: 'y', jsRuntime: 'node' }, 'https://x')).not.toContain('--proxy');
    const args = ytDlpArgs({ bin: 'y', jsRuntime: 'node', proxy: 'http://p:1', cookiesFile: '/c.txt' }, 'https://x');
    expect(args).toEqual(expect.arrayContaining(['--proxy', 'http://p:1', '--cookies', '/c.txt']));
  });
});
