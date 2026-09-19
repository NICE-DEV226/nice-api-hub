/** Unified media model: identical for every platform and every provider. */
export type VariantKind = 'video' | 'audio' | 'image';

export interface Variant {
  kind: VariantKind;
  url: string;
  /** Human label as reported upstream, e.g. "MP4 HD". */
  label?: string;
  quality?: string;
  width?: number;
  height?: number;
  ext?: string;
  mime?: string;
  hasAudio?: boolean;
  /** `direct`: a file you can GET. `hls`: an .m3u8 playlist that needs a player / ffmpeg. */
  protocol?: 'direct' | 'hls';
}

export interface MediaDraft {
  title: string | null;
  author: string | null;
  thumbnail: string | null;
  durationSeconds: number | null;
  variants: Variant[];
}

export interface Media extends MediaDraft {
  platform: string;
  sourceUrl: string;
  provider: string;
  fetchedAt: string;
}

export interface FetchContext {
  /** Canonical URL of the content. */
  url: URL;
  signal: AbortSignal;
  requestId?: string;
}

/**
 * A provider is one concrete way to obtain media for a platform (usually an upstream
 * third-party service). Several providers can serve the same platform; the
 * orchestrator fails over between them.
 */
export interface Provider {
  readonly id: string;
  readonly platform: string;
  /** Lower runs first. */
  readonly priority: number;
  /** Cap on simultaneous calls to this upstream (default: global setting). Use 1 for fragile free APIs. */
  readonly maxConcurrency?: number;
  fetch(ctx: FetchContext): Promise<MediaDraft>;
}

export interface Platform {
  readonly id: string;
  readonly displayName: string;
  /** Hostname suffixes owned by the platform (`tiktok.com` also matches `vm.tiktok.com`). */
  readonly hosts: readonly string[];
  /** Strip everything that does not identify the content (tracking params, fragments…). */
  canonicalize?(url: URL): void;
}

/**
 * Why a provider attempt failed. This decides what the orchestrator does next:
 *  - `upstream` / `timeout` / `blocked` / `bad_response`: the provider's fault → count it
 *    against its circuit breaker and try the next provider.
 *  - `unavailable`: the CONTENT is gone/private → stop, do not blame the provider.
 */
export type FailureKind = 'upstream' | 'timeout' | 'blocked' | 'bad_response' | 'unavailable';

export class ProviderError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }

  get blamesProvider(): boolean {
    return this.kind !== 'unavailable';
  }
}
