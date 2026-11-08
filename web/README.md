# nah — web downloader

Public, single-page media downloader: paste a link, pick a format, download.
Designed for phones and desktops. Built with Next.js 16 + Tailwind v4.

## How it works

```
browser ──POST /api/media/resolve──▶ Next.js route ──GET /v1/media────────▶ nah API (Railway)
browser ◀──media JSON (small)──────┘                                        │
browser ──POST /api/media/download-link─▶ Next.js route ──POST /v1/download-links▶ API
browser ◀──{ url: "https://api…/v1/file?t=…" }──┘                            │
browser ──GET signed URL──────────────────────────────────────────────────▶ API streams bytes
```

- The shared API key lives only in server-side route handlers (`lib/nah-api.ts`,
  marked `server-only`). It is never exposed to the browser.
- File bytes go **directly from the API to the browser** via short-lived HMAC
  grants (`/v1/file?t=…`, 15 min TTL) — nothing large passes through Vercel.
- Recent downloads are stored in `localStorage` on the device only.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NAH_API_URL` | Vercel | Base URL of the nah API, e.g. `https://nah-api.up.railway.app` |
| `NAH_API_KEY` | Vercel | Shared server-side API key (`nah_live_…`) with `media` scope |

The API must have `DOWNLOAD_ENABLED=true` (default) and include the
`/v1/download-links` + `/v1/file` routes (see `api/src/http/app.ts`).

## Local development

```bash
cp .env.example .env.local   # set NAH_API_URL + NAH_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

## Deploy on Vercel

1. Import the repository in Vercel, set **Root Directory** to `web/`.
2. Add the two environment variables above (Production + Preview).
3. Deploy. The two `/api/media/*` routes are serverless functions; the page
   itself is static.

## Deploy the API on Railway

The API ships its own `api/Dockerfile` (Node + Python + yt-dlp + ffmpeg).

1. Create a Railway service from this repo. The Dockerfile builds with **`api/` as
   the Docker build context** (`api/Dockerfile`, same as `api/compose.yaml`).
2. Required env vars: `DATABASE_URL`, `REDIS_URL`, `KEY_PEPPER`,
   `POSTGRES_PASSWORD`-backed services (Postgres + Redis plugins), `ADMIN_TOKEN`.
3. Note the public HTTPS URL Railway assigns → that is `NAH_API_URL`.

## Scripts

```bash
npm run dev      # dev server (Turbopack)
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
```
