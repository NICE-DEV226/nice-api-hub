import type { Platform } from './types.js';
import { errors } from '../errors.js';

/** Query parameters that never change which content a URL points to. */
const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|igshid|si|feature|ref|ref_src|ref_url|is_from_webapp|sender_device|_t|_r|share_.+|checksum|sec_user_id|u_code|refer|lang)$/i;

/** Drop the query string except for the listed parameters (which identify the content). */
function keepOnly(url: URL, ...allowed: string[]): void {
  for (const key of [...url.searchParams.keys()]) {
    if (!allowed.includes(key)) url.searchParams.delete(key);
  }
}

function stripTracking(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'tiktok',
    displayName: 'TikTok',
    hosts: ['tiktok.com'],
    canonicalize: stripTracking,
  },
  {
    id: 'youtube',
    displayName: 'YouTube',
    hosts: ['youtube.com', 'youtu.be'],
    canonicalize(url) {
      // Keep only `v` (and `list` is irrelevant to a single video).
      if (/(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/watch') {
        const v = url.searchParams.get('v');
        url.search = '';
        if (v) url.searchParams.set('v', v);
      } else {
        stripTracking(url);
      }
    },
  },
  {
    id: 'twitter',
    displayName: 'X (Twitter)',
    hosts: ['twitter.com', 'x.com'],
    canonicalize(url) {
      // /NASA/status/123/video/1?s=20  →  /NASA/status/123
      const m = /^\/([^/]+)\/status\/(\d+)/.exec(url.pathname);
      if (m) url.pathname = `/${m[1]}/status/${m[2]}`;
      url.search = '';
    },
  },
  {
    id: 'bluesky',
    displayName: 'Bluesky',
    hosts: ['bsky.app'],
    canonicalize(url) {
      url.search = '';
    },
  },
  {
    id: 'dailymotion',
    displayName: 'Dailymotion',
    hosts: ['dailymotion.com', 'dai.ly'],
    canonicalize(url) {
      // dai.ly/x9yfz8u and dailymotion.com/video/x9yfz8u_slug → www.dailymotion.com/video/x9yfz8u
      const short = /^\/([a-z0-9]+)$/i.exec(url.pathname);
      const long = /^\/video\/([a-z0-9]+)/i.exec(url.pathname);
      const id = url.hostname === 'dai.ly' ? short?.[1] : long?.[1];
      if (id) {
        url.hostname = 'www.dailymotion.com';
        url.pathname = `/video/${id}`;
      }
      url.search = '';
    },
  },
  {
    id: 'instagram',
    displayName: 'Instagram',
    hosts: ['instagram.com', 'instagr.am'],
    canonicalize: (url) => keepOnly(url, 'img_index'),
  },
  {
    id: 'facebook',
    displayName: 'Facebook',
    hosts: ['facebook.com', 'fb.watch', 'fb.com'],
    canonicalize: (url) => keepOnly(url, 'v', 'story_fbid', 'id'),
  },
  {
    id: 'soundcloud',
    displayName: 'SoundCloud',
    hosts: ['soundcloud.com', 'snd.sc'],
    canonicalize: (url) => keepOnly(url, 'secret_token'),
  },
  {
    id: 'linkedin',
    displayName: 'LinkedIn',
    hosts: ['linkedin.com'],
    canonicalize: (url) => keepOnly(url),
  },
  {
    id: 'pinterest',
    displayName: 'Pinterest',
    hosts: ['pinterest.com', 'pin.it'],
    canonicalize: (url) => keepOnly(url),
  },
];

const MAX_URL_LENGTH = 2048;

export interface ResolvedTarget {
  platform: Platform;
  /** Canonical URL: the cache key and what providers receive. */
  url: URL;
}

function hostMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/**
 * Parse, validate, allowlist and canonicalise a user-supplied URL.
 *
 * The host allowlist is a security control: it stops the API from being used as an
 * open relay to arbitrary third-party services.
 */
export function resolveTarget(
  raw: string,
  platforms: readonly Platform[] = PLATFORMS,
): ResolvedTarget {
  if (raw.length > MAX_URL_LENGTH) throw errors.invalidRequest('`url` is too long.');

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw errors.invalidRequest('`url` must be an absolute http(s) URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw errors.invalidRequest('`url` must use http or https.');
  }
  if (url.username || url.password) {
    throw errors.invalidRequest('`url` must not contain credentials.');
  }

  const hostname = url.hostname.toLowerCase();
  const platform = platforms.find((p) => p.hosts.some((h) => hostMatches(hostname, h)));
  if (!platform) {
    throw errors.unsupportedPlatform(`No supported platform matches host "${hostname}".`);
  }

  url.protocol = 'https:';
  url.hostname = hostname;
  url.port = '';
  url.hash = '';
  platform.canonicalize?.(url);
  url.searchParams.sort();
  return { platform, url };
}
