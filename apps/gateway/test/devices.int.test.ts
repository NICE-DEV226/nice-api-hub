import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/http/app.js';
import { issueChallenge, linkCodeKey, solvePow } from '../src/gateway/registration.js';
import type { Db } from '../src/infra/db.js';
import { fakeProvider } from './helpers.js';
import { ADMIN_TOKEN, KEY_PEPPER, freshInfra, hasInfra, testConfig } from './infra.js';

const fp = (s: string) => createHash('sha256').update(s).digest('hex');
const TIKTOK = 'https://www.tiktok.com/@u/video/1';
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

describe.skipIf(!hasInfra)('device accounts: register, link, recover, keys', () => {
  let db: Db;
  let redis: Redis;
  const built: BuiltApp[] = [];

  async function app(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const b = await buildApp({
      config: testConfig({ SIGNUP_MODE: 'open', REGISTER_POW_BITS: '8', SIGNUP_PER_IP_PER_HOUR: '1000', ...env }),
      db,
      redis,
      providers: [fakeProvider('p', 'tiktok', 1).provider],
    });
    built.push(b);
    await b.app.ready();
    return b.app;
  }

  const admin = (a: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: object) =>
    a.inject({ method, url: `/admin/v1${url}`, headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, ...(payload ? { payload } : {}) });
  const as = (a: FastifyInstance, key: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    a.inject({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload ? { payload } : {}) });
  const count = async (table: string) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

  async function solved(a: FastifyInstance) {
    const info = (await a.inject({ method: 'GET', url: '/v1/register' })).json().data;
    return { challenge: info.challenge.token as string, nonce: solvePow(info.challenge.token, info.challenge.bits) };
  }
  async function register(a: FastifyInstance, device = 'laptop', seed = device + Math.random(), extra: Record<string, unknown> = {}, ip = nextIp()) {
    return a.inject({ method: 'POST', url: '/v1/register', remoteAddress: ip, payload: { deviceName: device, deviceHash: fp(seed), ...(await solved(a)), ...extra } });
  }
  async function registered(a: FastifyInstance, device = 'laptop', seed?: string) {
    const res = await register(a, device, seed);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { account: { id: string; name: string; plan: string }; key: string; keyId: string; recoveryKey: string };
  }
  const link = async (a: FastifyInstance, key: string) => (await as(a, key, 'POST', '/v1/link')).json().data.code as string;
  const redeem = (a: FastifyInstance, code: string, device = 'phone', seed = device + Math.random(), ip = nextIp()) =>
    a.inject({ method: 'POST', url: '/v1/link/redeem', remoteAddress: ip, payload: { code, deviceName: device, deviceHash: fp(seed) } });

  beforeAll(async () => {
    ({ db, redis } = await freshInfra());
  });
  afterAll(async () => {
    for (const b of built) {
      await b.usage.stop();
      await b.app.close();
    }
    await db.end();
    redis.disconnect();
  });

  describe('registration', () => {
    it('is closed by default: no challenge is handed out and nothing can be created', async () => {
      const a = await app({ SIGNUP_MODE: 'closed' });
      const info = (await a.inject({ method: 'GET', url: '/v1/register' })).json().data;
      expect(info).toMatchObject({ mode: 'closed', plan: null, challenge: null });
      const before = await count('accounts');
      const res = await a.inject({ method: 'POST', url: '/v1/register', payload: { deviceName: 'x', deviceHash: fp('x'), challenge: 'a.b', nonce: '1' } });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('signups_closed');
      expect(await count('accounts')).toBe(before);
    });

    it('when open, announces the plan and a fresh challenge every time', async () => {
      const a = await app();
      const one = (await a.inject({ method: 'GET', url: '/v1/register' })).json().data;
      const two = (await a.inject({ method: 'GET', url: '/v1/register' })).json().data;
      expect(one).toMatchObject({ mode: 'open', oneAccountPerDevice: true, plan: { id: 'free', limits: { burst: 5, dailyQuota: 100, maxKeys: 3 } }, challenge: { bits: 8 } });
      expect(one.challenge.token).not.toBe(two.challenge.token);
    });

    it('creates an account with a working device key AND a recovery key that can do nothing else', async () => {
      const a = await app();
      const r = await registered(a, 'My Laptop');
      expect(r.key).toMatch(/^nah_live_/);
      expect(r.recoveryKey).toMatch(/^nah_live_/);
      expect(r.key).not.toBe(r.recoveryKey);
      expect(r.account).toMatchObject({ name: 'My Laptop', plan: 'free' });

      // The device key uses the API and manages keys.
      expect((await as(a, r.key, 'GET', '/v1/account')).json().data).toMatchObject({ plan: 'free' });
      expect((await as(a, r.key, 'GET', `/v1/media?url=${encodeURIComponent(TIKTOK)}`)).statusCode).toBe(200);
      const keys = (await as(a, r.key, 'GET', '/v1/keys')).json().data;
      expect(keys).toHaveLength(2);
      expect(keys.find((k: any) => k.current)).toMatchObject({ label: 'My Laptop', scopes: ['media', 'keys'], createdVia: 'register' });
      expect(keys.find((k: any) => !k.current)).toMatchObject({ label: 'recovery', scopes: ['recover'] });

      // The recovery key cannot use the API nor manage keys (deny by default).
      for (const [method, url] of [['GET', '/v1/account'], ['GET', `/v1/media?url=${encodeURIComponent(TIKTOK)}`], ['GET', '/v1/keys'], ['POST', '/v1/link']] as const) {
        const res = await as(a, r.recoveryKey, method, url);
        expect(res.statusCode, url).toBe(403);
        expect(res.json().code).toBe('insufficient_scope');
      }
    });

    it('never stores the raw machine fingerprint', async () => {
      const a = await app();
      const seed = 'raw-machine-id';
      const r = await registered(a, 'Box', seed);
      const stored = (await db.query('SELECT device_hash FROM api_keys WHERE id = $1', [r.keyId])).rows[0].device_hash as string;
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      expect([fp(seed), seed]).not.toContain(stored);
    });

    it('rejects unsolved, forged, expired and replayed proofs of work', async () => {
      const a = await app();
      const good = await solved(a);
      const body = (extra: object) => ({ deviceName: 'd', deviceHash: fp('pow' + Math.random()), ...good, ...extra });
      const post = (payload: object) => a.inject({ method: 'POST', url: '/v1/register', remoteAddress: nextIp(), payload });

      // unsolved: a nonce that does not meet the difficulty (search for one that fails)
      const c = (await a.inject({ method: 'GET', url: '/v1/register' })).json().data.challenge;
      let bad = 'x';
      for (let i = 0; ; i++) if (solvePow(c.token, 8) !== String(i)) { bad = String(i); break; }
      const failing = (await post({ deviceName: 'd', deviceHash: fp('u'), challenge: c.token, nonce: bad })).json();
      expect(failing.code).toBe('invalid_pow');

      // forged (signed with another secret) and expired
      const forged = issueChallenge('z'.repeat(40), 8);
      expect((await post(body({ challenge: forged.token, nonce: solvePow(forged.token, 8) }))).json().detail).toMatch(/forged/);
      const old = issueChallenge(KEY_PEPPER, 8, 10, Date.now() - 60_000);
      expect((await post(body({ challenge: old.token, nonce: solvePow(old.token, 8) }))).json().detail).toMatch(/expired/);

      // a solved challenge works exactly once
      expect((await post(body({}))).statusCode).toBe(201);
      const replay = await post(body({ deviceHash: fp('other-machine') }));
      expect(replay.statusCode).toBe(400);
      expect(replay.json().detail).toMatch(/already used/);
    });

    it('allows one active account per machine, atomically, and frees the machine when its key is revoked', async () => {
      const a = await app();
      const seed = 'same-machine';
      const first = await registered(a, 'one', seed);
      const dup = await register(a, 'two', seed);
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('device_already_registered');
      expect(dup.json().detail).toMatch(/nah link/);

      // simultaneous attempts: exactly one winner (unique index, not check-then-insert)
      const race = 'race-machine';
      const results = await Promise.all([register(a, 'r1', race), register(a, 'r2', race), register(a, 'r3', race)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);

      // after revoking the device key the machine can register again
      expect((await as(a, first.key, 'POST', `/v1/keys/${first.keyId}/revoke`)).statusCode).toBe(200);
      expect((await register(a, 'again', seed)).statusCode).toBe(201);
    });

    it('can be told not to bind accounts to machines at all', async () => {
      const a = await app({ REGISTER_ONE_PER_DEVICE: 'false' });
      const seed = 'shared-kiosk';
      expect((await register(a, 'a', seed)).statusCode).toBe(201);
      expect((await register(a, 'b', seed)).statusCode).toBe(201);
      const hashes = (await db.query(`SELECT device_hash FROM api_keys WHERE label IN ('a','b')`)).rows;
      expect(hashes.every((h) => h.device_hash === null)).toBe(true); // nothing about the machine is kept
    });

    it('limits attempts per IP and validates input', async () => {
      const a = await app({ SIGNUP_PER_IP_PER_HOUR: '3' });
      const ip = '203.0.113.77';
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await register(a, `bot${i}`, undefined, {}, ip)).statusCode);
      expect(codes).toEqual([201, 201, 201, 429, 429]);
      expect((await register(a, 'human', undefined, {}, '203.0.113.78')).statusCode).toBe(201);

      const b = await app();
      for (const payload of [{}, { deviceName: '' }, { deviceName: 'ok', deviceHash: 'nothex', challenge: 'a.b', nonce: '1' }, { deviceName: 'x'.repeat(65), deviceHash: fp('x'), challenge: 'a.b', nonce: '1' }]) {
        expect((await b.inject({ method: 'POST', url: '/v1/register', remoteAddress: nextIp(), payload })).statusCode, JSON.stringify(payload)).toBe(400);
      }
    });

    it('invite mode: needs a code, and guesses count against the IP limit', async () => {
      const a = await app({ SIGNUP_MODE: 'invite', SIGNUP_INVITE_CODES: 'welcome-2026,partner-code-9', SIGNUP_PER_IP_PER_HOUR: '3' });
      const ip = '198.18.0.9';
      expect((await register(a, 'x', undefined, {}, ip)).json().code).toBe('invalid_invite');
      expect((await register(a, 'x', undefined, { inviteCode: 'guess-1' }, ip)).statusCode).toBe(403);
      expect((await register(a, 'x', undefined, { inviteCode: 'partner-code-9' }, ip)).statusCode).toBe(201);
      expect((await register(a, 'y', undefined, { inviteCode: 'welcome-2026' }, ip)).statusCode).toBe(429);
    });

    it('creates nothing when the configured plan does not exist', async () => {
      const a = await app({ SIGNUP_PLAN: 'ghost' });
      const before = { acc: await count('accounts'), keys: await count('api_keys') };
      const res = await register(a, 'nobody');
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('signup_unavailable');
      expect({ acc: await count('accounts'), keys: await count('api_keys') }).toEqual(before);
    });
  });

  describe('linking another computer', () => {
    it('adds a device to the SAME account with a one-time code', async () => {
      const a = await app();
      const me = await registered(a, 'laptop');
      const code = await link(a, me.key);
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);

      const res = await redeem(a, code.toLowerCase().replace('-', ' '), 'phone'); // forgiving input
      expect(res.statusCode, res.body).toBe(201);
      const phone = res.json().data;
      expect(phone.account.id).toBe(me.account.id);
      expect(phone.key).not.toBe(me.key);
      expect((await as(a, phone.key, 'GET', '/v1/account')).json().data.id).toBe(me.account.id);

      const labels = (await as(a, me.key, 'GET', '/v1/keys')).json().data.map((k: any) => k.label).sort();
      expect(labels).toEqual(['laptop', 'phone', 'recovery']);

      // single use
      const again = await redeem(a, code);
      expect(again.statusCode).toBe(400);
      expect(again.json().code).toBe('invalid_link_code');
    });

    it('refuses garbage, unknown and expired codes the same way', async () => {
      const a = await app();
      const me = await registered(a, 'laptop');
      for (const bad of ['', 'nope', 'AAAA-AAAA', '../../etc/passwd', 'K7QM-2XP0']) {
        expect((await redeem(a, bad)).json().code, bad).toBe('invalid_link_code');
      }
      const code = await link(a, me.key);
      await redis.del(linkCodeKey(code)); // as if it had expired
      expect((await redeem(a, code)).statusCode).toBe(400);
    });

    it('rate-limits guessing per IP', async () => {
      const a = await app();
      const ip = '192.0.2.200';
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await redeem(a, 'AAAA-AAAA', 'x', 'x', ip)).statusCode);
      expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    });

    it('respects the plan device limit WITHOUT burning the code', async () => {
      const a = await app();
      const me = await registered(a, 'd1'); // free plan: 3 devices (the recovery key does not count)
      expect((await redeem(a, await link(a, me.key), 'd2')).statusCode).toBe(201);
      expect((await redeem(a, await link(a, me.key), 'd3')).statusCode).toBe(201);

      const code = await link(a, me.key);
      const full = await redeem(a, code, 'd4');
      expect(full.statusCode).toBe(409);
      expect(full.json().code).toBe('key_limit_reached');

      // free a slot: the very same code now works
      expect((await as(a, me.key, 'POST', `/v1/keys/${me.keyId}/revoke`)).statusCode).toBe(200);
      const d2 = (await db.query(`SELECT id FROM api_keys WHERE account_id = $1 AND label = 'd2'`, [me.account.id])).rows[0].id;
      // me.key is revoked now; use the admin API to free a slot for the same account instead
      await admin(a, 'POST', `/keys/${d2}/revoke`);
      expect((await redeem(a, code, 'd4')).statusCode).toBe(201);
    });

    it('needs the keys scope to create a code', async () => {
      const a = await app();
      const acc = (await admin(a, 'POST', '/accounts', { name: 'Ops', planId: 'pro' })).json().data.id;
      const mediaOnly = (await admin(a, 'POST', `/accounts/${acc}/keys`, { label: 'app' })).json().data.key;
      const res = await as(a, mediaOnly, 'POST', '/v1/link');
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('insufficient_scope');
    });
  });

  describe('recovery', () => {
    it('trades the recovery key for a working key on a new computer, and stays usable', async () => {
      const a = await app();
      const me = await registered(a, 'lost-laptop');
      const one = await as(a, me.recoveryKey, 'POST', '/v1/recover', { deviceName: 'new-pc', deviceHash: fp('new-pc') });
      expect(one.statusCode, one.body).toBe(201);
      const fresh = one.json().data;
      expect(fresh.account.id).toBe(me.account.id);
      expect((await as(a, fresh.key, 'GET', '/v1/account')).statusCode).toBe(200);
      expect((await as(a, fresh.key, 'GET', '/v1/keys')).json().data.find((k: any) => k.id === fresh.keyId)).toMatchObject({ createdVia: 'recover', scopes: ['media', 'keys'] });

      // the old laptop key can now be revoked from the new computer
      expect((await as(a, fresh.key, 'POST', `/v1/keys/${me.keyId}/revoke`)).statusCode).toBe(200);
      expect((await as(a, me.key, 'GET', '/v1/account')).statusCode).toBe(401);
      // and the recovery key still works for the next time
      expect((await as(a, me.recoveryKey, 'POST', '/v1/recover', { deviceName: 'pc-3', deviceHash: fp('pc-3') })).statusCode).toBe(201);
    });

    it('a normal device key cannot use /recover', async () => {
      const a = await app();
      const me = await registered(a, 'x');
      expect((await as(a, me.key, 'POST', '/v1/recover', { deviceName: 'y', deviceHash: fp('y') })).statusCode).toBe(403);
    });
  });

  describe('managing your own keys', () => {
    it('creates keys with a subset of scopes, and rejects unknown ones', async () => {
      const a = await app();
      const me = await registered(a, 'dev');
      const created = await as(a, me.key, 'POST', '/v1/keys', { label: 'ci' });
      expect(created.statusCode).toBe(201);
      const ci = created.json().data;
      expect(ci).toMatchObject({ label: 'ci', scopes: ['media'], createdVia: 'self' });
      expect((await as(a, ci.key, 'GET', '/v1/account')).statusCode).toBe(200);
      expect((await as(a, ci.key, 'GET', '/v1/keys')).statusCode).toBe(403); // an app key cannot manage keys

      for (const scopes of [['admin'], ['media', 'root'], []]) {
        expect((await as(a, me.key, 'POST', '/v1/keys', { label: 'bad', scopes })).statusCode, JSON.stringify(scopes)).toBe(400);
      }
    });

    it('revokes immediately, only within the account', async () => {
      const a = await app();
      const me = await registered(a, 'mine');
      const other = await registered(a, 'theirs');
      const ci = (await as(a, me.key, 'POST', '/v1/keys', { label: 'ci' })).json().data;
      expect((await as(a, ci.key, 'GET', '/v1/account')).statusCode).toBe(200);
      expect((await as(a, me.key, 'POST', `/v1/keys/${ci.id}/revoke`)).statusCode).toBe(200);
      expect((await as(a, ci.key, 'GET', '/v1/account')).statusCode).toBe(401); // despite the auth cache

      // someone else's key is indistinguishable from a missing one
      expect((await as(a, me.key, 'POST', `/v1/keys/${other.keyId}/revoke`)).statusCode).toBe(404);
      expect((await as(a, other.key, 'GET', '/v1/account')).statusCode).toBe(200);
      // revoking yourself is allowed and flagged
      const self = await as(a, me.key, 'POST', `/v1/keys/${me.keyId}/revoke`);
      expect(self.json().meta.self).toBe(true);
    });

    it('rotates a key, keeping its scopes, with a grace period for the old one', async () => {
      const a = await app({ SIGNUP_PLAN: 'enterprise' }); // this test makes many calls: keep the free plan's burst out of the way
      const me = await registered(a, 'rot');
      const res = await as(a, me.key, 'POST', `/v1/keys/${me.keyId}/rotate`, { graceSeconds: 0 });
      expect(res.statusCode, res.body).toBe(200);
      const fresh = res.json().data;
      expect(fresh.key).not.toBe(me.key);
      expect(fresh.scopes).toEqual(['media', 'keys']);
      expect((await as(a, me.key, 'GET', '/v1/account')).statusCode).toBe(401);
      expect((await as(a, fresh.key, 'GET', '/v1/keys')).statusCode).toBe(200);
      // the body is optional (default grace), but must be sane when present
      const noBody = await as(a, fresh.key, 'POST', `/v1/keys/${fresh.id}/rotate`);
      expect(noBody.statusCode, noBody.body).toBe(200);
      expect((await as(a, noBody.json().data.key, 'POST', `/v1/keys/${noBody.json().data.id}/rotate`, { graceSeconds: -5 })).statusCode).toBe(400);
      expect((await as(a, noBody.json().data.key, 'POST', `/v1/keys/${noBody.json().data.id}/rotate`, { graceSeconds: 'soon' })).statusCode).toBe(400);
      // not someone else's
      const other = await registered(a, 'other-rot');
      expect((await as(a, noBody.json().data.key, 'POST', `/v1/keys/${other.keyId}/rotate`)).statusCode).toBe(404);
    });

    it('cannot mint a key with wider platform access than its own', async () => {
      const a = await app();
      const me = await registered(a, 'p');
      const narrow = (await as(a, me.key, 'POST', '/v1/keys', { label: 'tt-only', scopes: ['media', 'keys'], platforms: ['tiktok'] })).json().data;
      const ok = await as(a, narrow.key, 'POST', '/v1/keys', { label: 'child' });
      expect(ok.json().data.platforms).toEqual(['tiktok']); // inherits the restriction
      const wider = await as(a, narrow.key, 'POST', '/v1/keys', { label: 'wide', platforms: ['tiktok', 'youtube'] });
      expect(wider.statusCode).toBe(403);
    });

    it('enforces the plan key limit on personal keys too', async () => {
      const a = await app();
      const me = await registered(a, 'limit'); // free: 3 media keys
      expect((await as(a, me.key, 'POST', '/v1/keys', { label: 'k2' })).statusCode).toBe(201);
      expect((await as(a, me.key, 'POST', '/v1/keys', { label: 'k3' })).statusCode).toBe(201);
      const over = await as(a, me.key, 'POST', '/v1/keys', { label: 'k4' });
      expect(over.statusCode).toBe(409);
      expect(over.json().code).toBe('key_limit_reached');
      // a recovery key does not count against the limit
      expect((await as(a, me.key, 'POST', '/v1/keys', { label: 'rec2', scopes: ['recover'] })).statusCode).toBe(201);
    });
  });

  describe('operators', () => {
    it('can issue keys with explicit scopes, and existing keys stay media-only', async () => {
      const a = await app();
      const acc = (await admin(a, 'POST', '/accounts', { name: 'Op', planId: 'pro' })).json().data.id;
      const plain = (await admin(a, 'POST', `/accounts/${acc}/keys`, { label: 'plain' })).json();
      expect(plain.data.scopes).toEqual(['media']);
      const managing = (await admin(a, 'POST', `/accounts/${acc}/keys`, { label: 'mgr', scopes: ['media', 'keys'] })).json().data.key;
      expect((await as(a, managing, 'GET', '/v1/keys')).statusCode).toBe(200);
      expect((await admin(a, 'POST', `/accounts/${acc}/keys`, { label: 'x', scopes: ['superuser'] })).statusCode).toBe(400);
    });
  });

  it('is documented in OpenAPI', async () => {
    const a = await app();
    const spec = (await a.inject({ method: 'GET', url: '/openapi.json' })).json();
    const expected: Array<[string, string]> = [['/v1/register', 'post'], ['/v1/register', 'get'], ['/v1/link/redeem', 'post'], ['/v1/link', 'post'], ['/v1/recover', 'post'], ['/v1/keys', 'get'], ['/v1/keys', 'post']];
    for (const [path, method] of expected) {
      expect(spec.paths[path]?.[method], `${method} ${path}`).toBeDefined();
    }
  });
});
