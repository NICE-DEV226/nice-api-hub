import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Redis } from 'ioredis';
import type { Config } from '../config.js';
import type { AccountsService } from '../control/accounts.js';
import { AppError, errors } from '../errors.js';
import { safeEqual } from '../gateway/keys.js';
import { generateLinkCode, hashDevice, issueChallenge, linkCodeKey, normalizeLinkCode, verifyPow } from '../gateway/registration.js';
import { CUSTOMER_SCOPES, isScope } from '../gateway/scopes.js';
import { ProblemSchema, Uuid } from './schemas.js';

export interface DeviceDeps {
  config: Config;
  redis: Redis;
  accounts: AccountsService;
}

const DeviceName = Type.String({ minLength: 1, maxLength: 64 });
const DeviceHash = Type.String({ pattern: '^[a-fA-F0-9]{64}$', description: 'sha256 of the machine id, computed on the client' });
const LINK_TTL_SECONDS = 600;

/**
 * Counter with expiry. Fails CLOSED: with Redis down we refuse rather than let an abuser through.
 */
async function throttle(redis: Redis, key: string, max: number, ttlSeconds: number, limited: (retryAfter: number) => AppError, log: { error: (o: object, m: string) => void }): Promise<void> {
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, ttlSeconds);
    if (n > max) throw limited(await redis.ttl(key));
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error({ err: error }, 'throttle backend unavailable');
    throw errors.signupUnavailable();
  }
}

/** Optional `{graceSeconds}` body: missing means the default, anything else must be a sane integer. */
export function parseGrace(body: unknown, fallback: number): number {
  const raw = (body ?? {}) as { graceSeconds?: unknown };
  if (raw.graceSeconds === undefined) return fallback;
  const n = raw.graceSeconds;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 30 * 86_400) {
    throw errors.invalidRequest('`graceSeconds` must be an integer between 0 and 2592000.');
  }
  return n;
}

const AccountBrief = Type.Object({ id: Type.String(), name: Type.String(), plan: Type.String() });

