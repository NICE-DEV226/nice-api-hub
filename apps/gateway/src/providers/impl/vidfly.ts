import { upstreamJson } from '../http.js';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

interface VidflyItem {
  type?: string;
  label?: string;
  ext?: string;
  extension?: string;
  url?: string;
}

interface VidflyResponse {
  code?: number;
  message?: string;
  data?: {
    title?: string;
    cover?: string;
    duration?: number;
    author?: string;
    items?: VidflyItem[];
  };
}

/** Pure mapping, unit-testable with fixtures. */
export function parseVidfly(json: VidflyResponse): MediaDraft {
  const data = json.data;
  if (!data || !Array.isArray(data.items) || !data.title) {
    throw new ProviderError('bad_response', 'empty or malformed upstream payload');
  }

  const variants: Variant[] = [];
  for (const item of data.items) {
    const type = (item.type ?? '').toLowerCase();
    const isAudio = type.includes('audio');
    const variant = makeVariant({
      kind: isAudio ? 'audio' : 'video',
      url: safeHttpUrl(item.url),
      label: item.label,
      quality: item.label,
      ext: item.ext ?? item.extension,
      hasAudio: isAudio ? undefined : !type.includes('video_only') && !type.includes('without'),
    });
    if (variant) variants.push(variant);
  }
  if (variants.length === 0) throw new ProviderError('bad_response', 'no usable variants');

  return {
    title: data.title,
    author: data.author ?? null,
    thumbnail: safeHttpUrl(data.cover),
    durationSeconds: typeof data.duration === 'number' ? data.duration : null,
    variants,
  };
}

export const vidflyProvider: Provider = {
  id: 'vidfly',
  platform: 'youtube',
  priority: 10,

  async fetch({ url, signal }) {
    const endpoint = new URL('https://api.vidfly.ai/api/media/youtube/download');
    endpoint.searchParams.set('url', url.toString());
    const json = await upstreamJson<VidflyResponse>({
      url: endpoint.toString(),
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        'x-app-name': 'vidfly-web',
        'x-app-version': '1.0.0',
        referer: 'https://vidfly.ai/',
      },
      signal,
    });
    return parseVidfly(json);
  },
};
