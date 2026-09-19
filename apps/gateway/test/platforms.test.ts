import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../src/providers/platforms.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return e.code as string;
  }
  return null;
};

describe('resolveTarget', () => {
  it('detects TikTok, including short-link subdomains', () => {
    expect(resolveTarget('https://www.tiktok.com/@u/video/123').platform.id).toBe('tiktok');
    expect(resolveTarget('https://vm.tiktok.com/ZM8abc/').platform.id).toBe('tiktok');
  });

  it('detects YouTube variants', () => {
    expect(resolveTarget('https://youtu.be/dQw4w9WgXcQ').platform.id).toBe('youtube');
    expect(resolveTarget('https://m.youtube.com/watch?v=abc').platform.id).toBe('youtube');
  });

  it('detects and canonicalises X/Twitter, Bluesky and Dailymotion links', () => {
    expect(resolveTarget('https://x.com/NASA/status/2042756933686337713/video/1?s=20&t=abc').url.toString()).toBe('https://x.com/NASA/status/2042756933686337713');
    expect(resolveTarget('https://twitter.com/NASA/status/2042756933686337713').platform.id).toBe('twitter');
    expect(resolveTarget('https://bsky.app/profile/bsky.app/post/3mk4lzkrnk22d?ref=x').url.search).toBe('');
    expect(resolveTarget('https://dai.ly/x9yfz8u').url.toString()).toBe('https://www.dailymotion.com/video/x9yfz8u');
    expect(resolveTarget('https://www.dailymotion.com/video/x9yfz8u_big-buck-bunny_creation?playlist=x1').url.toString()).toBe('https://www.dailymotion.com/video/x9yfz8u');
  });

  it('canonicalises so equivalent URLs share a cache key', () => {
    const a = resolveTarget('https://www.youtube.com/watch?v=abc&utm_source=x&list=PL1&t=5s#frag').url.toString();
    const b = resolveTarget('http://WWW.YOUTUBE.COM/watch?v=abc').url.toString();
    expect(a).toBe(b);
    expect(a).toBe('https://www.youtube.com/watch?v=abc');
  });

  it('strips tracking params but keeps identifying ones on TikTok', () => {
    const url = resolveTarget('https://www.tiktok.com/@u/video/1?is_from_webapp=1&sender_device=pc&foo=bar').url;
    expect(url.search).toBe('?foo=bar');
  });

  it('rejects hosts that merely contain a platform name (open-relay guard)', () => {
    expect(code(() => resolveTarget('https://tiktok.com.evil.example/video/1'))).toBe('unsupported_platform');
    expect(code(() => resolveTarget('https://evil-tiktok.com/video/1'))).toBe('unsupported_platform');
    expect(code(() => resolveTarget('https://example.com/?u=https://tiktok.com/x'))).toBe('unsupported_platform');
  });

  it('rejects non-http schemes, credentials and garbage', () => {
    expect(code(() => resolveTarget('javascript:alert(1)'))).toBe('invalid_request');
    expect(code(() => resolveTarget('file:///etc/passwd'))).toBe('invalid_request');
    expect(code(() => resolveTarget('https://user:pw@tiktok.com/x'))).toBe('invalid_request');
    expect(code(() => resolveTarget('not a url'))).toBe('invalid_request');
    expect(code(() => resolveTarget('https://tiktok.com/' + 'a'.repeat(3000)))).toBe('invalid_request');
  });
});