/** Public, unauthenticated: registering a device and redeeming a link code. */
export function registerPublicRoutes(app: FastifyInstance, { config, redis, accounts }: DeviceDeps): void {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();

  r.get(
    '/v1/register',
    {
      schema: {
        tags: ['Signup'],
        summary: 'Can I create an account here, and what must my computer solve first?',
        response: {
          200: Type.Object({
            data: Type.Object({
              mode: Type.Union([Type.Literal('closed'), Type.Literal('open'), Type.Literal('invite')]),
              requiresInvite: Type.Boolean(),
              oneAccountPerDevice: Type.Boolean(),
              plan: Type.Union([
                Type.Object({
                  id: Type.String(),
                  name: Type.String(),
                  limits: Type.Object({ rps: Type.Number(), burst: Type.Integer(), dailyQuota: Type.Union([Type.Integer(), Type.Null()]), maxKeys: Type.Integer() }),
                }),
                Type.Null(),
              ]),
              challenge: Type.Union([Type.Object({ token: Type.String(), bits: Type.Integer(), expiresAt: Type.String() }), Type.Null()]),
            }),
          }),
        },
      },
    },
    async () => {
      const closed = config.SIGNUP_MODE === 'closed';
      const plan = closed ? undefined : (await accounts.listPlans()).find((p) => p.id === config.SIGNUP_PLAN);
      return {
        data: {
          mode: config.SIGNUP_MODE,
          requiresInvite: config.SIGNUP_MODE === 'invite',
          oneAccountPerDevice: config.REGISTER_ONE_PER_DEVICE,
          plan: plan ? { id: plan.id, name: plan.name, limits: { rps: plan.rps, burst: plan.burst, dailyQuota: plan.dailyQuota, maxKeys: plan.maxKeys } } : null,
          challenge: closed ? null : issueChallenge(config.KEY_PEPPER, config.REGISTER_POW_BITS),
        },
      };
    },
  );

  r.post(
    '/v1/register',
    {
      schema: {
        tags: ['Signup'],
        summary: 'Create an account for this computer (no e-mail)',
        description:
          'Solve the challenge from `GET /v1/register` (sha256(`<token>:<nonce>`) with `bits` leading zero bits), then post it here with ' +
          'a hash of your machine id. Returns your personal device key and an offline recovery key. BOTH ARE SHOWN ONCE.',
        body: Type.Object({
          deviceName: DeviceName,
          deviceHash: DeviceHash,
          challenge: Type.String({ maxLength: 512 }),
          nonce: Type.String({ minLength: 1, maxLength: 40 }),
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
          inviteCode: Type.Optional(Type.String({ maxLength: 128 })),
        }),
        response: {
          201: Type.Object({
            data: Type.Object({ account: AccountBrief, key: Type.String(), keyId: Type.String(), recoveryKey: Type.String() }),
            meta: Type.Object({ warning: Type.String() }),
          }),
          400: Type.Ref(ProblemSchema),
          403: Type.Ref(ProblemSchema),
          409: Type.Ref(ProblemSchema),
          429: Type.Ref(ProblemSchema),
        },
      },
    },
    async (req, reply) => {
      if (config.SIGNUP_MODE === 'closed') throw errors.signupsClosed();
      // Every attempt counts, wrong invite codes and failed puzzles included.
      await throttle(redis, `register:ip:${req.ip}`, config.SIGNUP_PER_IP_PER_HOUR, 3600, errors.tooManySignups, req.log);

      if (config.SIGNUP_MODE === 'invite') {
        const given = req.body.inviteCode ?? '';
        let ok = false;
        for (const code of config.signupInviteCodes) ok = safeEqual(given, code) || ok; // no early exit
        if (!ok) throw errors.forbidden('invalid_invite', 'A valid invite code is required.');
      }

      const pow = verifyPow(config.KEY_PEPPER, req.body.challenge, req.body.nonce);
      if (!pow.ok) throw errors.invalidPow(pow.reason);
      try {
        // A solved challenge works exactly once.
        if ((await redis.set(`pow:used:${pow.id}`, '1', 'EX', 900, 'NX')) !== 'OK') throw errors.invalidPow('already used');
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw errors.signupUnavailable();
      }

      const deviceName = req.body.deviceName.trim();
      const { account, key, keyMeta, recoveryKey } = await accounts.registerDevice({
        name: req.body.name?.trim() || deviceName,
        planId: config.SIGNUP_PLAN,
        deviceName,
        deviceHash: config.REGISTER_ONE_PER_DEVICE ? hashDevice(config.KEY_PEPPER, req.body.deviceHash) : null,
      });
      return reply.code(201).send({
        data: { account: { id: account.id, name: account.name, plan: account.planId }, key, keyId: keyMeta.id, recoveryKey },
        meta: { warning: 'Store the recovery key somewhere safe: it is the only way back in if you lose this computer. Neither key can be shown again.' },
      });
    },
  );

  r.post(
    '/v1/link/redeem',
    {
      schema: {
        tags: ['Signup'],
        summary: 'Add this computer to an existing account with a link code',
        body: Type.Object({ code: Type.String({ maxLength: 32 }), deviceName: DeviceName, deviceHash: DeviceHash }),
        response: {
          201: Type.Object({ data: Type.Object({ account: AccountBrief, key: Type.String(), keyId: Type.String() }), meta: Type.Object({ warning: Type.String() }) }),
          400: Type.Ref(ProblemSchema),
          409: Type.Ref(ProblemSchema),
          429: Type.Ref(ProblemSchema),
        },
      },
    },
    async (req, reply) => {
      // 8 symbols is ~40 bits: safe only because codes live 10 minutes, work once, and guesses are rate limited.
      await throttle(redis, `link:ip:${req.ip}`, 10, 3600, errors.tooManyAttempts, req.log);
      const code = normalizeLinkCode(req.body.code);
      if (!code) throw errors.invalidLinkCode();

      const redisKey = linkCodeKey(code);
      let raw: string | null;
      try {
        raw = await redis.get(redisKey);
      } catch {
        throw errors.signupUnavailable();
      }
      if (!raw) throw errors.invalidLinkCode();
      const { accountId } = JSON.parse(raw) as { accountId: string };

      await accounts.assertRoomForDevice(accountId); // a full account must not burn the code
      const claimed = await redis.getdel(redisKey); // atomic: exactly one redeemer wins
      if (!claimed) throw errors.invalidLinkCode();

      try {
        const { key, meta } = await accounts.addDeviceKey(accountId, {
          deviceName: req.body.deviceName.trim(),
          deviceHash: hashDevice(config.KEY_PEPPER, req.body.deviceHash),
          via: 'link',
        });
        return reply.code(201).send({
          data: { account: await accounts.getAccountPublic(accountId), key, keyId: meta.id },
          meta: { warning: 'This key belongs to this computer only. It cannot be shown again.' },
        });
      } catch (error) {
        await redis.set(redisKey, claimed, 'EX', 60).catch(() => {}); // give the code back if we could not use it
        throw error;
      }
    },
  );
}

