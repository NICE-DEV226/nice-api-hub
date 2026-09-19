import * as cheerio from 'cheerio';
import { upstreamJson } from '../http.js';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

interface AjaxSearchResponse {
  status?: string;
  data?: string;
}

const QUALITY = /\b(hd|sd|4k|2160p|1440p|1080p|720p|480p|360p)\b/i;
const GONE = /not found|private|removed|unavailable|deleted|does not exist/i;

/** Parse the HTML fragment returned by tikdownloader.io. Pure function: unit-testable with fixtures. */
export function parseTikDownloader(html: string): MediaDraft {
  const $ = cheerio.load(html);
  const variants: Variant[] = [];

  $('.dl-action a').each((_i, el) => {
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    const url = safeHttpUrl($(el).attr('href'));
    const lower = label.toLowerCase();
    const isAudio = lower.includes('mp3') || lower.includes('audio');
    const variant = makeVariant({
      kind: isAudio ? 'audio' : 'video',
      url,
      label,
      quality: QUALITY.exec(label)?.[1]?.toLowerCase(),
      ext: isAudio ? 'mp3' : 'mp4',
      hasAudio: isAudio ? undefined : true,
    });
    if (variant) variants.push(variant);
  });

  $('.photo-list .download-box li').each((_i, el) => {
    const a = $(el).find('a');
    const variant = makeVariant({
      kind: 'image',
      url: safeHttpUrl(a.attr('href')),
      label: a.text().replace(/\s+/g, ' ').trim() || undefined,
    });
    if (variant) variants.push(variant);
  });

  return {
    title: $('.thumbnail h3').text().replace(/\s+/g, ' ').trim() || null,
    author: null,
    thumbnail: safeHttpUrl($('.thumbnail img').attr('src')),
    durationSeconds: null,
    variants,
  };
}

export const tikDownloaderProvider: Provider = {
  id: 'tikdownloader',
  platform: 'tiktok',
  priority: 10,

  async fetch({ url, signal }) {
    const json = await upstreamJson<AjaxSearchResponse>({
      url: 'https://tikdownloader.io/api/ajaxSearch',
      method: 'POST',
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://tikdownloader.io/en',
      },
      body: new URLSearchParams({ q: url.toString(), lang: 'en' }).toString(),
      signal,
    });

    if (json.status !== 'ok' || typeof json.data !== 'string') {
      throw new ProviderError('bad_response', `unexpected upstream status "${json.status ?? 'none'}"`);
    }

    const media = parseTikDownloader(json.data);
    if (media.variants.length === 0) {
      // Heuristic: the upstream answers 200 with an error banner for dead videos.
      const kind = GONE.test(cheerio.load(json.data).text()) ? 'unavailable' : 'bad_response';
      throw new ProviderError(kind, kind === 'unavailable' ? 'content unavailable' : 'empty upstream result');
    }
    return media;
  },
};
