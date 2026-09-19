import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Redis } from 'ioredis';
import type { Config } from '../config.js';
import { AccountsService } from '../control/accounts.js';
import { AppError, errors, toProblem } from '../errors.js';
import { KeyResolver, type Principal } from '../gateway/keyResolver.js';
import { extractApiKey, safeEqual } from '../gateway/keys.js';
import { RateLimiter, type RateLimitDecision } from '../gateway/rateLimiter.js';
import type { Db } from '../infra/db.js';
import { createMetrics, type Metrics } from '../metrics.js';
import { UsageMeter } from '../metering/usage.js';
import { platformStatus, ProbeStore } from '../probes.js';
import { MediaCache } from '../providers/cache.js';
import { blueskyProvider } from '../providers/impl/bluesky.js';
import { dailymotionProvider } from '../providers/impl/dailymotion.js';
import { tikwmProvider } from '../providers/impl/tikwm.js';
import { twmateProvider } from '../providers/impl/twmate.js';
import { createYtDlpProvider, type YtDlpOptions } from '../providers/impl/ytdlp.js';
import { MediaService } from '../providers/mediaService.js';
import { PLATFORMS, resolveTarget } from '../providers/platforms.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { Provider } from '../providers/types.js';
import { planDownload } from '../download/plan.js';
import { contentDisposition, openDownload, safeFilename, SlotLimiter } from '../download/stream.js';
import { assertPublicHttpUrl } from '../download/urlGuard.js';
import { JobStore, type Job } from '../jobs/jobStore.js';
import { JobRunner, toPublicJob } from '../jobs/runner.js';
import { adminRoutes } from './adminRoutes.js';
import { MediaSchema, ProblemSchema, VariantSchema } from './schemas.js';
import './types.js';

/**
 * Providers, all verified against the live upstream (see `npm run probe`).
 *
 *  - Dedicated providers (fast JSON APIs) come first where they exist.
 *  - yt-dlp is the engine for everything else, and the fallback for the rest:
 *    when a dedicated provider breaks, requests fail over to yt-dlp automatically.
 */
export function buildDefaultProviders(ytdlp: YtDlpOptions | null): Provider[] {
  const providers: Provider[] = [tikwmProvider, twmateProvider, blueskyProvider, dailymotionProvider];
  if (ytdlp) {
    for (const platform of ['youtube', 'instagram', 'facebook', 'soundcloud', 'linkedin', 'pinterest']) {
      providers.push(createYtDlpProvider(platform, 10, ytdlp));
    }
    for (const platform of ['tiktok', 'twitter', 'bluesky', 'dailymotion']) {
      providers.push(createYtDlpProvider(platform, 20, ytdlp));
    }
  }
  return providers;
}

export function ytDlpOptionsFrom(config: Config): YtDlpOptions {
  return {
    bin: config.YTDLP_PATH,
    jsRuntime: config.YTDLP_JS_RUNTIME,
    ...(config.YTDLP_COOKIES_FILE ? { cookiesFile: config.YTDLP_COOKIES_FILE } : {}),
    ...(config.YTDLP_PROXY ? { proxy: config.YTDLP_PROXY } : {}),
  };
}

export interface AppDeps {
  config: Config;
  db: Db;
  redis: Redis;
  /** Override for tests / custom deployments. */
  providers?: readonly Provider[];
  /** yt-dlp options when the binary is available (detected at boot); null/absent disables it. */
  ytdlp?: YtDlpOptions | null;
}

