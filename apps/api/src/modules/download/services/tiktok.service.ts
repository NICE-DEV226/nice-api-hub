/**
 * TikTok download service
 * Author: NICE-DEV
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

interface TikTokDownload {
  text: string;
  url: string;
}

interface TikTokData {
  status: string;
  title: string | null;
  thumbnail: string | null;
  downloads: TikTokDownload[];
}

export async function fetchTikTokData(videoUrl: string): Promise<TikTokData> {
  const endpoint = 'https://tikdownloader.io/api/ajaxSearch';

  try {
    const res = await axios.post(
      endpoint,
      new URLSearchParams({ q: videoUrl, lang: 'en' }),
      {
        headers: {
          accept: '*/*',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest',
          Referer: 'https://tikdownloader.io/en',
        },
        timeout: 30000,
      }
    );

    const html = res.data.data;
    const $ = cheerio.load(html);

    const title = $('.thumbnail h3').text().trim() || null;
    const thumbnail = $('.thumbnail img').attr('src') || null;

    const downloads: TikTokDownload[] = [];

    // Video / Audio downloads
    $('.dl-action a').each((_i, el) => {
      const text = $(el).text().trim();
      const url = $(el).attr('href');

      if (!url || url === '#') return;
      downloads.push({ text, url });
    });

    // Photo mode downloads
    const photos = $('.photo-list .download-box li');
    if (photos.length > 0) {
      photos.each((_i, el) => {
        const text = $(el).find('a').text().trim();
        const url = $(el).find('a').attr('href');

        if (!url || url === '#') return;
        downloads.push({ text, url });
      });
    }

    return {
      status: res.data.status,
      title,
      thumbnail,
      downloads,
    };
  } catch (error: any) {
    throw new Error(`TikTok download failed: ${error.message}`);
  }
}
