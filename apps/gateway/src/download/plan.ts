import { errors } from '../errors.js';
import type { Variant } from '../providers/types.js';

export type Container = 'mp4' | 'webm' | 'matroska' | 'm4a' | 'mp3' | 'raw';

export interface DownloadOptions {
  kind: 'video' | 'audio';
  /** Highest acceptable video height. */
  maxHeight?: number | undefined;
  /** For audio: `mp3` transcodes, `original` keeps the source codec. */
  audioFormat?: 'original' | 'mp3' | undefined;
}

export interface DownloadPlan {
  /** One input = stream/remux it; two = video-only + audio-only to merge. */
  inputs: Variant[];
  container: Container;
  /** Transcode the audio track to MP3 (libmp3lame). */
  transcodeMp3: boolean;
  /** Drop the video track (audio extracted from a complete video). */
  stripVideo: boolean;
  mime: string;
  extension: string;
}

const isAvc = (c?: string) => /^(avc|h264|hev|hvc|h265)/i.test(c ?? '');
const codecPref = (c?: string) => (isAvc(c) ? 0 : /^vp0?9|^vp9/i.test(c ?? '') ? 1 : 2);
const isAac = (v: Variant) => /^mp4a|^aac/i.test(v.codec ?? '') || v.ext === 'm4a';
const isOpus = (v: Variant) => /^opus/i.test(v.codec ?? '') || v.ext === 'webm' || v.ext === 'opus';

const CONTAINERS: Record<Container, { mime: string; ext: string }> = {
  mp4: { mime: 'video/mp4', ext: 'mp4' },
  webm: { mime: 'video/webm', ext: 'webm' },
  matroska: { mime: 'video/x-matroska', ext: 'mkv' },
  m4a: { mime: 'audio/mp4', ext: 'm4a' },
  mp3: { mime: 'audio/mpeg', ext: 'mp3' },
  raw: { mime: 'application/octet-stream', ext: 'bin' },
};

const direct = (v: Variant) => (v.protocol ?? 'direct') === 'direct';
const best = <T>(items: T[], score: (t: T) => number[]): T | undefined =>
  [...items].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    return 0;
  })[0];

function make(inputs: Variant[], container: Container, extra: Partial<DownloadPlan> = {}): DownloadPlan {
  const c = CONTAINERS[container];
  return { inputs, container, transcodeMp3: false, stripVideo: false, mime: c.mime, extension: c.ext, ...extra };
}

/** Pure decision: which renditions to fetch and how to package them. */
export function planDownload(variants: readonly Variant[], opts: DownloadOptions): DownloadPlan {
  const audios = variants.filter((v) => v.kind === 'audio');
  const videos = variants.filter((v) => v.kind === 'video');
  const bestAudio = (pool: Variant[], prefer?: (v: Variant) => boolean) =>
    best(pool, (v) => [prefer && !prefer(v) ? 1 : 0, direct(v) ? 0 : 1, -(v.bitrateKbps ?? 0)]);

  if (opts.kind === 'audio') {
    const audio = bestAudio(audios);
    if (audio) {
      if (opts.audioFormat === 'mp3') return make([audio], 'mp3', { transcodeMp3: true });
      return isAac(audio) ? make([audio], 'm4a') : make([audio], 'raw', { extension: audio.ext ?? 'audio', mime: audio.mime ?? 'audio/*' });
    }
    // No audio-only rendition: extract the soundtrack from a complete video.
    const complete = best(videos.filter((v) => v.hasAudio !== false), (v) => [direct(v) ? 0 : 1, v.height ?? 0]);
    if (!complete) throw errors.noSuchMedia('This content has no audio track.');
    return make([complete], 'mp3', { transcodeMp3: true, stripVideo: true });
  }

  const limit = opts.maxHeight ?? Number.POSITIVE_INFINITY;
  const eligible = (v: Variant) => (v.height ?? 0) <= limit;
  if (videos.length === 0) throw errors.noSuchMedia('This content has no video.');
  const pool = videos.filter(eligible);
  if (pool.length === 0) throw errors.noSuchMedia(`No video rendition at or below ${limit}p.`);

  // 1) A complete rendition (audio included) needs no merging.
  const complete = best(pool.filter((v) => v.hasAudio !== false), (v) => [-(v.height ?? 0), direct(v) ? 0 : 1, v.ext === 'mp4' ? 0 : 1]);
  if (complete) {
    const container: Container = complete.ext === 'webm' ? 'webm' : complete.ext === 'mp4' || !complete.ext ? 'mp4' : 'matroska';
    return make([complete], container);
  }

  // 2) Video-only + audio-only: merge them.
  const video = best(pool, (v) => [-(v.height ?? 0), codecPref(v.codec), direct(v) ? 0 : 1]);
  if (!video) throw errors.noSuchMedia('No usable video rendition.');
  const mp4Video = isAvc(video.codec);
  const audio = bestAudio(audios, mp4Video ? isAac : isOpus);
  if (!audio) return make([video], video.ext === 'webm' ? 'webm' : 'mp4'); // silent video is better than nothing
  const container: Container = mp4Video && isAac(audio) ? 'mp4' : !mp4Video && isOpus(audio) && video.ext === 'webm' ? 'webm' : 'matroska';
  return make([video, audio], container);
}
