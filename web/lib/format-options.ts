import type { MediaVariant } from "./media-types";

export interface FormatChoice {
  /** Sent to /v1/download-links. */
  kind: "video" | "audio";
  maxHeight?: number;
  audioFormat?: "original" | "mp3";
  /** Display fields. */
  title: string;
  detail: string;
  badge?: string;
}

function fmtSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(mb))} MB`;
}

function fmtDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Collapses the raw variant list into the handful of choices a user actually wants:
 * best video per height, audio as MP3 or original. Unknown/duplicate entries are dropped.
 */
export function buildFormatChoices(media: {
  variants: MediaVariant[];
  durationSeconds: number | null;
}): FormatChoice[] {
  const choices: FormatChoice[] = [];
  const seenHeights = new Set<number>();

  const videos = media.variants
    .filter((v) => v.kind === "video" && typeof v.height === "number" && v.height > 0)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  for (const v of videos) {
    const h = v.height!;
    if (seenHeights.has(h)) continue;
    seenHeights.add(h);
    const parts = [`${h}p`];
    if (v.fps && v.fps >= 50) parts.push(`${Math.round(v.fps)}fps`);
    if (v.codec) parts.push(v.codec);
    const size = fmtSize(v.sizeBytes);
    if (size) parts.push(size);
    choices.push({
      kind: "video",
      maxHeight: h,
      title: `${h}p`,
      detail: parts.slice(1).join(" · ") || "video",
      badge: v.hasAudio === false ? "no audio track" : undefined,
    });
  }

  // Fallback: a video variant without height info → single "best" choice.
  if (choices.length === 0) {
    const any = media.variants.find((v) => v.kind === "video");
    if (any) {
      choices.push({
        kind: "video",
        title: "Best quality",
        detail: [any.ext?.toUpperCase(), fmtSize(any.sizeBytes)].filter(Boolean).join(" · ") || "video",
      });
    }
  }

  const hasAudio = media.variants.some((v) => v.kind === "audio");
  if (hasAudio) {
    const dur = fmtDuration(media.durationSeconds);
    choices.push({
      kind: "audio",
      audioFormat: "mp3",
      title: "MP3",
      detail: dur ? `audio only · ${dur}` : "audio only",
    });
    choices.push({
      kind: "audio",
      audioFormat: "original",
      title: "Original audio",
      detail: "source format",
    });
  }

  return choices;
}
