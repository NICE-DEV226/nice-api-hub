import { NextResponse } from "next/server";

import { NahApiError, resolveMedia } from "@/lib/nah-api";

/** POST /api/media/resolve { url } → gateway /v1/media (JSON only, small payload). */
export async function POST(request: Request) {
  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return NextResponse.json({ code: "bad_request", detail: "Expected a JSON body." }, { status: 400 });
  }
  if (!url || url.length > 2048) {
    return NextResponse.json({ code: "bad_request", detail: "A media URL is required." }, { status: 400 });
  }

  try {
    const media = await resolveMedia(url);
    return NextResponse.json({ data: media });
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
