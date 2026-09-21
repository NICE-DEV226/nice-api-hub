import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { AccountsService } from '../control/accounts.js';
import { AppError, errors } from '../errors.js';
import { safeEqual } from '../gateway/keys.js';
import { parseGrace } from './deviceRoutes.js';
import { Uuid } from './schemas.js';

const Platforms = Type.Union([Type.Array(Type.String({ minLength: 1 })), Type.Null()]);
const security = [{ adminToken: [] }];

/** Failed admin auth attempts per IP: cheap in-memory brute-force brake. */
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;

export async function adminRoutes(
  app: FastifyInstance,
  opts: { adminToken: string; accounts: AccountsService },
): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { accounts } = opts;

  app.addHook('onRequest', async (req) => {
    const now = Date.now();
    const f = failures.get(req.ip);
    if (f && f.resetAt > now && f.count >= MAX_FAILURES) {
      throw new AppError(429, 'too_many_attempts', 'Too many failed attempts.', {
        headers: { 'retry-after': String(Math.ceil((f.resetAt - now) / 1000)) },
      });
    }
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match || !safeEqual(match[1]!, opts.adminToken)) {
      const cur = f && f.resetAt > now ? f : { count: 0, resetAt: now + WINDOW_MS };
      cur.count++;
      failures.set(req.ip, cur);
      throw errors.unauthorized('Invalid admin token.');
    }
  });

  r.get('/plans', { schema: { tags: ['Management'], security } }, async () => ({ data: await accounts.listPlans() }));

  r.put(
    '/plans/:id',
    {
      schema: {
        tags: ['Management'],
        security,
        params: Type.Object({ id: Type.String({ pattern: '^[a-z0-9_-]{2,32}$' }) }),
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          rps: Type.Number({ exclusiveMinimum: 0, maximum: 10_000 }),
          burst: Type.Integer({ minimum: 1, maximum: 100_000 }),
          dailyQuota: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
          maxKeys: Type.Integer({ minimum: 1, maximum: 1000 }),
          platforms: Platforms,
        }),
      },
    },
    async (req) => ({ data: await accounts.upsertPlan({ id: req.params.id, ...req.body }) }),
  );

  r.post(
    '/accounts',
    {
      schema: {
        tags: ['Management'],
        security,
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 120 }),
          contactEmail: Type.Optional(Type.Union([Type.String({ format: 'email' }), Type.Null()])),
          planId: Type.String({ minLength: 1 }),
        }),
      },
    },
    async (req, reply) => {
      const data = await accounts.createAccount(req.body);
      return reply.code(201).send({ data });
    },
  );

  r.get(
    '/accounts',
    {
      schema: {
        tags: ['Management'],
        security,
        querystring: Type.Object({
          limit: Type.Integer({ minimum: 1, maximum: 100, default: 25 }),
          offset: Type.Integer({ minimum: 0, default: 0 }),
        }),
      },
    },
    async (req) => {
      const { items, total } = await accounts.listAccounts(req.query.limit, req.query.offset);
      return { data: items, meta: { total, limit: req.query.limit, offset: req.query.offset } };
    },
  );

  r.get(
    '/accounts/:id',
    { schema: { tags: ['Management'], security, params: Type.Object({ id: Uuid }) } },
    async (req) => ({ data: await accounts.getAccount(req.params.id) }),
  );

  r.patch(
    '/accounts/:id',
    {
      schema: {
        tags: ['Management'],
        security,
        params: Type.Object({ id: Uuid }),
        body: Type.Object(
          {
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
            planId: Type.Optional(Type.String({ minLength: 1 })),
            status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('suspended')])),
          },
          { minProperties: 1 },
        ),
      },
    },
    async (req) => ({ data: await accounts.updateAccount(req.params.id, req.body) }),
  );

  r.post(
    '/accounts/:id/webhook-secret/rotate',
    { schema: { tags: ['Management'], security, params: Type.Object({ id: Uuid }) } },
    async (req) => ({ data: await accounts.rotateWebhookSecret(req.params.id) }),
  );

  r.get(
    '/accounts/:id/keys',
    { schema: { tags: ['Management'], security, params: Type.Object({ id: Uuid }) } },
    async (req) => ({ data: await accounts.listKeys(req.params.id) }),
  );

  r.post(
    '/accounts/:id/keys',
    {
      schema: {
        tags: ['Management'],
        security,
        params: Type.Object({ id: Uuid }),
        body: Type.Object({
          label: Type.String({ minLength: 1, maxLength: 80 }),
          environment: Type.Optional(Type.Union([Type.Literal('live'), Type.Literal('test')])),
          platforms: Type.Optional(Platforms),
          scopes: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
          expiresAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
        }),
      },
    },
    async (req, reply) => {
      const { key, meta } = await accounts.createKey(req.params.id, req.body);
      return reply.code(201).send({
        data: { ...meta, key },
        meta: { warning: 'Store this key now. It is not retrievable afterwards.' },
      });
    },
  );

  r.post(
    '/keys/:id/revoke',
    { schema: { tags: ['Management'], security, params: Type.Object({ id: Uuid }) } },
    async (req) => ({ data: await accounts.revokeKey(req.params.id) }),
  );

  r.post(
    '/keys/:id/rotate',
    {
      schema: {
        tags: ['Management'],
        security,
        params: Type.Object({ id: Uuid }),
        description: 'Optional JSON body: `{ "graceSeconds": 86400 }` (0 to 30 days).',
      },
    },
    async (req) => {
      const { key, meta, previous } = await accounts.rotateKey(req.params.id, parseGrace(req.body, 86_400));
      return { data: { ...meta, key }, meta: { previous, warning: 'Store this key now. It is not retrievable afterwards.' } };
    },
  );

  r.get(
    '/accounts/:id/usage',
    {
      schema: {
        tags: ['Management'],
        security,
        params: Type.Object({ id: Uuid }),
        querystring: Type.Object({ days: Type.Integer({ minimum: 1, maximum: 365, default: 30 }) }),
      },
    },
    async (req) => ({ data: await accounts.usage(req.params.id, req.query.days) }),
  );
}
