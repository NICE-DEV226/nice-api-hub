# NICE-API'HUB — the API

The service behind [`nah`](../cli): one authenticated, rate-limited, cached API in front of interchangeable media providers,
with automatic failover. Fastify + TypeScript, PostgreSQL, Redis, yt-dlp and ffmpeg. This folder is self-contained: its own
`package.json`, `Dockerfile`, `compose.yaml`, tests and migrations.

```
GET /v1/media?url=https://www.tiktok.com/@user/video/123
Authorization: Bearer nah_live_…
```

**Contents:** [Run it](#run-your-own-gateway) · [Accounts without e-mail](#accounts-without-e-mail) · [The API](#the-api) ·
[Downloads](#downloads-get-v1download) · [Async jobs](#asynchronous-jobs-post-v1jobs) · [Architecture](#architecture) ·
[Operations](#operations) · [Status](#status) · [Extending](#adding-a-platform-or-provider) · [Development](#development)

## Run your own gateway

Prerequisites: Docker with the **buildx** plugin (on Arch: `sudo pacman -S docker-buildx`; without it BuildKit refuses
to build), and your user in the `docker` group.

```bash
cp .env.example .env               # fill KEY_PEPPER, ADMIN_TOKEN, POSTGRES_PASSWORD (openssl rand -base64 48)
docker compose up -d --build           # postgres, redis, migrate (one-shot), api, worker
curl localhost:3000/readyz             # {"status":"ready", ...}
```

Choose how people get accounts with `SIGNUP_MODE` in `.env`:

| Mode | Behaviour |
|---|---|
| `closed` (default) | Only you create accounts (admin API or `nah admin`) |
| `open` | Anyone can create an account from `nah` (proof of work, one per machine, per-IP limit) |
| `invite` | Same, but needs one of `SIGNUP_INVITE_CODES` |

You are the only operator: keep the single `ADMIN_TOKEN`. Store it once on your machine (`nah login` puts it in the system
keychain) and give your own computer a normal account for your downloads (`nah register`, or the welcome screen).

Without the CLI, plain HTTP works too:

```bash
curl -s -X POST localhost:3000/admin/v1/accounts \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme","planId":"pro"}'
curl -s -X POST localhost:3000/admin/v1/accounts/<id>/keys \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"label":"prod"}'
```

Interactive API docs: `/docs`. Machine-readable spec: `/openapi.json`.

Without Docker: `scripts/dev-services.sh start` launches throwaway Postgres + Redis on high
ports (prints the env to export), then `npm run cli -- migrate` and `npm run dev`.

## Accounts without e-mail

A person is identified by their **computer**, not by an address. No e-mail, no password, nothing to remember.

```
GET  /v1/register           → can I create an account here? + a puzzle to solve
POST /v1/register           → account + your device key + an offline RECOVERY key (both shown once)
POST /v1/link               → (device key) a one-time code, valid 10 min, to add another computer
POST /v1/link/redeem        → (new computer) trade that code for its own key on the same account
POST /v1/recover            → (recovery key) get a working key on a new computer if the old one is lost
GET/POST /v1/keys …         → list, create, revoke, rotate YOUR keys
```

Every computer has its own key, revocable individually, and the plan limits how many (free: 3). Keys carry **scopes**:
`media` (use the API), `keys` (manage keys and link codes), `recover` (can do nothing except mint a device key: keep it
offline). Anything not listed needs `media`, so a new route is safe by default.

Anti-abuse without e-mail, each free for one person and costly for a bot: a **proof of work** solved by the client
(`REGISTER_POW_BITS`, single-use, signed and stateless), **one active account per machine** (`REGISTER_ONE_PER_DEVICE`;
only a keyed hash of a machine fingerprint is stored, never the raw id), and a **per-IP limit** that also covers
invite-code and link-code guessing. These raise the cost of mass registration; they are not guarantees, since a
fingerprint can be forged. Lose every computer *and* the recovery key, and the account is gone: acceptable for a free,
anonymous account. `SIGNUP_MODE` is `closed` (default), `open`, or `invite`.

## The API

The core call resolves a link into downloadable variants:

```
GET /v1/media?url=https://www.tiktok.com/@user/video/123
Authorization: Bearer nah_live_…
```

```jsonc
{
  "data": {
    "platform": "tiktok",
    "sourceUrl": "https://www.tiktok.com/@user/video/123",
    "title": "…", "author": "BBC News", "thumbnail": "https://…", "durationSeconds": 32,
    "variants": [
      { "kind": "video", "quality": "hd", "ext": "mp4", "mime": "video/mp4", "hasAudio": true, "url": "https://…" },
      { "kind": "audio", "ext": "mp3", "mime": "audio/mpeg", "url": "https://…" }
    ],
    "provider": "tikwm",
    "fetchedAt": "2026-09-19T15:00:00.000Z"
  },
  "meta": { "requestId": "…", "cached": false, "tookMs": 812 }
}
```

The response shape is identical for every platform and every provider.

The response shape is identical for every platform and every provider.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /v1/media?url=` | API key | Resolve media (platform auto-detected) |
| `POST /v1/jobs` · `GET /v1/jobs/:id` | API key | Queue an extraction; get the result by polling or by signed webhook |
| `GET /v1/account` | API key | Your plan, limits and webhook secret |
| `GET /v1/download?url=&kind=&maxHeight=&audioFormat=` | API key | Stream the media as ONE playable file (merges video+audio, extracts MP3) |
| `GET /v1/usage?days=` | API key | Your plan limits and recent usage |
| `GET /v1/thumbnail?url=` | API key | The preview image of a media you just resolved. The gateway fetches it (JPEG, PNG, WebP or GIF, at most 4 MiB), so the CDN never sees your address. Not an open proxy: only thumbnails returned by `/v1/media` in the last hour, and every hop goes through the SSRF guard |
| `GET /v1/platforms` | none | Supported platforms + live status (`operational`/`degraded`/`down`/`unknown`) |
| `/admin/v1/*` | admin token | Plans, accounts, keys (create / revoke / rotate with grace period), usage, audit |
| `GET /healthz` · `/readyz` | none | Liveness · readiness (Postgres + Redis) |
| `GET /metrics` | metrics token | Prometheus. In production only exposed when `METRICS_TOKEN` is set |

Auth: `Authorization: Bearer <key>` or `X-API-Key: <key>`.

Self-service endpoints (`/v1/register`, `/v1/link*`, `/v1/recover`, `/v1/keys*`) are described in
[Accounts without e-mail](#accounts-without-e-mail).

**Two budgets.** Calls that do work (`/v1/media`, `/v1/download`, `POST /v1/jobs`) spend your plan's rate limit and daily
quota. Cheap control calls (`/v1/account`, `/v1/usage`, `/v1/thumbnail`, `GET /v1/jobs/:id`, `/v1/keys*`, `/v1/link`, `/v1/recover`) use a
separate, generous bucket that never touches the daily quota, so a UI that refreshes its screen cannot use up your downloads.

Rate-limit headers on every authenticated response: `RateLimit-Limit` (burst), `RateLimit-Remaining`,
`RateLimit-Reset`, `X-Quota-Limit`, `X-Quota-Remaining`. On `429`: `Retry-After`.
Error codes you'll meet: `unauthorized`, `account_suspended`, `platform_not_allowed`, `invalid_request`,
`unsupported_platform`, `content_unavailable` (422), `rate_limited` / `quota_exceeded` (429),
`upstream_unavailable` (502, lists every provider attempt), `overloaded` (503).

Default plans (editable via `PUT /admin/v1/plans/:id`):

| Plan | Sustained | Burst | Daily | Active keys |
|---|---|---|---|---|
| free | 5 / min | 5 | 100 | 3 |
| basic | 20 / min | 20 | 1 000 | 5 |
| pro | 100 / min | 100 | 10 000 | 20 |
| enterprise | 1 000 / min | 500 | unlimited | 100 |

## Downloads (`GET /v1/download`)

`/v1/media` returns links. For YouTube those links are not enough, for two reasons found while testing on the
real service: YouTube no longer serves combined audio+video files (0 of 53 formats), and its links are bound to the
IP that requested them. `/v1/download` solves both: the gateway fetches the renditions itself, merges them with
ffmpeg and streams **one file** back.

```bash
# best MP4 up to 720p, video and audio merged
curl -H "Authorization: Bearer $KEY" -o clip.mp4 \
  "https://api.example.com/v1/download?url=https://www.youtube.com/watch?v=aqz-KE-bpKQ&maxHeight=720"
# audio only, as MP3
curl -H "Authorization: Bearer $KEY" -o song.mp3 \
  "https://api.example.com/v1/download?url=…&kind=audio&audioFormat=mp3"
```

Measured against the real services (YouTube, 10 min 35 s video at 360p, from a home connection):
extraction 11 s, then 28.5 MB downloaded, merged and streamed in about 30 s. The gateway downloads in 8 MiB `Range`
chunks because CDNs throttle a single long GET to playback speed (measured: 57 KB/s for one GET vs 5.7 MB/s per
ranged request; the first implementation took 280 s for 540 s of video).

Guard rails: SSRF check on every media URL and redirect hop (private, loopback and link-local addresses refused),
ffmpeg locked to a per-input protocol whitelist, a cap on concurrent transfers (`503` + `Retry-After`), a hard time
limit and a size limit, and cleanup of ffmpeg when the client disconnects. There are no `Range` requests on the
response and no resume; each transfer costs bandwidth and CPU, so size `DOWNLOAD_MAX_CONCURRENCY` accordingly.

## Asynchronous jobs (`POST /v1/jobs`)

Extraction takes 8 to 17 s with yt-dlp, which is too long to hold a request open. Submit a job, get `202` at once,
then poll or receive a webhook.

```bash
curl -X POST https://api.example.com/v1/jobs -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: order-42" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ","webhookUrl":"https://your.app/hooks/nah"}'
# 202 {"data":{"id":"job_…","status":"queued",…}}   Location: /v1/jobs/job_…
curl -H "Authorization: Bearer $KEY" https://api.example.com/v1/jobs/job_…
```

A job goes `queued → running → succeeded | failed`. On success `result` is the same object `/v1/media` returns; on failure
`error` has the same stable `code`s as the synchronous API. Jobs and results are kept for `JOBS_TTL_SECONDS` (24 h).

- **Idempotency**: repeat a submission with the same `Idempotency-Key` and you get the original job back
  (`Idempotent-Replayed: true`), so retrying a timed-out `POST` never creates duplicates.
- **Backpressure**: at most `JOBS_MAX_PENDING_PER_ACCOUNT` unfinished jobs per account, then `429 too_many_jobs`.
- **Isolation**: another account's job is indistinguishable from a missing one (404).
- **Webhooks** carry `{"event":"job.completed"|"job.failed","data":<job>}` and are signed. Get your secret from
  `GET /v1/account` (operators can rotate it with `POST /admin/v1/accounts/:id/webhook-secret/rotate`).
  `X-NAH-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC_SHA256(secret, "<t>.<raw body>")`. Verify against the RAW body,
  compare in constant time, and reject timestamps older than 5 minutes:

  ```js
  import { createHmac, timingSafeEqual } from 'node:crypto';
  function verify(secret, header, rawBody, toleranceSec = 300) {
    const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
    const mac = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
    const got = Buffer.from(v1 ?? '', 'hex');
    return got.length === mac.length && timingSafeEqual(got, mac);
  }
  ```

  Failed deliveries are retried with backoff (default: immediately, 30 s, 2 min, 10 min, 1 h; `JOBS_WEBHOOK_BACKOFF_MS`).
  Each attempt has its own `X-NAH-Delivery` id. Delivery is **at-least-once**: make your receiver idempotent (dedupe on the job id).
  The receiver URL is refused if it points at a private network, and redirects are never followed.
- **Reliability**: the queue lives in Redis with atomic claims. If a worker dies mid-job, a sweeper re-queues the job
  (up to 3 runs, then `failed` with `job_stalled`). Any API replica processes jobs; add replicas to add throughput.

## Architecture

```
                         ┌──────────────────────── gateway (stateless, N replicas) ────────────────────────┐
 client ── Bearer key ──▶│ auth ─▶ rate limit ─▶ platform allowlist ─▶ cache ─▶ single-flight ─▶ providers │
                         │  │          │                                  │                        │        │
                         │  ▼          ▼                                  ▼                        ▼        │
                         │ Redis     Redis (Lua, atomic)               Redis              circuit breaker   │
                         │ (60 s)    GCRA + daily quota                (short TTL)        + bulkhead        │
                         └───────┬─────────────────────────────────────────────────────────────┬──────────┘
                                 │ miss                                                          │
                              Postgres  ◀── usage: batched UPSERTs, off the hot path             ▼
                        (accounts, plans, keys,                                   upstream A ─ fallback ─ B
                         usage_daily, audit_log)
 operator ── admin token ──▶ /admin/v1  (accounts, plans, keys: create / revoke / rotate)
 worker ── synthetic probes ──▶ Redis ──▶ public GET /v1/platforms
```

Design decisions worth knowing:

| Concern | Decision | Why |
|---|---|---|
| Hot path | Never touches Postgres on a warm request | Keys resolve from Redis; usage is buffered and flushed in batches |
| Quotas | Per **account**, not per key | Extra keys can't multiply a customer's allowance |
| Rate limiting | GCRA + daily counter in one Lua script | Atomic, O(1), exact under concurrency, server-side clock |
| Provider faults | Rolling-window circuit breaker + per-provider bulkhead | A dead or slow upstream degrades only itself and is not hammered |
| Failure semantics | "Content gone" ≠ "provider broken" | Dead links don't trip breakers and are negatively cached |
| Health | Synthetic probes + breakers, never customer traffic | Clients can't fake an outage by sending bad requests |
| Redis outage | Configurable `RATE_LIMIT_FAIL_MODE` (default `open`) | Availability vs. strict enforcement is the operator's call |
| Keys | `nah_<env>_<192-bit random>`, stored as HMAC-SHA256 with a server pepper | A database dump alone is useless |
| Errors | RFC 9457 `application/problem+json`, stable `code`s | Machine-readable, no stack traces, always a `requestId` |
| Input | Host allowlist per platform, URL canonicalisation | Not an open relay; equivalent URLs share a cache entry |

## Operations

- **Configuration** is validated at boot; the process refuses to start on a missing or too-short secret
  (there are no built-in fallback secrets).
- **Scaling**: replicas are stateless. Per-process state is limited to circuit breakers and bulkheads
  (each replica learns upstream health on its own) and a small usage buffer.
- **Shutdown**: on `SIGTERM` it stops accepting, drains in-flight requests, flushes buffered usage, then exits.
- **Usage accuracy**: usage is aggregated per account/day/platform and flushed every `USAGE_FLUSH_INTERVAL_MS`.
  A hard crash can lose at most one interval of counters. Quota *enforcement* lives in Redis and is exact.
- **Rotating `KEY_PEPPER`** invalidates every issued key. Rotate individual keys with `/keys/:id/rotate` instead.

## Status

Every provider below was exercised against the real upstream on 2026-09-19 (`npm run probe`, all green), and its
parser is tested on real captured output (`test/fixtures`).

| Platform | Providers (in failover order) |
|---|---|
| YouTube | yt-dlp |
| TikTok | tikwm (JSON API, concurrency 1) → yt-dlp |
| X / Twitter | twmate → yt-dlp |
| Bluesky | official AT Protocol AppView → yt-dlp |
| Dailymotion | player metadata → yt-dlp |
| Instagram, Facebook, SoundCloud, LinkedIn, Pinterest | yt-dlp |

yt-dlp is the engine behind most of this: one actively maintained extractor instead of a dozen scrapers of
ad-supported sites that break silently. Dedicated fast providers stay in front where they are reliable, and requests
fail over to yt-dlp automatically. Extraction with yt-dlp takes 8 to 17 s here (Python start-up, YouTube's signature
challenge), so results are cached and callers need generous timeouts.

What was found dead or unusable (and is therefore not offered):

- `tikdownloader.io` (was the TikTok provider): Cloudflare managed challenge, unusable server-side. The gateway does
  not try to defeat anti-bot challenges.
- `vidfly` (was the YouTube provider): API gone. Public Piped/Invidious instances: all blocked or disabled.
- Reddit: `reddit.com/.json` answers 403 from the test network. Kuaishou upstream: no response. Tumblr upstream
  (`tumbleclip.com`): 404.
- Spotify: not offered. Its streams are DRM-protected; "downloaders" work around that, which this project does not do.

Not verified yet (no real sample URL tested): Reddit via yt-dlp, Tumblr with a genuine video post, Snapchat Spotlight,
Threads, CapCut, Douyin, Kuaishou, Terabox. yt-dlp has extractors for several of them: to add one, declare the
platform in `providers/platforms.ts`, add a `createYtDlpProvider(...)` line in `http/app.ts`, add its URL to
`scripts/probe.ts`, and keep it only if the probe passes.

### Things to know before running this for real

- **YouTube blocks many datacenter IPs** ("Sign in to confirm you're not a bot"). It worked from a residential
  connection; from a cloud VM expect failures. Options: `YTDLP_PROXY` (residential/ISP proxy) or `YTDLP_COOKIES_FILE`.
  The gateway reports this as `blocked` and fails over; it does not attempt to bypass it.
- **Keep yt-dlp current.** YouTube breaks extractors regularly and fixes land in hours. The image pins a version
  (`--build-arg YTDLP_VERSION=…`); rebuild often. The `Provider probe` workflow runs daily and fails when a provider breaks.
- **Merging reads video and audio through pipes**, so inputs must be streamable (fragmented MP4 or WebM, which is what
  YouTube serves). A non-fragmented MP4 whose index sits at the end cannot be merged that way; complete files are
  proxied unchanged instead.
- **HLS inputs are opened by ffmpeg itself**, so a hostile playlist could point at internal hosts. Deny private egress
  at the network level (firewall / security group) in production; the in-process check cannot defend against DNS rebinding.
- yt-dlp reports session cookies for some CDNs (TikTok). The gateway deliberately never exposes or forwards them, so
  `/v1/download` through the yt-dlp fallback for TikTok may be refused by the CDN; the primary TikTok provider does not need them.
- Legal: see below. Serving YouTube content is against YouTube's terms; that is a business decision, not a technical one.

Other gaps:

- Jobs cover extraction only; a finished job returns links, use `/v1/download` to stream the file.
- Billing is deliberately out of scope: plans are entitlements only.
- **Docker was verified end to end** (Docker 29 on Arch, 2026-09-19): the image builds (612 MB: Node 22, Python, ffmpeg 8,
  yt-dlp), `compose.yaml` brings up Postgres, Redis, the one-shot migration, the API and the worker; only the API port is
  published. Inside the container: `/readyz` green, `/v1/media` for Bluesky (4.5 s) and YouTube through yt-dlp on Alpine (13 s),
  `/v1/download` YouTube to MP3 (10 min 34 s, decoded duration exact, 23 s), 0 error-level log lines, and `SIGTERM` stops the
  API and the worker with exit code 0 in under a second.

## Adding a platform or provider

1. Platform (host allowlist + canonicalisation): `src/providers/platforms.ts`.
2. Provider: implement `Provider` (`fetch(ctx) → MediaDraft`, throw `ProviderError` with the right `kind`)
   in `providers/impl/`, register it in `buildDefaultProviders` (`http/app.ts`).
   Several providers per platform give you failover for free; `priority` decides the order.
3. Put the HTML/JSON → model mapping in a pure `parse…` function and unit-test it against a captured fixture.
4. Add a known-good URL to `PROBE_URLS` so its health shows up in `/v1/platforms`.

## Development

```bash
npm ci
npm run typecheck && npm test          # integration tests need TEST_DATABASE_URL / TEST_REDIS_URL, else they skip
```

Tests run against real Postgres and Redis (no mocks for the data plane): atomic rate limiting under
concurrency, cache invalidation on revoke/plan change, quota sharing across keys, failover,
fail-open/closed behaviour with Redis down.

The Go program has its own tests (`cd cli && make test`, or `make race`); they use a fake gateway and, for the
interface, `teatest`. CI runs the gateway tests against real Postgres and Redis, the CLI tests with the race detector, and a
Docker build (`.github/workflows/ci.yml`). A daily workflow (`probe.yml`) checks that every provider still works.

## Legal note

Providers call third-party services whose terms may restrict automated use, and downloading content from some
platforms may conflict with their terms or with copyright. Keep the provider layer swappable and review the licensing
of any code you port from the upstream project before commercial use.
