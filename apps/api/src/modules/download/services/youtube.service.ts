/**
 * YouTube download service
 * Author: NICE-DEV
 */

import axios from 'axios';

interface YouTubeFormat {
  type: string;
  quality: string;
  extension: string;
  url: string;
}

interface YouTubeData {
  title: string;
  thumbnail: string;
  duration: number;
  formats: YouTubeFormat[];
}

export async function fetchYouTubeData(url: string): Promise<YouTubeData> {
  try {
    const res = await axios.get(
      'https://api.vidfly.ai/api/media/youtube/download',
      {
        params: { url },
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          'x-app-name': 'vidfly-web',
          'x-app-version': '1.0.0',
          Referer: 'https://vidfly.ai/',
        },
        timeout: 30000,
      }
    );

    const data = res.data?.data;
    if (!data || !data.items || !data.title) {
      throw new Error('Invalid or empty response from YouTube downloader API');
    }

    return {
      title: data.title,
      thumbnail: data.cover,
      duration: data.duration,
      formats: data.items.map((item: any) => ({
        type: item.type,
        quality: item.label || 'unknown',
        extension: item.ext || item.extension || 'unknown',
        url: item.url,
      })),
    };
  } catch (error: any) {
    throw new Error(`YouTube download failed: ${error.message}`);
  }
}
