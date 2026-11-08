import { NextResponse } from "next/server";

import { NahApiError, createDownloadLink } from "@/lib/nah-api";

/**
 * POST /api/media/download-link { url, kind?, maxHeight?, audioFormat? }
 * → gateway /v1/download-links. Returns an absolute /v1/file?t=… URL the
 * browser downloads directly from the API host — bytes never transit Vercel.
 */
export async function POST(request: Request) {
  let body: {
    url?: unknown;
    kind?: unknown;
    maxHeight?: unknown;
    audioFormat?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: "bad_request", detail: "Expected a JSON body." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2048) {
    return NextResponse.json({ code: "bad_request", detail: "A media URL is required." }, { status: 400 });
  }
  const kind = body.kind === "audio" ? "audio" : "video";
  const maxHeight =
    typeof body.maxHeight === "number" && Number.isInteger(body.maxHeight) && body.maxHeight > 0
      ? Math.min(body.maxHeight, 8640)
      : undefined;
  const audioFormat = body.audioFormat === "mp3" || body.audioFormat === "original" ? body.audioFormat : undefined;

  try {
    const link = await createDownloadLink({ url, kind, maxHeight, audioFormat });
    return NextResponse.json(link);
  } catch (error) {
    if (error instanceof NahApiError) {
      return NextResponse.json(
        { code: error.code, detail: error.message },
        { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
      );
    }
    return NextResponse.json({ code: "upstream_error", detail: "Could not reach the downloader backend." }, { status: 502 });
  }
}
