/** Mirrors api/src/http/schemas.ts MediaSchema. */
export interface MediaVariant {
  kind: "video" | "audio" | "image";
  url: string;
  label?: string;
  quality?: string;
  width?: number;
  height?: number;
  ext?: string;
  mime?: string;
  hasAudio?: boolean;
  protocol?: "direct" | "hls";
  id?: string;
  codec?: string;
  fps?: number;
  bitrateKbps?: number;
  sizeBytes?: number;
}

export interface MediaResult {
  platform: string;
  sourceUrl: string;
  title: string | null;
  author: string | null;
  thumbnail: string | null;
  durationSeconds: number | null;
  variants: MediaVariant[];
  provider: string;
  fetchedAt: string;
}

export interface MediaEnvelope {
  data: MediaResult;
  meta: { requestId: string; cached: boolean; tookMs: number };
}

/** Mirrors the API problem+json error body. */
export interface ApiProblem {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
}
