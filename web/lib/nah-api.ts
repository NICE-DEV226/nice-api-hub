import "server-only";

import type { ApiProblem, MediaEnvelope, MediaResult } from "./media-types";

/**
 * Server-side client for the nah gateway. The shared API key lives only here —
 * route handlers call these helpers, never the browser.
 */

const API_URL = (process.env.NAH_API_URL ?? "").replace(/\/+$/, "");
const API_KEY = process.env.NAH_API_KEY ?? "";

export class NahApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function configError(): NahApiError {
  return new NahApiError(500, "not_configured", "The downloader backend is not configured.");
}

async function problem(res: Response): Promise<NahApiError> {
  let body: ApiProblem = {};
  try {
    body = (await res.json()) as ApiProblem;
  } catch {
    /* non-JSON error */
  }
  return new NahApiError(
    res.status,
    body.code ?? "upstream_error",
    body.detail ?? body.title ?? `The gateway answered ${res.status}.`,
  );
}

export async function resolveMedia(url: string): Promise<MediaResult> {
  if (!API_URL || !API_KEY) throw configError();
  const res = await fetch(`${API_URL}/v1/media?url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${API_KEY}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await problem(res);
  const envelope = (await res.json()) as MediaEnvelope;
  return envelope.data;
}

export interface DownloadLinkRequest {
  url: string;
  kind?: "video" | "audio";
  maxHeight?: number;
  audioFormat?: "original" | "mp3";
}

export interface DownloadLink {
  /** Absolute URL the browser can fetch directly (bytes never touch Vercel). */
  url: string;
  expiresAt: string;
}

export async function createDownloadLink(req: DownloadLinkRequest): Promise<DownloadLink> {
  if (!API_URL || !API_KEY) throw configError();
  const res = await fetch(`${API_URL}/v1/download-links`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(req),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await problem(res);
  const body = (await res.json()) as { url: string; expiresAt: string };
  // The gateway returns a path ("/v1/file?t=…"); make it absolute for the browser.
  return { url: `${API_URL}${body.url}`, expiresAt: body.expiresAt };
}
