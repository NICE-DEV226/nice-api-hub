/**
 * Live smoke test: calls every registered provider against the REAL upstream with a
 * known-good public URL. Run it after deploys and on a schedule to catch upstream
 * format changes early:   npm run probe [-w @nice-api-hub/gateway]
 * Exit code 1 if any provider fails.
 */
import { DEFAULT_PROVIDERS } from '../src/http/app.js';
import { PLATFORMS, resolveTarget } from '../src/providers/platforms.js';

/** Public, stable samples (Blender open movies, official/news accounts). Replace if they disappear. */
export const SAMPLES: Record<string, string> = {
  tiktok: 'https://www.tiktok.com/@bbcnews/video/7623948383312465174',
  twitter: 'https://x.com/NASA/status/2042756933686337713',
  bluesky: 'https://bsky.app/profile/bsky.app/post/3mk4lzkrnk22d',
  dailymotion: 'https://www.dailymotion.com/video/x9yfz8u',
};

let failed = 0;
for (const provider of DEFAULT_PROVIDERS) {
  const sample = SAMPLES[provider.platform];
  if (!sample) {
    console.log(`?  ${provider.id.padEnd(20)} no sample URL for platform "${provider.platform}"`);
    continue;
  }
  const started = performance.now();
  try {
    const { url } = resolveTarget(sample, PLATFORMS);
    const media = await provider.fetch({ url, signal: AbortSignal.timeout(20_000) });
    const ms = Math.round(performance.now() - started);
    const kinds = [...new Set(media.variants.map((v) => v.kind + (v.protocol === 'hls' ? '/hls' : '')))].join(',');
    console.log(`OK ${provider.id.padEnd(20)} ${String(ms).padStart(5)} ms  ${media.variants.length} variants (${kinds})  "${(media.title ?? '').slice(0, 50)}"`);
  } catch (error) {
    failed++;
    const e = error as { kind?: string; message: string };
    console.log(`FAIL ${provider.id.padEnd(18)} ${e.kind ?? 'error'}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
