import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough, pipeline, Readable, Transform } from 'node:stream';
import { AppError, errors } from '../errors.js';
import type { Variant } from '../providers/types.js';
import type { DownloadPlan } from './plan.js';
import { assertPublicHttpUrl } from './urlGuard.js';

export interface StreamLimits {
  ffmpegPath: string;
  maxBytes: number;
  maxSeconds: number;
  allowPrivateHosts: boolean;
}

export interface OpenStream {
  stream: Readable;
  contentType: string;
  /** Only known when the bytes are proxied unchanged. */
  contentLength?: number;
  /** Stop everything (client went away, timeout…). Idempotent. */
  dispose(): void;
}

/** ffmpeg takes headers as one CRLF-joined string: refuse anything that could smuggle an extra header. */
function headerArgs(headers: Record<string, string> | undefined): string[] {
  if (!headers) return [];
  const args: string[] = [];
  const extra: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value) || !/^[A-Za-z0-9-]+$/.test(name)) continue;
    if (name.toLowerCase() === 'user-agent') args.push('-user_agent', value);
    else extra.push(`${name}: ${value}`);
  }
  if (extra.length) args.push('-headers', extra.join('\r\n') + '\r\n');
  return args;
}

function containerArgs(plan: DownloadPlan): string[] {
  switch (plan.container) {
    case 'mp4':
    case 'm4a':
      return ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'];
    case 'webm':
      return ['-f', 'webm'];
    case 'mp3':
      return ['-f', 'mp3'];
    default:
      return ['-f', 'matroska'];
  }
}

/**
 * `sources[i]` overrides the i-th input: `pipe:N` for renditions the gateway downloads itself
 * (see `rangedStream`), otherwise ffmpeg opens the URL (HLS playlists) with the CDN headers.
 */
export function ffmpegArgs(plan: DownloadPlan, limits: Pick<StreamLimits, 'maxBytes'>, sources: readonly string[] = []): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  // -protocol_whitelist is a PER-INPUT option: it must precede every -i. `pipe` is only granted to the
  // inputs we feed ourselves, so a hostile HLS playlist cannot read our other descriptors or local files.
  plan.inputs.forEach((input, i) => {
    const source = sources[i] ?? input.url;
    if (source.startsWith('pipe:')) args.push('-protocol_whitelist', 'pipe', '-i', source);
    else args.push('-protocol_whitelist', 'http,https,tcp,tls,crypto', ...headerArgs(input.headers), '-i', source);
  });

  if (plan.transcodeMp3) args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
  else if (plan.inputs.length === 2) args.push('-map', '0:v:0', '-map', '1:a:0', '-c', 'copy');
  else args.push('-map', '0', '-c', 'copy');

  args.push(...containerArgs(plan));
  args.push('-fs', String(limits.maxBytes), 'pipe:1');
  return args;
}

const canProxy = (plan: DownloadPlan): boolean => {
  const [only] = plan.inputs;
  return (
    plan.inputs.length === 1 &&
    only !== undefined &&
    (only.protocol ?? 'direct') === 'direct' &&
    !plan.transcodeMp3 &&
    !plan.stripVideo &&
    (plan.container === 'raw' || only.ext === plan.extension || (plan.container === 'm4a' && only.ext === 'm4a'))
  );
};

/** Byte-cap so a misbehaving upstream can't stream forever. */
function capBytes(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) cb(new Error('download exceeds the size limit'));
      else cb(null, chunk);
    },
  });
}

/** fetch() that re-validates every redirect hop against the SSRF guard. */
async function guardedFetch(
  input: Variant,
  limits: StreamLimits,
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  let current = await assertPublicHttpUrl(input.url, limits.allowPrivateHosts);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, { headers: { ...input.headers, ...extraHeaders }, redirect: 'manual', signal });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = await assertPublicHttpUrl(new URL(location, current).toString(), limits.allowPrivateHosts);
      continue;
    }
    return res;
  }
  throw errors.downloadFailed('Too many redirects from the media host.');
}

const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Download a direct file in ranged chunks.
 *
 * Why: CDNs (googlevideo above all) throttle one long GET to roughly playback speed, while
 * sequential `Range` requests run at full speed. Measured on YouTube: 57 KB/s for a single
 * GET vs 5.7 MB/s per 4 MiB range. A server that ignores `Range` (answers 200) is streamed whole.
 *
 * The first request is made eagerly so failures surface before any response header is sent
 * and the total size (Content-Range) is known.
 */
async function rangedStream(
  input: Variant,
  limits: StreamLimits,
  signal: AbortSignal,
): Promise<{ stream: Readable; totalBytes?: number; contentType?: string }> {
  const first = await guardedFetch(input, limits, signal, { range: `bytes=0-${CHUNK_BYTES - 1}` });
  if (first.status !== 200 && first.status !== 206) {
    await first.body?.cancel().catch(() => {});
    throw errors.downloadFailed(`The media host answered HTTP ${first.status}.`);
  }

  const totalOf = (res: Response): number | undefined => {
    const range = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    if (range) return Number(range[1]);
    if (res.status === 200) {
      const length = Number(res.headers.get('content-length') ?? NaN);
      return Number.isFinite(length) ? length : undefined;
    }
    return undefined;
  };
  const totalBytes = totalOf(first);
  if (totalBytes !== undefined && totalBytes > limits.maxBytes) {
    await first.body?.cancel().catch(() => {});
    throw errors.downloadFailed('The file exceeds the size limit.');
  }

  async function* chunks(): AsyncGenerator<Buffer> {
    let res: Response | null = first;
    let offset = 0;
    while (res) {
      if (!res.body) return;
      for await (const piece of Readable.fromWeb(res.body as never)) {
        offset += (piece as Buffer).length;
        yield piece as Buffer;
      }
      if (res.status === 200) return; // Range ignored: the whole file just streamed
      if (totalBytes !== undefined && offset >= totalBytes) return;
      res = await guardedFetch(input, limits, signal, { range: `bytes=${offset}-${offset + CHUNK_BYTES - 1}` });
      if (res.status === 416) return;
      if (res.status !== 206) throw new Error(`media host answered HTTP ${res.status}`);
    }
  }

  const stream = Readable.from(chunks(), { objectMode: false });
  stream.on('error', () => {});
  return {
    stream,
    ...(totalBytes !== undefined ? { totalBytes } : {}),
    ...(first.headers.get('content-type') ? { contentType: first.headers.get('content-type')! } : {}),
  };
}

