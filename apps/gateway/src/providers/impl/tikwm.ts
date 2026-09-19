import { upstreamJson } from '../http.js';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

interface TikwmResponse {
  code?: number;
  msg?: string;
  data?: {
    title?: string;
    cover?: string;
    duration?: number;
    play?: string;
    hdplay?: string;
    music?: string;
    images?: string[];
    author?: { unique_id?: string; nickname?: string };
  };
}

const GONE = /pars|not found|private|removed|deleted|unavailable|invalid/i;
const LIMITED = /limit|too many|frequen/i;

/** Pure mapping of tikwm.com's JSON, unit-tested against a real captured response. */
export function parseTikwm(json: TikwmResponse): MediaDraft {
  if (json.code !== 0 || !json.data) {
    const msg = json.msg ?? 'no message';
    if (LIMITED.test(msg)) throw new ProviderError('blocked', `tikwm rate limit: ${msg}`);
    if (GONE.test(msg)) throw new ProviderError('unavailable', `tikwm: ${msg}`);
    throw new ProviderError('bad_response', `tikwm error: ${msg}`);
  }

  const d = json.data;
  const variants: Variant[] = [];
  const seen = new Set<string>();
  const add = (v: Variant | null) => {
    if (v && !seen.has(v.url)) {
      seen.add(v.url);
      variants.push(v);
    }
  };

  // Watermark-free renditions only (`wmplay` is deliberately not exposed).
  add(makeVariant({ kind: 'video', url: safeHttpUrl(d.hdplay), quality: 'hd', ext: 'mp4', hasAudio: true, label: 'HD' }));
  add(makeVariant({ kind: 'video', url: safeHttpUrl(d.play), quality: 'sd', ext: 'mp4', hasAudio: true, label: 'SD' }));
  add(makeVariant({ kind: 'audio', url: safeHttpUrl(d.music), ext: 'mp3', label: 'Original sound' }));
  if (Array.isArray(d.images)) {
    d.images.forEach((img, i) => add(makeVariant({ kind: 'image', url: safeHttpUrl(img), label: `Photo ${i + 1}` })));
  }

  if (variants.length === 0) throw new ProviderError('bad_response', 'tikwm returned no usable media');

  return {
    title: d.title?.trim() || null,
    author: d.author?.nickname || d.author?.unique_id || null,
    thumbnail: safeHttpUrl(d.cover),
    durationSeconds: typeof d.duration === 'number' && d.duration > 0 ? d.duration : null,
    variants,
  };
}

export const tikwmProvider: Provider = {
  id: 'tikwm',
  platform: 'tiktok',
  priority: 10,
  // The free API allows roughly one request per second: never run it in parallel.
  maxConcurrency: 1,

  async fetch({ url, signal }) {
    const json = await upstreamJson<TikwmResponse>({
      url: 'https://www.tikwm.com/api/',
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ url: url.toString(), hd: '1' }).toString(),
      signal,
    });
    return parseTikwm(json);
  },
};