export interface BuiltApp {
  app: FastifyInstance;
  usage: UsageMeter;
  registry: ProviderRegistry;
  mediaService: MediaService;
  jobs: JobRunner | null;
  probeStore: ProbeStore;
  metrics: Metrics;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

// ajv-formats is CJS with a callable default export; NodeNext types it as a namespace.
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

/**
 * Query strings are always text, so they need type coercion ("5" → 5). JSON bodies must
 * NOT get it: Ajv would silently turn `null` into `0` for an integer|null union, which
 * would e.g. turn an "unlimited" plan quota into "zero requests allowed".
 */
function makeAjv(coerce: boolean): Ajv {
  const ajv = new Ajv({
    coerceTypes: coerce ? 'array' : false,
    useDefaults: true,
    removeAdditional: false,
    strict: false,
  });
  addFormats(ajv);
  return ajv;
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { config, db, redis } = deps;
  const metrics = createMetrics();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers["x-api-key"]'],
        censor: '[redacted]',
      },
    },
    trustProxy: config.TRUST_PROXY,
    genReqId: (req) => {
      const supplied = req.headers['x-request-id'];
      return typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied : randomUUID();
    },
    bodyLimit: 100 * 1024,
    forceCloseConnections: 'idle',
  });

  const strictAjv = makeAjv(false);
  const coercingAjv = makeAjv(true);
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? strictAjv : coercingAjv).compile(schema),
  );

  const registry = new ProviderRegistry(deps.providers ?? buildDefaultProviders(deps.ytdlp ?? null), PLATFORMS);
  const cache = new MediaCache(redis, config.CACHE_TTL_SECONDS, config.NEGATIVE_CACHE_TTL_SECONDS);
  const mediaService = new MediaService({
    registry,
    cache,
    metrics,
    logger: app.log,
    options: {
      upstreamTimeoutMs: config.UPSTREAM_TIMEOUT_MS,
      maxConcurrency: config.PROVIDER_MAX_CONCURRENCY,
      maxQueue: config.PROVIDER_MAX_QUEUE,
    },
  });
  const keyResolver = new KeyResolver({ db, redis, pepper: config.KEY_PEPPER });
  const rateLimiter = new RateLimiter(redis);
  const accounts = new AccountsService(db, keyResolver, config.KEY_PEPPER);
  const usage = new UsageMeter(db, metrics, app.log, config.USAGE_FLUSH_INTERVAL_MS);
  const probeStore = new ProbeStore(redis);
  const downloadSlots = new SlotLimiter(config.DOWNLOAD_MAX_CONCURRENCY);
  const jobStore = config.JOBS_ENABLED ? new JobStore(redis, config.JOBS_TTL_SECONDS) : null;
  const jobRunner = jobStore
    ? new JobRunner({
        store: jobStore,
        mediaService,
        registry,
        db,
        logger: app.log,
        metrics,
        options: {
          concurrency: config.JOBS_CONCURRENCY,
          stallMs: 3 * 60_000,
          maxRuns: 3,
          webhookBackoffMs: config.webhookBackoffMs,
          allowPrivateHosts: config.DOWNLOAD_ALLOW_PRIVATE_HOSTS,
        },
      })
    : null;

  app.decorateRequest('principal', null);
  app.decorateRequest('usage', null);

  // ---- cross-cutting hooks -------------------------------------------------

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    metrics.httpRequests.inc({ route, method: req.method, status: String(reply.statusCode) });
    metrics.httpDuration.observe({ route, method: req.method }, reply.elapsedTime / 1000);
  });

  // ---- errors: everything is RFC 9457 problem+json -------------------------

  app.setErrorHandler((error, req, reply) => {
    let problem: AppError;
    if (error instanceof AppError) {
      problem = error;
    } else if ((error as { validation?: unknown }).validation) {
      const issues = ((error as { validation: Array<{ instancePath?: string; message?: string }> }).validation).map(
        (v) => ({ path: v.instancePath || '(root)', message: v.message ?? 'invalid' }),
      );
      problem = errors.invalidRequest('The request is invalid.', { issues });
    } else if (
      typeof (error as { statusCode?: number }).statusCode === 'number' &&
      (error as { statusCode: number }).statusCode < 500
    ) {
      const status = (error as { statusCode: number }).statusCode;
      problem = new AppError(status, status === 413 ? 'payload_too_large' : 'bad_request', (error as Error).message);
    } else {
      req.log.error({ err: error }, 'unhandled error');
      problem = new AppError(500, 'internal_error', 'An unexpected error occurred.');
    }

    for (const [name, value] of Object.entries(problem.options.headers ?? {})) reply.header(name, value);
    return reply
      .status(problem.status)
      .type('application/problem+json; charset=utf-8')
      .send(toProblem(problem, req.id));
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .type('application/problem+json; charset=utf-8')
      .send(toProblem(errors.notFound(`No route for ${req.method} ${req.url.split('?')[0]}.`), req.id)),
  );

  // ---- OpenAPI ---------------------------------------------------------------

  app.addSchema(VariantSchema);
  app.addSchema(MediaSchema);
  app.addSchema(ProblemSchema);

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: "NICE-API'HUB",
        version: '2.0.0',
        description:
          'Media extraction gateway. Authenticate with `Authorization: Bearer <key>` (or `X-API-Key`). ' +
          'Errors are RFC 9457 `application/problem+json`.',
      },
      tags: [
        { name: 'Media', description: 'Resolve media from a URL' },
        { name: 'Jobs', description: 'Asynchronous extraction with polling or signed webhooks' },
        { name: 'Account', description: 'Your usage and limits' },
        { name: 'Status', description: 'Platform availability' },
        { name: 'Management', description: 'Operator API (admin token)' },
      ],
      components: {
        securitySchemes: {
          apiKey: { type: 'http', scheme: 'bearer', description: 'Customer API key (nah_live_…)' },
          adminToken: { type: 'http', scheme: 'bearer', description: 'Operator token' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  // ---- operational endpoints ---------------------------------------------------

  app.get('/healthz', { schema: { hide: true } }, async () => ({ status: 'ok' }));

  app.get('/readyz', { schema: { hide: true } }, async (_req, reply) => {
    const withTimeout = <T>(p: Promise<T>) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500).unref())]);
    const [pg, rd] = await Promise.allSettled([withTimeout(db.query('SELECT 1')), withTimeout(redis.ping())]);
    const checks = { postgres: pg.status === 'fulfilled', redis: rd.status === 'fulfilled' };
    const ready = checks.postgres && checks.redis;
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable', checks });
  });

  if (config.METRICS_TOKEN || config.NODE_ENV !== 'production') {
    app.get('/metrics', { schema: { hide: true } }, async (req, reply) => {
      if (config.METRICS_TOKEN) {
        const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
        if (!m || !safeEqual(m[1]!, config.METRICS_TOKEN)) throw errors.unauthorized('Invalid metrics token.');
      }
      metrics.circuitState.reset();
      const rank = { closed: 0, half_open: 1, open: 2 } as const;
      for (const [provider, state] of Object.entries(mediaService.breakerStates())) {
        metrics.circuitState.set({ provider }, rank[state]);
      }
      return reply.type(metrics.registry.contentType).send(await metrics.registry.metrics());
    });
  }

  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  // ---- public: platform status -------------------------------------------------

  typed.get(
    '/v1/platforms',
    {
      schema: {
        tags: ['Status'],
        summary: 'Supported platforms and their current availability',
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.String(),
                name: Type.String(),
                status: Type.Union([
                  Type.Literal('operational'),
                  Type.Literal('degraded'),
                  Type.Literal('down'),
                  Type.Literal('unknown'),
                ]),
              }),
            ),
          }),
        },
      },
    },
    async () => {
      const breakers = mediaService.breakerStates();
      const data = await Promise.all(
        registry.availablePlatforms().map(async (platform) => {
          const providers = await Promise.all(
            registry.providersFor(platform.id).map(async (p) => ({
              circuit: breakers[p.id] ?? 'closed',
              probe: await probeStore.get(p.id),
            })),
          );
          return { id: platform.id, name: platform.displayName, status: platformStatus(providers) };
        }),
      );
      return { data };
    },
  );

  // ---- authenticated API -------------------------------------------------------

  await app.register(async (v1) => {
    const scoped = v1.withTypeProvider<TypeBoxTypeProvider>();

    v1.addHook('onRequest', async (req, reply) => {
      const principal = await keyResolver.authenticate(
        extractApiKey({
          authorization: req.headers.authorization,
          'x-api-key': req.headers['x-api-key'],
        }),
      );
      req.principal = principal;

      let decision: RateLimitDecision | null = null;
      try {
        decision = await rateLimiter.check(principal);
      } catch (error) {
        metrics.rateLimiterErrors.inc();
        req.log.error({ err: error }, 'rate limiter unavailable');
        if (config.RATE_LIMIT_FAIL_MODE === 'closed') throw errors.overloaded();
      }
      if (!decision) return;

      const headers: Record<string, string> = {
        'ratelimit-limit': String(decision.limit),
        'ratelimit-remaining': String(decision.remaining),
        'ratelimit-reset': String(decision.resetSeconds),
      };
      if (decision.dailyLimit !== null) {
        headers['x-quota-limit'] = String(decision.dailyLimit);
        headers['x-quota-remaining'] = String(decision.dailyRemaining ?? 0);
      }
      for (const [k, v] of Object.entries(headers)) reply.header(k, v);

      if (!decision.allowed) {
        metrics.rateLimited.inc({ reason: decision.reason ?? 'rate' });
        throw errors.rateLimited(decision.reason === 'daily_quota' ? 'daily_quota' : 'rate', decision.retryAfterSeconds, headers);
      }
    });

    v1.addHook('onResponse', async (req, reply) => {
      const principal: Principal | null = req.principal;
      if (!principal) return;
      const limited = reply.statusCode === 429;
      if (!req.usage && !limited) return;
      usage.record({
        accountId: principal.accountId,
        keyId: principal.keyId,
        platform: req.usage?.platform ?? 'unknown',
        error: reply.statusCode >= 500,
        cacheHit: req.usage?.cacheHit ?? false,
        rateLimited: limited,
      });
    });

    scoped.get(
      '/v1/media',
      {
        schema: {
          tags: ['Media'],
          summary: 'Resolve downloadable media from a URL',
          description:
            'The platform is detected from the URL. Results are cached briefly; `meta.cached` tells you when.',
          security: [{ apiKey: [] }],
          querystring: Type.Object({ url: Type.String({ minLength: 1, maxLength: 2048 }) }),
          response: {
            200: Type.Object({
              data: Type.Ref(MediaSchema),
              meta: Type.Object({
                requestId: Type.String(),
                cached: Type.Boolean(),
                tookMs: Type.Integer(),
              }),
            }),
            401: Type.Ref(ProblemSchema),
            403: Type.Ref(ProblemSchema),
            422: Type.Ref(ProblemSchema),
            429: Type.Ref(ProblemSchema),
            502: Type.Ref(ProblemSchema),
            503: Type.Ref(ProblemSchema),
          },
        },
      },
      async (req) => {
        const started = performance.now();
        const principal = req.principal!;
        const target = resolveTarget(req.query.url, registry.availablePlatforms());
        req.usage = { platform: target.platform.id, cacheHit: false };

        if (principal.platforms && !principal.platforms.includes(target.platform.id)) {
          throw errors.forbidden('platform_not_allowed', `Your plan/key does not include "${target.platform.id}".`);
        }

        const { media, cached } = await mediaService.resolve(target);
        req.usage.cacheHit = cached;
        return {
          data: media,
          meta: { requestId: req.id, cached, tookMs: Math.round(performance.now() - started) },
        };
      },
    );

    scoped.get(
      '/v1/download',
      {
        schema: {
          tags: ['Media'],
          summary: 'Stream the media as a single playable file',
          description:
            'The gateway fetches the media itself and streams it back: it merges separate video and audio tracks ' +
            '(YouTube no longer serves combined files), works around IP-bound links, and can extract audio as MP3. ' +
            'Range requests are not supported. Counts against your rate limit like any request.',
          security: [{ apiKey: [] }],
          querystring: Type.Object({
            url: Type.String({ minLength: 1, maxLength: 2048 }),
            kind: Type.Union([Type.Literal('video'), Type.Literal('audio')], { default: 'video' }),
            maxHeight: Type.Optional(Type.Integer({ minimum: 1, maximum: 8640, description: 'Highest video height, e.g. 720' })),
            audioFormat: Type.Optional(Type.Union([Type.Literal('original'), Type.Literal('mp3')], { description: 'For kind=audio' })),
          }),
          response: {
            200: { description: 'The media file (video/mp4, video/webm, audio/mpeg…)', type: 'string', format: 'binary' },
            422: Type.Ref(ProblemSchema),
            502: Type.Ref(ProblemSchema),
            503: Type.Ref(ProblemSchema),
          },
        },
      },
      async (req, reply) => {
        if (!config.DOWNLOAD_ENABLED) throw errors.notFound('Downloads are disabled on this deployment.');
        const principal = req.principal!;
        const target = resolveTarget(req.query.url, registry.availablePlatforms());
        req.usage = { platform: target.platform.id, cacheHit: false };
        if (principal.platforms && !principal.platforms.includes(target.platform.id)) {
          throw errors.forbidden('platform_not_allowed', `Your plan/key does not include "${target.platform.id}".`);
        }

        const release = downloadSlots.tryAcquire();
        if (!release) throw errors.overloaded(5);
        try {
          const { media, cached } = await mediaService.resolve(target);
          req.usage.cacheHit = cached;
          const plan = planDownload(media.variants, {
            kind: req.query.kind,
            maxHeight: req.query.maxHeight,
            audioFormat: req.query.audioFormat,
          });
          const opened = await openDownload(plan, {
            ffmpegPath: config.FFMPEG_PATH,
            maxBytes: config.DOWNLOAD_MAX_BYTES,
            maxSeconds: config.DOWNLOAD_MAX_SECONDS,
            allowPrivateHosts: config.DOWNLOAD_ALLOW_PRIVATE_HOSTS,
          });

          req.raw.on('close', opened.dispose);
          opened.stream.on('close', release);
          opened.stream.on('error', (error) => req.log.warn({ err: error }, 'download stream failed'));
          reply
            .header('content-type', opened.contentType)
            .header('content-disposition', contentDisposition(safeFilename(media.title, plan.extension)))
            .header('x-download-provider', media.provider);
          if (opened.contentLength !== undefined) reply.header('content-length', String(opened.contentLength));
          return reply.send(opened.stream);
        } catch (error) {
          release();
          throw error;
        }
      },
    );

    const JobSchema = Type.Object({
      id: Type.String(),
      status: Type.Union([Type.Literal('queued'), Type.Literal('running'), Type.Literal('succeeded'), Type.Literal('failed')]),
      url: Type.String(),
      platform: Type.String(),
      createdAt: Type.String(),
      startedAt: Type.Optional(Type.String()),
      finishedAt: Type.Optional(Type.String()),
      result: Type.Optional(Type.Ref(MediaSchema)),
      error: Type.Optional(Type.Object({ status: Type.Integer(), code: Type.String(), detail: Type.String() })),
      webhook: Type.Optional(
        Type.Object({
          url: Type.String(),
          status: Type.Union([Type.Literal('pending'), Type.Literal('delivered'), Type.Literal('failed')]),
          attempts: Type.Integer(),
          nextAttemptAt: Type.Optional(Type.String()),
          lastError: Type.Optional(Type.String()),
        }),
      ),
    });

    scoped.post(
      '/v1/jobs',
      {
        schema: {
          tags: ['Jobs'],
          summary: 'Queue an extraction and get the result later',
          description:
            'Extraction can take 10+ seconds. Submit it here, then poll `GET /v1/jobs/{id}` or pass a `webhookUrl`: ' +
            'the result is POSTed there, signed with your account webhook secret (`X-NAH-Signature: t=…,v1=…`, HMAC-SHA256 of ' +
            '`<t>.<raw body>`), retried with backoff. Send an `Idempotency-Key` header to make retries of this call safe.',
          security: [{ apiKey: [] }],
          body: Type.Object({
            url: Type.String({ minLength: 1, maxLength: 2048 }),
            webhookUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048, description: 'Public http(s) URL' })),
          }),
          headers: Type.Object({ 'idempotency-key': Type.Optional(Type.String({ pattern: '^[A-Za-z0-9._-]{1,128}$' })) }),
          response: { 202: Type.Object({ data: JobSchema }), 422: Type.Ref(ProblemSchema), 429: Type.Ref(ProblemSchema), 503: Type.Ref(ProblemSchema) },
        },
      },
      async (req, reply) => {
        if (!jobStore) throw errors.notFound('Jobs are disabled on this deployment.');
        const principal = req.principal!;
        const target = resolveTarget(req.body.url, registry.availablePlatforms());
        if (principal.platforms && !principal.platforms.includes(target.platform.id)) {
          throw errors.forbidden('platform_not_allowed', `Your plan/key does not include "${target.platform.id}".`);
        }
        const webhookUrl = req.body.webhookUrl
          ? (await assertPublicHttpUrl(req.body.webhookUrl, config.DOWNLOAD_ALLOW_PRIVATE_HOSTS)).toString()
          : undefined;

        try {
          const id = jobStore.newId();
          const idempotencyKey = req.headers['idempotency-key'];
          if (idempotencyKey) {
            const existingId = await jobStore.claimIdempotencyKey(principal.accountId, idempotencyKey, id);
            const existing = existingId ? await jobStore.get(existingId) : null;
            if (existing) {
              return reply.header('idempotent-replayed', 'true').header('location', `/v1/jobs/${existing.id}`).code(202).send({ data: toPublicJob(existing) });
            }
          }
          if (!(await jobStore.reserve(principal.accountId, config.JOBS_MAX_PENDING_PER_ACCOUNT))) {
            throw errors.tooManyJobs(config.JOBS_MAX_PENDING_PER_ACCOUNT);
          }
          const job: Job = {
            id,
            accountId: principal.accountId,
            keyId: principal.keyId,
            url: target.url.toString(),
            platform: target.platform.id,
            status: 'queued',
            createdAt: new Date().toISOString(),
            runs: 0,
            ...(webhookUrl ? { webhook: { url: webhookUrl, status: 'pending' as const, attempts: 0 } } : {}),
          };
          try {
            await jobStore.save(job);
            await jobStore.enqueue(id);
          } catch (error) {
            await jobStore.release(principal.accountId).catch(() => {});
            throw error;
          }
          req.usage = { platform: target.platform.id, cacheHit: false };
          return reply.header('location', `/v1/jobs/${id}`).code(202).send({ data: toPublicJob(job) });
        } catch (error) {
          if (error instanceof AppError) throw error;
          req.log.error({ err: error }, 'could not queue the job');
          throw errors.overloaded();
        }
      },
    );

    scoped.get(
      '/v1/jobs/:id',
      {
        schema: {
          tags: ['Jobs'],
          summary: 'Get a job and its result',
          security: [{ apiKey: [] }],
          params: Type.Object({ id: Type.String({ pattern: '^job_[a-f0-9]{32}$' }) }),
          response: { 200: Type.Object({ data: JobSchema }), 404: Type.Ref(ProblemSchema) },
        },
      },
      async (req) => {
        if (!jobStore) throw errors.notFound('Jobs are disabled on this deployment.');
        const job = await jobStore.get(req.params.id).catch(() => {
          throw errors.overloaded();
        });
        // Someone else's job is indistinguishable from a missing one.
        if (!job || job.accountId !== req.principal!.accountId) throw errors.notFound('Job not found (or expired).');
        return { data: toPublicJob(job) };
      },
    );

    scoped.get(
      '/v1/account',
      { schema: { tags: ['Account'], summary: 'Your plan, limits and webhook secret', security: [{ apiKey: [] }] } },
      async (req) => {
        const principal = req.principal!;
        const account = await accounts.getAccount(principal.accountId);
        return {
          data: {
            id: account.id,
            name: account.name,
            plan: principal.planId,
            limits: principal.limits,
            platforms: principal.platforms,
            webhookSecret: account.webhookSecret,
          },
        };
      },
    );

    scoped.get(
      '/v1/usage',
      {
        schema: {
          tags: ['Account'],
          summary: 'Your plan limits and recent usage',
          security: [{ apiKey: [] }],
          querystring: Type.Object({ days: Type.Integer({ minimum: 1, maximum: 90, default: 7 }) }),
        },
      },
      async (req) => {
        const principal = req.principal!;
        return {
          data: {
            plan: principal.planId,
            limits: principal.limits,
            platforms: principal.platforms,
            usage: await accounts.usage(principal.accountId, req.query.days),
          },
        };
      },
    );
  });

  await app.register(adminRoutes, { prefix: '/admin/v1', adminToken: config.ADMIN_TOKEN, accounts });

  usage.start();
  jobRunner?.start();
  app.addHook('onClose', async () => {
    await jobRunner?.stop();
  });
  return { app, usage, registry, mediaService, jobs: jobRunner, probeStore, metrics };
}
