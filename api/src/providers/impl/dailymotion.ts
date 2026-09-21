import { upstreamRaw } from '../http.js';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

interface Metadata {
  title?: string;
  duration?: number;
  thumbnails?: Record<string, string>;
  owner?: { screenname?: string };
  qualities?: Record<string, Array<{ type?: string; url?: string }>>;
  error?: { title?: string; message?: string; type?: string } | null;
}

/** Pure mapping of Dailymotion's player metadata. Tested against a real response. */
export function parseDailymotion(json: Metadata): MediaDraft {
  if (json.error) throw new ProviderError('unavailable', json.error.message || json.error.title || 'video unavailable');

  const variants: Variant[] = [];
  for (const [quality, sources] of Object.entries(json.qualities ?? {})) {
    for (const source of sources) {
      const isHls = /mpegurl/i.test(source.type ?? '');
      const height = /^\d+$/.test(quality) ? Number(quality) : undefined;
      const v = makeVariant({
        kind: 'video',
        url: safeHttpUrl(source.url),
        quality,
        height,
        protocol: isHls ? 'hls' : 'direct',
        mime: source.type,
        ext: isHls ? undefined : 'mp4',
        label: isHls ? 'HLS playlist' : `MP4 ${quality}`,
      });
      if (v) variants.push(v);
    }
  }
  if (variants.length === 0) throw new ProviderError('bad_response', 'no playable sources');

  const largestThumb = Object.entries(json.thumbnails ?? {})
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([, u]) => safeHttpUrl(u))
    .find(Boolean);

  return {
    title: json.title?.trim() || null,
    author: json.owner?.screenname ?? null,
    thumbnail: largestThumb ?? null,
    durationSeconds: typeof json.duration === 'number' ? json.duration : null,
    variants,
  };
}

export const dailymotionProvider: Provider = {
  id: 'dailymotion-player',
  platform: 'dailymotion',
  priority: 10,
  maxConcurrency: 8,

  async fetch({ url, signal }) {
    const id = /^\/video\/([a-z0-9]+)$/i.exec(url.pathname)?.[1];
    if (!id) throw new ProviderError('unavailable', 'not a Dailymotion video URL');

    const { status, text } = await upstreamRaw({
      url: `https://www.dailymotion.com/player/metadata/video/${id}`,
      headers: { accept: 'application/json' },
      signal,
      acceptStatus: [404],
    });
    if (status === 404) throw new ProviderError('unavailable', 'video not found');

    try {
      return parseDailymotion(JSON.parse(text) as Metadata);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('bad_response', 'invalid metadata JSON', { cause: error });
    }
  },
};
