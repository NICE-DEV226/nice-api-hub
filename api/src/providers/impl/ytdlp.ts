import { execFile } from 'node:child_process';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

/**
 * yt-dlp as an extraction engine. One actively maintained extractor covers YouTube,
 * TikTok, X, Instagram, Facebook, SoundCloud, Pinterest, Dailymotion, Bluesky, LinkedIn…
 * and is updated by the community within hours of a site change.
 *
 * It is executed as a subprocess: never through a shell, arguments as an array, the URL
 * after `--`, output size-capped, killed on timeout/abort.
 */
export interface YtDlpOptions {
  bin: string;
  /** JS runtime used to solve YouTube's signature challenges. */
  jsRuntime: string;
  cookiesFile?: string;
  proxy?: string;
}

interface Format {
  format_id?: string;
  url?: string;
  ext?: string;
  protocol?: string;
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  width?: number | null;
  fps?: number | null;
  tbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  format_note?: string | null;
  http_headers?: Record<string, string>;
}

export interface YtDlpInfo extends Format {
  _type?: string;
  entries?: YtDlpInfo[];
  title?: string | null;
  uploader?: string | null;
  channel?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  is_live?: boolean | null;
  live_status?: string | null;
  formats?: Format[];
}

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'wav', 'flac', 'weba']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const HEADER_ALLOWLIST = new Set(['user-agent', 'referer', 'origin']);

const isCodec = (c: string | null | undefined): c is string => Boolean(c) && c !== 'none';

function safeHeaders(h: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (HEADER_ALLOWLIST.has(k.toLowerCase()) && typeof v === 'string' && v.length < 512) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function mapFormat(f: Format): Variant | null {
  const url = safeHttpUrl(f.url);
  if (!url || !f.format_id) return null;
  if (/-drc$/.test(f.format_id) || f.ext === 'mhtml') return null; // storyboards, duplicated "DRC" audio

  const proto = f.protocol ?? '';
  const isHls = proto.startsWith('m3u8');
  const isDirect = proto === 'https' || proto === 'http';
  if (!isHls && !isDirect) return null; // DASH manifests, rtmp… are not directly usable

  const ext = f.ext?.toLowerCase();
  const hasV = isCodec(f.vcodec);
  const hasA = isCodec(f.acodec);
  const unknownCodecs = f.vcodec == null && f.acodec == null;

  let kind: Variant['kind'];
  if (ext && IMAGE_EXT.has(ext) && !hasV && !hasA) kind = 'image';
  else if (hasV) kind = 'video';
  else if (hasA || (unknownCodecs && ext && AUDIO_EXT.has(ext))) kind = 'audio';
  else if (unknownCodecs) kind = 'video'; // generic extractors: a plain file we know nothing about
  else return null;

  const height = f.height ?? undefined;
  const quality =
    kind === 'video'
      ? height
        ? `${height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}`
        : (f.format_note ?? undefined) || undefined
      : kind === 'audio' && f.abr
        ? `${Math.round(f.abr)}kbps`
        : (f.format_note ?? undefined) || undefined;

  return makeVariant({
    kind,
    url,
    id: f.format_id,
    quality,
    label: [quality, ext, isHls ? 'HLS' : undefined].filter(Boolean).join(' '),
    ext,
    width: f.width ?? undefined,
    height,
    fps: f.fps ?? undefined,
    codec: (hasV ? f.vcodec : hasA ? f.acodec : undefined)?.split('.')[0],
    bitrateKbps: (kind === 'audio' ? f.abr : f.tbr) ?? undefined,
    sizeBytes: f.filesize ?? f.filesize_approx ?? undefined,
    hasAudio: kind === 'video' ? (hasA ? true : unknownCodecs ? undefined : false) : undefined,
    protocol: isHls ? 'hls' : 'direct',
    headers: safeHeaders(f.http_headers),
  });
}

/** Best first: complete videos, then video-only, then audio, then images; higher resolution/bitrate first. */
function rank(v: Variant): number[] {
  const group = v.kind === 'video' ? (v.hasAudio === false ? 1 : 0) : v.kind === 'audio' ? 2 : 3;
  const mp4First = v.ext === 'mp4' || v.ext === 'm4a' ? 0 : 1;
  return [group, -(v.height ?? 0), -(v.bitrateKbps ?? 0), mp4First];
}

/** Pure mapping of `yt-dlp -J` output. Tested against real captured output. */
export function mapYtDlpInfo(raw: YtDlpInfo): MediaDraft {
  const info = raw._type === 'playlist' && raw.entries?.length ? raw.entries[0]! : raw;

  if (info.is_live || (info.live_status && info.live_status !== 'not_live' && info.live_status !== 'was_live')) {
    throw new ProviderError('unavailable', 'live streams are not supported');
  }

  const formats: Format[] = info.formats?.length ? info.formats : info.url ? [info] : [];
  let variants = formats.map(mapFormat).filter((v): v is Variant => v !== null);

  // HLS is only worth listing for a media kind that has no direct file.
  const directKinds = new Set(variants.filter((v) => v.protocol === 'direct').map((v) => v.kind));
  variants = variants.filter((v) => v.protocol === 'direct' || !directKinds.has(v.kind));

  if (variants.length === 0) throw new ProviderError('bad_response', 'yt-dlp returned no usable formats');

  variants.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return 0;
  });

  return {
    title: info.title?.trim() || null,
    author: info.uploader || info.channel || null,
    thumbnail: safeHttpUrl(info.thumbnail),
    durationSeconds: typeof info.duration === 'number' && info.duration > 0 ? info.duration : null,
    variants,
  };
}

