import type { Variant, VariantKind } from '../types.js';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function mimeFor(ext: string | undefined): string | undefined {
  return ext ? MIME[ext.toLowerCase()] : undefined;
}

/** Only ever hand back http(s) links: never `javascript:`, `data:` or relative junk from upstream HTML. */
export function safeHttpUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function makeVariant(input: {
  kind: VariantKind;
  url: string | null;
  label?: string | undefined;
  quality?: string | undefined;
  ext?: string | undefined;
  hasAudio?: boolean | undefined;
}): Variant | null {
  if (!input.url) return null;
  const variant: Variant = { kind: input.kind, url: input.url };
  if (input.label) variant.label = input.label;
  if (input.quality) variant.quality = input.quality;
  if (input.ext) {
    variant.ext = input.ext.toLowerCase();
    const mime = mimeFor(input.ext);
    if (mime) variant.mime = mime;
  }
  if (input.hasAudio !== undefined) variant.hasAudio = input.hasAudio;
  return variant;
}