async function openProxy(plan: DownloadPlan, limits: StreamLimits): Promise<OpenStream> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.maxSeconds * 1000);
  timer.unref();
  const dispose = () => {
    clearTimeout(timer);
    controller.abort();
  };

  let ranged: Awaited<ReturnType<typeof rangedStream>>;
  try {
    ranged = await rangedStream(plan.inputs[0]!, limits, controller.signal);
  } catch (error) {
    dispose();
    if (error instanceof AppError) throw error;
    throw errors.downloadFailed('Could not reach the media host.');
  }

  // pipeline() (not .pipe()) so that an abort of the upstream request, a byte-cap breach or a
  // client disconnect surfaces as an error on `stream` instead of an uncaught exception.
  const stream = capBytes(limits.maxBytes);
  pipeline(ranged.stream, stream, () => {});
  stream.on('error', () => {}); // the route logs; this guarantees an 'error' listener always exists
  stream.on('close', () => clearTimeout(timer));
  return {
    stream,
    contentType: plan.inputs[0]!.mime ?? ranged.contentType ?? plan.mime,
    ...(ranged.totalBytes !== undefined ? { contentLength: ranged.totalBytes } : {}),
    dispose,
  };
}

async function openFfmpeg(plan: DownloadPlan, limits: StreamLimits): Promise<OpenStream> {
  for (const input of plan.inputs) await assertPublicHttpUrl(input.url, limits.allowPrivateHosts);

  const controller = new AbortController();
  // Direct files are downloaded by us (ranged, throttle-proof) and fed to ffmpeg over extra pipes
  // (fd 3, 4…). HLS playlists are opened by ffmpeg itself.
  const feeds: Array<{ fd: number; input: Variant }> = [];
  const sources = plan.inputs.map((input) => {
    if ((input.protocol ?? 'direct') !== 'direct') return input.url;
    const fd = 3 + feeds.length;
    feeds.push({ fd, input });
    return `pipe:${fd}`;
  });

  // Fetch the first bytes of every direct input BEFORE spawning: unreachable media fails fast.
  const opened: Array<{ fd: number; stream: Readable }> = [];
  try {
    for (const feed of feeds) opened.push({ fd: feed.fd, stream: (await rangedStream(feed.input, limits, controller.signal)).stream });
  } catch (error) {
    controller.abort();
    if (error instanceof AppError) throw error;
    throw errors.downloadFailed('Could not reach the media host.');
  }

  const child = spawn(limits.ffmpegPath, ffmpegArgs(plan, limits, sources), {
    stdio: ['ignore', 'pipe', 'pipe', ...feeds.map(() => 'pipe' as const)],
  }) as ChildProcessWithoutNullStreams;
  for (const { fd, stream } of opened) {
    const target = child.stdio[fd] as NodeJS.WritableStream;
    target.on('error', () => {}); // EPIPE once ffmpeg has all it needs
    pipeline(stream, target as never, () => {});
  }

  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    if (stderr.length < 4096) stderr += d.toString();
  });

  const out = new PassThrough();
  pipeline(child.stdout, out, () => {});
  out.on('error', () => {}); // see openProxy
  const kill = () => {
    controller.abort();
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  };
  const timer = setTimeout(kill, limits.maxSeconds * 1000);
  timer.unref();

  let started = false;
  const ready = new Promise<void>((resolve, reject) => {
    out.once('readable', () => {
      started = true;
      resolve();
    });
    child.once('error', (e) => reject(errors.downloadFailed(`Cannot run ffmpeg: ${(e as NodeJS.ErrnoException).code ?? e.message}`)));
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim().split('\n').pop()?.slice(0, 200) ?? 'unknown error';
        if (!started) reject(errors.downloadFailed('The media could not be fetched or merged.'));
        out.destroy(new Error(`ffmpeg exited with ${code}: ${detail}`));
      }
    });
  });

  try {
    await ready;
  } catch (error) {
    kill();
    throw error;
  }

  out.on('close', kill);
  return { stream: out, contentType: plan.mime, dispose: kill };
}

export function openDownload(plan: DownloadPlan, limits: StreamLimits): Promise<OpenStream> {
  return canProxy(plan) ? openProxy(plan, limits) : openFfmpeg(plan, limits);
}

/** Non-queueing concurrency cap: full means 503, not a pile-up of half-open transfers. */
export class SlotLimiter {
  private active = 0;
  constructor(private readonly max: number) {}
  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
  get inUse(): number {
    return this.active;
  }
}

export function safeFilename(title: string | null, extension: string): string {
  const base = (title ?? 'download')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${base || 'download'}.${extension}`;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
