import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blueskyProvider, parseBlueskyPost, parseBlueskyUrl } from '../src/providers/impl/bluesky.js';
import { parseDailymotion } from '../src/providers/impl/dailymotion.js';
import { parseTikwm } from '../src/providers/impl/tikwm.js';
import { parseTwmate } from '../src/providers/impl/twmate.js';

// Fixtures in test/fixtures are REAL upstream responses captured on 2026-09-19, reduced to the
// fields the parsers read. Refresh them with `npm run probe` when an upstream changes its format.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

const kind = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return e.kind as string;
  }
  return null;
};

describe('tikwm (TikTok) — real response', () => {
  const media = parseTikwm(json('tikwm-success.json'));

  it('maps metadata', () => {
    expect(media.title).toContain('first crewed mission around the Moon');
    expect(media.author).toBe('BBC News');
    expect(media.durationSeconds).toBe(32);
    expect(media.thumbnail).toMatch(/^https:\/\//);
  });

  it('exposes watermark-free video and audio, never the watermarked rendition', () => {
    expect(media.variants.map((v) => `${v.kind}:${v.quality ?? v.ext}`)).toEqual(['video:hd', 'video:sd', 'audio:mp3']);
    const raw = json('tikwm-success.json').data;
    expect(media.variants.some((v) => v.url === raw.wmplay)).toBe(false);
    expect(media.variants[0]).toMatchObject({ mime: 'video/mp4', hasAudio: true });
  });

  it('maps the real "Url parsing is failed" answer to content-unavailable, not a provider fault', () => {
    expect(kind(() => parseTikwm(json('tikwm-error.json')))).toBe('unavailable');
  });

  it('treats rate-limit messages as the provider being blocked (so we fail over)', () => {
    expect(kind(() => parseTikwm({ code: -1, msg: 'Free Api Limit: 1 request/second.' }))).toBe('blocked');
  });

  it('flags unknown failures as a bad response and rejects empty results', () => {
    expect(kind(() => parseTikwm({ code: -1, msg: 'weird' }))).toBe('bad_response');
    expect(kind(() => parseTikwm({ code: 0, data: {} }))).toBe('bad_response');
  });

  it('supports photo posts (synthetic: no real sample was available)', () => {
    const photos = parseTikwm({ code: 0, data: { title: 't', images: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg', 'javascript:x'] } });
    expect(photos.variants.map((v) => v.kind)).toEqual(['image', 'image']);
  });
});

describe('twmate (X/Twitter) — real pages', () => {
  it('extracts every rendition of a video tweet, best first', () => {
    const media = parseTwmate(fixture('twmate-video.html'));
    expect(media.variants).toHaveLength(5);
    expect(media.variants[0]).toMatchObject({ kind: 'video', quality: '3840x2160', width: 3840, height: 2160, ext: 'mp4', mime: 'video/mp4' });
    expect(media.variants.map((v) => v.height)).toEqual([2160, 1080, 720, 360, 270]);
    expect(media.thumbnail).toContain('twimg.com');
    expect(media.variants.every((v) => v.url.startsWith('https://'))).toBe(true);
  });

  it('a tweet with no media is "unavailable" (content), because the site itself answered normally', () => {
    expect(kind(() => parseTwmate(fixture('twmate-novideo.html')))).toBe('unavailable');
    expect(kind(() => parseTwmate(fixture('twmate-missing.html')))).toBe('unavailable');
  });

  it('a page without the request form is a provider fault (challenge / layout change) → fail over', () => {
    expect(kind(() => parseTwmate('<html><title>Just a moment...</title></html>'))).toBe('bad_response');
  });
});

describe('Bluesky (official AT Protocol) — real post', () => {
  it('maps a video post to an HLS variant with a thumbnail', () => {
    const media = parseBlueskyPost(json('bluesky-video-post.json'));
    expect(media.variants).toHaveLength(1);
    expect(media.variants[0]).toMatchObject({ kind: 'video', protocol: 'hls', mime: 'application/vnd.apple.mpegurl' });
    expect(media.variants[0]!.url).toContain('playlist.m3u8');
    expect(media.thumbnail).toContain('thumbnail.jpg');
    expect(media.author).toBeTruthy();
  });

  it('rejects posts without media as unavailable', () => {
    expect(kind(() => parseBlueskyPost({ thread: { post: { record: { text: 'just text' } } } }))).toBe('unavailable');
    expect(kind(() => parseBlueskyPost({}))).toBe('unavailable');
  });

  it('maps image posts, including images nested in recordWithMedia (synthetic)', () => {
    const post = {
      thread: { post: { embed: { $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://cdn.example/a.jpg', thumb: 'https://cdn.example/t.jpg', alt: 'A' }] } } } },
    };
    const media = parseBlueskyPost(post);
    expect(media.variants).toEqual([{ kind: 'image', url: 'https://cdn.example/a.jpg', label: 'A' }]);
  });

  it('parses post URLs by handle or DID and refuses anything else', () => {
    expect(parseBlueskyUrl(new URL('https://bsky.app/profile/bsky.app/post/3mk4lzkrnk22d'))).toEqual({ actor: 'bsky.app', rkey: '3mk4lzkrnk22d' });
    expect(parseBlueskyUrl(new URL('https://bsky.app/profile/did:plc:abc/post/3xyz'))?.actor).toBe('did:plc:abc');
    expect(parseBlueskyUrl(new URL('https://bsky.app/profile/bsky.app'))).toBeNull();
    expect(blueskyProvider.platform).toBe('bluesky');
  });
});

describe('Dailymotion — real player metadata', () => {
  it('maps the HLS source, thumbnail and owner', () => {
    const media = parseDailymotion(json('dailymotion-metadata.json'));
    expect(media.title).toContain('Big Buck Bunny');
    expect(media.durationSeconds).toBe(635);
    expect(media.author).toBe('World From Above');
    expect(media.variants[0]).toMatchObject({ kind: 'video', protocol: 'hls', quality: 'auto' });
    expect(media.thumbnail).toMatch(/^https:\/\//);
  });

  it('surfaces access errors as unavailable content (synthetic)', () => {
    expect(kind(() => parseDailymotion({ error: { message: 'This video is private' } }))).toBe('unavailable');
  });

  it('rejects metadata without playable sources', () => {
    expect(kind(() => parseDailymotion({ qualities: {} }))).toBe('bad_response');
  });
});
