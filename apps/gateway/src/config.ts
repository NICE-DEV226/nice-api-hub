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

  PROBES_ENABLED: Type.Boolean({ default: false }),
  PROBE_INTERVAL_SECONDS: Type.Integer({ default: 300, minimum: 10 }),
  /** JSON object mapping a platform id to a known-good public URL used by synthetic probes. */
  PROBE_URLS: Type.String({ default: '{}' }),
});

export type Config = Static<typeof ConfigSchema> & { probeUrls: Record<string, string> };

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

  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }

  return { ...(value as Static<typeof ConfigSchema>), probeUrls };
}
