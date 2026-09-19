# NICE-API'HUB

API-first media extraction gateway. One authenticated, rate-limited, cached endpoint in front of
interchangeable upstream providers, with automatic failover.

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

## Quick start

```bash
cp apps/gateway/.env.example .env      # fill KEY_PEPPER, ADMIN_TOKEN, POSTGRES_PASSWORD (openssl rand -base64 48)
docker compose up -d --build           # postgres, redis, migrate (one-shot), api, worker

# Create a customer and issue a key (shown once)
curl -s -X POST localhost:3000/admin/v1/accounts \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme","planId":"pro"}'
curl -s -X POST localhost:3000/admin/v1/accounts/<id>/keys \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"label":"prod"}'
```

Interactive docs: `/docs`. Machine-readable spec: `/openapi.json`.

Without Docker: `apps/gateway/scripts/dev-services.sh start` launches throwaway Postgres + Redis on high
ports (prints the env to export), then `npm run cli -w @nice-api-hub/gateway -- migrate` and `npm run dev`.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /v1/media?url=` | API key | Resolve media (platform auto-detected) |
| `GET /v1/usage?days=` | API key | Your plan limits and recent usage |
| `GET /v1/platforms` | none | Supported platforms + live status (`operational`/`degraded`/`down`/`unknown`) |
| `/admin/v1/*` | admin token | Plans, accounts, keys (create / revoke / rotate with grace period), usage, audit |
| `GET /healthz` · `/readyz` | none | Liveness · readiness (Postgres + Redis) |
| `GET /metrics` | metrics token | Prometheus. In production only exposed when `METRICS_TOKEN` is set |

Auth: `Authorization: Bearer <key>` or `X-API-Key: <key>`.

Rate-limit headers on every authenticated response: `RateLimit-Limit` (burst), `RateLimit-Remaining`,
`RateLimit-Reset`, `X-Quota-Limit`, `X-Quota-Remaining`. On `429`: `Retry-After`.
Error codes you'll meet: `unauthorized`, `account_suspended`, `platform_not_allowed`, `invalid_request`,
`unsupported_platform`, `content_unavailable` (422), `rate_limited` / `quota_exceeded` (429),
`upstream_unavailable` (502, lists every provider attempt), `overloaded` (503).

Default plans (editable via `PUT /admin/v1/plans/:id`):

| Plan | Sustained | Burst | Daily | Active keys |
|---|---|---|---|---|
| free | 5 / min | 5 | 100 | 2 |
| basic | 20 / min | 20 | 1 000 | 5 |
| pro | 100 / min | 100 | 10 000 | 20 |
| enterprise | 1 000 / min | 500 | unlimited | 100 |

## Adding a platform or provider

1. Platform (host allowlist + canonicalisation): `apps/gateway/src/providers/platforms.ts`.
2. Provider: implement `Provider` (`fetch(ctx) → MediaDraft`, throw `ProviderError` with the right `kind`)
   in `providers/impl/`, register it in `DEFAULT_PROVIDERS` (`http/app.ts`).
   Several providers per platform give you failover for free; `priority` decides the order.
3. Put the HTML/JSON → model mapping in a pure `parse…` function and unit-test it against a captured fixture.
4. Add a known-good URL to `PROBE_URLS` so its health shows up in `/v1/platforms`.

## Operations

- **Configuration** is validated at boot; the process refuses to start on a missing or too-short secret
  (there are no built-in fallback secrets).
- **Scaling**: replicas are stateless. Per-process state is limited to circuit breakers and bulkheads
  (each replica learns upstream health on its own) and a small usage buffer.
- **Shutdown**: on `SIGTERM` it stops accepting, drains in-flight requests, flushes buffered usage, then exits.
- **Usage accuracy**: usage is aggregated per account/day/platform and flushed every `USAGE_FLUSH_INTERVAL_MS`.
  A hard crash can lose at most one interval of counters. Quota *enforcement* lives in Redis and is exact.
- **Rotating `KEY_PEPPER`** invalidates every issued key. Rotate individual keys with `/keys/:id/rotate` instead.

## Development

```bash
npm ci
npm run typecheck && npm test          # integration tests need TEST_DATABASE_URL / TEST_REDIS_URL, else they skip
```

Tests run against real Postgres and Redis (no mocks for the data plane): atomic rate limiting under
concurrency, cache invalidation on revoke/plan change, quota sharing across keys, failover,
fail-open/closed behaviour with Redis down.

## Status

Verified end to end against the real upstream services (2026-09-19, `npm run probe`):

| Platform | Provider | Notes |
|---|---|---|
| TikTok | `tikwm` (JSON API) | HD/SD without watermark, audio, photo posts. Free API allows ~1 req/s, so it runs with concurrency 1 |
| X / Twitter | `twmate` (HTML) | Every rendition, best first, with width/height |
| Bluesky | official AT Protocol AppView | Documented public API, no scraping; video is an HLS playlist |
| Dailymotion | player metadata | HLS playlist |

`npm run probe` calls each provider with a real public URL and exits non-zero on failure. Run it after every
deploy and on a schedule. Parsers are unit-tested against **real captured responses** (`test/fixtures`), plus a few
clearly labelled synthetic ones for cases with no live sample (photo posts, image embeds).

Not available yet, and why (found while testing on real upstreams, not assumed):

- **YouTube**: the previous provider (`vidfly`) no longer answers, and every public Piped/Invidious instance is
  blocked or disabled. Reliable YouTube extraction needs a maintained extractor (yt-dlp) plus cookies or a
  residential proxy. Decision needed; the platform is declared but returns `unsupported_platform` until then.
- **TikTok via `tikdownloader.io`**: removed. It sits behind a Cloudflare managed challenge (`403 Just a moment…`)
  and cannot be called server-side. The gateway does not try to defeat anti-bot challenges.
- **Reddit**: `reddit.com/.json` answers 403 from this network; the third-party fallback needs a real post to validate.
- **Kuaishou**: the previous upstream (`kuaishouvideodownloader.net`) does not respond at all.
- **Tumblr**: the previous upstream endpoint (`tumbleclip.com/api/tumblr`) now returns 404.
- **Not yet verified against live content** (upstream is alive, but a working sample URL is needed to port it):
  Pinterest, LinkedIn, Snapchat, CapCut, Douyin, SoundCloud, Spotify, Terabox, Threads, Instagram/Facebook.
  The old scrapers are in git history (`git show 49efecd:services/<name>Service.js`).

Other gaps:

- No asynchronous job endpoint yet (`POST /v1/jobs` with webhook callback) for slow extractions
  (upstreams take 2 to 7 s here, so callers should use generous timeouts).
- Billing is deliberately out of scope: plans are entitlements only.
- The Docker image build has not been exercised in this environment (no Docker daemon); CI builds it.

## Legal note

Providers call third-party services whose terms may restrict automated use, and downloading content from some
platforms may conflict with their terms or with copyright. Keep the provider layer swappable and review the licensing
of any code you port from the upstream project before commercial use.