const BLOCKED =
  /confirm you.re not a bot|HTTP Error 429|HTTP Error 403|Too Many Requests|IP address is blocked|captcha|rate-limit|login required|empty media response|use --cookies/i;
const GONE =
  /unavailable|private video|is private|been removed|been deleted|no longer available|No video could be found|Not found\.|HTTP Error 404|does not exist|account .*terminated|members-only|Unsupported URL/i;

/** Map yt-dlp's stderr to a failure kind. Order matters: "blocked" must win over "gone". */
export function classifyYtDlpFailure(stderr: string): ProviderError {
  const line = stderr.split('\n').find((l) => l.startsWith('ERROR:')) ?? stderr.trim().split('\n').pop() ?? 'unknown error';
  const message = line.replace(/^ERROR:\s*/, '').slice(0, 300);
  if (BLOCKED.test(message)) return new ProviderError('blocked', `yt-dlp: ${message}`);
  if (GONE.test(message)) return new ProviderError('unavailable', `yt-dlp: ${message}`);
  return new ProviderError('upstream', `yt-dlp: ${message}`);
}

export function ytDlpArgs(opts: YtDlpOptions, url: string): string[] {
  const args = [
    '-J',
    '--no-playlist',
    '--skip-download',
    '--no-warnings',
    '--ignore-config',
    '--socket-timeout',
    '15',
    '--js-runtimes',
    opts.jsRuntime,
  ];
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile);
  if (opts.proxy) args.push('--proxy', opts.proxy);
  args.push('--', url);
  return args;
}

export function runYtDlp(opts: YtDlpOptions, url: string, signal: AbortSignal): Promise<YtDlpInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      opts.bin,
      ytDlpArgs(opts, url),
      { maxBuffer: 30 * 1024 * 1024, signal, killSignal: 'SIGKILL', windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          if (signal.aborted) return reject(new ProviderError('timeout', 'yt-dlp timed out', { cause: error }));
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(new ProviderError('upstream', `yt-dlp binary not found (${opts.bin})`, { cause: error }));
          }
          if ((error as { code?: string }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            return reject(new ProviderError('bad_response', 'yt-dlp output too large', { cause: error }));
          }
          return reject(classifyYtDlpFailure(stderr || error.message));
        }
        try {
          resolve(JSON.parse(stdout) as YtDlpInfo);
        } catch (parseError) {
          reject(new ProviderError('bad_response', 'yt-dlp returned invalid JSON', { cause: parseError }));
        }
      },
    );
  });
}

export function createYtDlpProvider(platform: string, priority: number, opts: YtDlpOptions): Provider {
  return {
    id: `ytdlp-${platform}`,
    platform,
    priority,
    // Each call spawns a Python process (~150 MB): keep parallelism low.
    maxConcurrency: 3,
    // Extraction (and YouTube's JS challenge) takes seconds, not milliseconds.
    timeoutMs: 45_000,
    async fetch({ url, signal }) {
      return mapYtDlpInfo(await runYtDlp(opts, url.toString(), signal));
    },
  };
}

/** Returns the installed yt-dlp version, or null when it is not available. */
export function detectYtDlp(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
  });
}
