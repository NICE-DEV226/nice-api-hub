import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Integer({ default: 3000, minimum: 0, maximum: 65535 }),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  TRUST_PROXY: Type.Boolean({ default: false }),

  DATABASE_URL: Type.String({ minLength: 1 }),
  REDIS_URL: Type.String({ minLength: 1 }),

  /** HMAC secret used to hash API keys at rest. Rotating it invalidates every key. */
  KEY_PEPPER: Type.String({ minLength: 32 }),
  /** Bearer token for the management API (/admin/v1). */
  ADMIN_TOKEN: Type.String({ minLength: 32 }),
  /** If set, /metrics requires `Authorization: Bearer <token>`. Mandatory in production to expose metrics. */
  METRICS_TOKEN: Type.String({ default: '' }),

  CACHE_TTL_SECONDS: Type.Integer({ default: 600, minimum: 0 }),
  NEGATIVE_CACHE_TTL_SECONDS: Type.Integer({ default: 120, minimum: 0 }),
  UPSTREAM_TIMEOUT_MS: Type.Integer({ default: 15_000, minimum: 500 }),
  PROVIDER_MAX_CONCURRENCY: Type.Integer({ default: 20, minimum: 1 }),
  PROVIDER_MAX_QUEUE: Type.Integer({ default: 50, minimum: 0 }),

  /** What to do when Redis is unreachable during rate limiting. */
  RATE_LIMIT_FAIL_MODE: Type.Union([Type.Literal('open'), Type.Literal('closed')], {
    default: 'open',
  }),
  USAGE_FLUSH_INTERVAL_MS: Type.Integer({ default: 5000, minimum: 100 }),

  /** yt-dlp extraction engine (YouTube and a long tail of platforms). Disabled automatically if the binary is missing. */
  YTDLP_ENABLED: Type.Boolean({ default: true }),
  YTDLP_PATH: Type.String({ default: 'yt-dlp' }),
  YTDLP_JS_RUNTIME: Type.String({ default: 'node' }),
  /** Netscape cookies file: helps with age-gated / login-walled content and bot checks. */
  YTDLP_COOKIES_FILE: Type.String({ default: '' }),
  /** Outbound proxy for extraction, e.g. a residential proxy when datacenter IPs are blocked. */
  YTDLP_PROXY: Type.String({ default: '' }),

  /** GET /v1/download: the gateway fetches, merges (ffmpeg) and streams the media itself. */
  DOWNLOAD_ENABLED: Type.Boolean({ default: true }),
  FFMPEG_PATH: Type.String({ default: 'ffmpeg' }),
  DOWNLOAD_MAX_CONCURRENCY: Type.Integer({ default: 4, minimum: 1 }),
  DOWNLOAD_MAX_SECONDS: Type.Integer({ default: 900, minimum: 10 }),
  DOWNLOAD_MAX_BYTES: Type.Integer({ default: 1_073_741_824, minimum: 1_048_576 }),
  /** Tests only. Never enable in production: it disables the SSRF guard. */
  DOWNLOAD_ALLOW_PRIVATE_HOSTS: Type.Boolean({ default: false }),

  /** POST /v1/jobs: queue an extraction and get the result by polling or by signed webhook. */
  JOBS_ENABLED: Type.Boolean({ default: true }),
  JOBS_CONCURRENCY: Type.Integer({ default: 4, minimum: 1 }),
  JOBS_MAX_PENDING_PER_ACCOUNT: Type.Integer({ default: 20, minimum: 1 }),
  /** How long a job (and its result) is kept. */
  JOBS_TTL_SECONDS: Type.Integer({ default: 86_400, minimum: 60 }),
  /** Comma-separated delay (ms) before each webhook attempt; the count is the max number of attempts. */
  JOBS_WEBHOOK_BACKOFF_MS: Type.String({ default: '0,30000,120000,600000,3600000' }),

  PROBES_ENABLED: Type.Boolean({ default: false }),
  PROBE_INTERVAL_SECONDS: Type.Integer({ default: 300, minimum: 10 }),
  /** JSON object mapping a platform id to a known-good public URL used by synthetic probes. */
  PROBE_URLS: Type.String({ default: '{}' }),
});

export type Config = Static<typeof ConfigSchema> & { probeUrls: Record<string, string>; webhookBackoffMs: number[] };

export class ConfigError extends Error {}

/** Validate and normalise environment variables. Reports every problem at once. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat empty strings as "unset" so `FOO=` in a compose file falls back to the default.
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') input[key] = value;
  }

  const value = Value.Default(ConfigSchema, Value.Convert(ConfigSchema, input));
  const problems = [...Value.Errors(ConfigSchema, value)].map(
    (e) => `${e.path.replace(/^\//, '') || '(root)'}: ${e.message}`,
  );

  let probeUrls: Record<string, string> = {};
  const raw = (value as Static<typeof ConfigSchema>).PROBE_URLS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      probeUrls = parsed as Record<string, string>;
    } else {
      problems.push('PROBE_URLS: must be a JSON object');
    }
  } catch {
    problems.push('PROBE_URLS: must be valid JSON');
  }

  const backoff = (value as Static<typeof ConfigSchema>).JOBS_WEBHOOK_BACKOFF_MS.split(',').map((x) => Number(x.trim()));
  if (backoff.length === 0 || backoff.some((n) => !Number.isFinite(n) || n < 0)) {
    problems.push('JOBS_WEBHOOK_BACKOFF_MS: must be a comma-separated list of non-negative numbers');
  }

  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }

  return { ...(value as Static<typeof ConfigSchema>), probeUrls, webhookBackoffMs: backoff };
}