/** Authenticated (inside the `/v1` scope): a person managing their own keys, links and recovery. */
export function registerKeyRoutes(scoped: FastifyInstance, { config, redis, accounts }: DeviceDeps): void {
  const r = scoped.withTypeProvider<TypeBoxTypeProvider>();
  const security = [{ apiKey: [] }];
  const KeyView = Type.Object(
    {
      id: Type.String(),
      label: Type.String(),
      prefix: Type.String(),
      environment: Type.String(),
      scopes: Type.Array(Type.String()),
      platforms: Type.Union([Type.Array(Type.String()), Type.Null()]),
      createdVia: Type.String(),
      createdAt: Type.String(),
      expiresAt: Type.Union([Type.String(), Type.Null()]),
      revokedAt: Type.Union([Type.String(), Type.Null()]),
      lastUsedAt: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: true },
  );

  r.get(
    '/v1/keys',
    { schema: { tags: ['Keys'], summary: 'Your keys (devices)', security, response: { 200: Type.Object({ data: Type.Array(Type.Composite([KeyView, Type.Object({ current: Type.Boolean() })])) }) } } },
    async (req) => {
      const keys = await accounts.listOwnKeys(req.principal!.accountId);
      return { data: keys.map((k) => ({ ...k, current: k.id === req.principal!.keyId })) };
    },
  );

  r.post(
    '/v1/keys',
    {
      schema: {
        tags: ['Keys'],
        summary: 'Create another key (for an app, a script or a recovery code)',
        description: 'The key is shown once. Scopes: `media` (default), `keys` (manage keys), `recover` (offline recovery only).',
        security,
        body: Type.Object({
          label: Type.String({ minLength: 1, maxLength: 80 }),
          scopes: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: CUSTOMER_SCOPES.length })),
          platforms: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
          expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
        }),
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const scopes = req.body.scopes ?? ['media'];
      if (scopes.some((s) => !isScope(s))) throw errors.invalidRequest(`Unknown scope. Allowed: ${CUSTOMER_SCOPES.join(', ')}.`);

      // A key restricted to some platforms can only mint keys restricted the same way or tighter.
      let platforms = req.body.platforms ?? null;
      if (principal.platforms) {
        platforms ??= principal.platforms;
        if (platforms.some((p) => !principal.platforms!.includes(p))) {
          throw errors.forbidden('insufficient_scope', 'A key limited to some platforms cannot create a key for others.');
        }
      }
      const { key, meta } = await accounts.createKey(principal.accountId, {
        label: req.body.label.trim(),
        scopes,
        platforms,
        expiresAt: req.body.expiresAt ?? null,
        createdVia: 'self',
      });
      return reply.code(201).send({ data: { ...meta, key }, meta: { warning: 'Store this key now. It cannot be shown again.' } });
    },
  );

  r.post(
    '/v1/keys/:id/revoke',
    { schema: { tags: ['Keys'], summary: 'Revoke one of your keys', security, params: Type.Object({ id: Uuid }) } },
    async (req) => {
      const meta = await accounts.revokeOwnedKey(req.principal!.accountId, req.params.id);
      return { data: meta, meta: { self: meta.id === req.principal!.keyId } };
    },
  );

  r.post(
    '/v1/keys/:id/rotate',
    {
      schema: {
        tags: ['Keys'],
        summary: 'Replace a key; the old one keeps working for a grace period',
        security,
        params: Type.Object({ id: Uuid }),
        // The body is optional as a whole, which a JSON schema cannot express (an absent body would be
        // rejected as "not an object"), so `graceSeconds` is validated by hand below.
        description: 'Optional JSON body: `{ "graceSeconds": 3600 }` (0 to 30 days).',
      },
    },
    async (req) => {
      const grace = parseGrace(req.body, 3600);
      const { key, meta, previous } = await accounts.rotateKey(req.params.id, grace, req.principal!.accountId);
      return { data: { ...meta, key }, meta: { previous, warning: 'Store this key now. It cannot be shown again.' } };
    },
  );

  r.post(
    '/v1/link',
    { schema: { tags: ['Keys'], summary: 'Get a one-time code to add another computer to this account', security } },
    async (req) => {
      // Cap how many codes an account can mint: each is a (rate-limited) guessing target.
      await throttle(redis, `link:acct:${req.principal!.accountId}`, 10, 3600, errors.tooManyAttempts, req.log);
      const code = generateLinkCode();
      await redis.set(linkCodeKey(code), JSON.stringify({ accountId: req.principal!.accountId, by: req.principal!.keyId }), 'EX', LINK_TTL_SECONDS);
      return { data: { code, ttlSeconds: LINK_TTL_SECONDS, expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString() } };
    },
  );

  r.post(
    '/v1/recover',
    {
      schema: {
        tags: ['Keys'],
        summary: 'Use your recovery key to get a working key for a new computer',
        description: 'Authenticate with the RECOVERY key (scope `recover`). It can do nothing else.',
        security,
        body: Type.Object({ deviceName: DeviceName, deviceHash: DeviceHash }),
      },
    },
    async (req, reply) => {
      const { key, meta } = await accounts.addDeviceKey(req.principal!.accountId, {
        deviceName: req.body.deviceName.trim(),
        deviceHash: hashDevice(config.KEY_PEPPER, req.body.deviceHash),
        via: 'recover',
      });
      return reply.code(201).send({
        data: { account: await accounts.getAccountPublic(req.principal!.accountId), key, keyId: meta.id },
        meta: { warning: 'This key belongs to this computer only. It cannot be shown again.' },
      });
    },
  );
}
