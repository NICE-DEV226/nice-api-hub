import * as cheerio from 'cheerio';
import { upstreamText } from '../http.js';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

/**
 * Parse a twmate.com result page. Verified on three real pages: a tweet with video,
 * a tweet without media, and a non-existent tweet.
 *
 * Distinguishing "nothing to download" from "the site broke": when the page still
 * contains the request form the site is alive, so an empty table means the CONTENT
 * has no downloadable media. Without the form we saw a challenge/layout change, which
 * is the provider's fault and must fail over.
 */
export function parseTwmate(html: string): MediaDraft {
  const $ = cheerio.load(html);
  const variants: Variant[] = [];

  $('.files-table tbody tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;
    const quality = cells.eq(0).text().trim();
    const ext = cells.eq(1).text().trim().toLowerCase();
    const url = safeHttpUrl(cells.eq(2).find('a.btn-dl').attr('href'));
    const size = /^(\d+)x(\d+)$/.exec(quality);
    const variant = makeVariant({
      kind: ext === 'mp3' || ext === 'm4a' ? 'audio' : ext === 'jpg' || ext === 'png' ? 'image' : 'video',
      url,
      quality,
      label: quality,
      ext: ext || undefined,
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined,
    });
    if (variant) variants.push(variant);
  });

  if (variants.length === 0) {
    const siteAlive = $('input[name=page]').length > 0;
    throw new ProviderError(
      siteAlive ? 'unavailable' : 'bad_response',
      siteAlive ? 'no downloadable media at this URL' : 'unexpected page (no request form)',
    );
  }

  variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return {
    title: null,
    author: null,
    thumbnail: safeHttpUrl($('img[src*="twimg"]').first().attr('src')),
    durationSeconds: null,
    variants,
  };
}

export const twmateProvider: Provider = {
  id: 'twmate',
  platform: 'twitter',
  priority: 10,
  maxConcurrency: 4,

  async fetch({ url, signal }) {
    const target = new URL(url);
    target.hostname = 'twitter.com'; // the upstream only understands twitter.com links
    const html = await upstreamText({
      url: 'https://twmate.com/en2/',
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://twmate.com/en2/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ page: target.toString(), ftype: 'all' }).toString(),
      signal,
    });
    return parseTwmate(html);
  },
};
