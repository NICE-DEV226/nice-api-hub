/**
 * Live smoke test: calls every registered provider against the REAL upstream with a
 * known-good public URL. Run it after deploys and on a schedule to catch upstream
 * format changes early:   npm run probe [-w @nice-api-hub/gateway]
 * Exit code 1 if any provider fails.
 */
import { buildDefaultProviders } from '../src/http/app.js';
import { detectYtDlp } from '../src/providers/impl/ytdlp.js';
import { PLATFORMS, resolveTarget } from '../src/providers/platforms.js';

/** Public, stable samples (Blender open movies, official/news accounts). Replace if they disappear. */
export const SAMPLES: Record<string, string> = {
  tiktok: 'https://www.tiktok.com/@bbcnews/video/7623948383312465174',
  twitter: 'https://x.com/NASA/status/2042756933686337713',
  bluesky: 'https://bsky.app/profile/bsky.app/post/3mk4lzkrnk22d',
  dailymotion: 'https://www.dailymotion.com/video/x9yfz8u',
  youtube: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  instagram: 'https://www.instagram.com/bbcnews/reel/CjAAbuMjAHT/',
  facebook: 'https://www.facebook.com/bbcnews/videos/splashdown-nasa-spacex-crew-return/578508686149614/',
  soundcloud: 'https://soundcloud.com/scottbuckley/sanctuary-cc-by',
  linkedin: 'https://www.linkedin.com/posts/nasa_the-universe-is-calling-apply-to-be-a-nasa-activity-7170837163293532160-KxO-',
  pinterest: 'https://www.pinterest.com/pin/739716307575438329/',
};

const bin = process.env.YTDLP_PATH ?? 'yt-dlp';
const version = await detectYtDlp(bin);
console.log(version ? `yt-dlp ${version}` : 'yt-dlp NOT FOUND: only dedicated providers will be probed');
const providers = buildDefaultProviders(
  version ? { bin, jsRuntime: process.env.YTDLP_JS_RUNTIME ?? 'node' } : null,
);
const only = process.argv[2];

let failed = 0;
for (const provider of providers) {
  if (only && provider.platform !== only && provider.id !== only) continue;
  const sample = SAMPLES[provider.platform];
  if (!sample) {
    console.log(`?  ${provider.id.padEnd(20)} no sample URL for platform "${provider.platform}"`);
    continue;
  }
  const started = performance.now();
  try {
    const { url } = resolveTarget(sample, PLATFORMS);
    const media = await provider.fetch({ url, signal: AbortSignal.timeout(provider.timeoutMs ?? 20_000) });
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
