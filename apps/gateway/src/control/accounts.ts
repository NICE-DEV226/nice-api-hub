import type { PoolClient } from 'pg';
import type { Db } from '../infra/db.js';
import { errors } from '../errors.js';
import type { KeyResolver } from '../gateway/keyResolver.js';
import { displayPrefix, generateApiKey, hashApiKey, type KeyEnvironment } from '../gateway/keys.js';
import { DEVICE_SCOPES, isScope } from '../gateway/scopes.js';

export interface PlanRow {
  id: string;
  name: string;
  rps: number;
  burst: number;
  dailyQuota: number | null;
  maxKeys: number;
  platforms: string[] | null;
}

export interface AccountRow {
  id: string;
  name: string;
  contactEmail: string | null;
  planId: string;
  status: 'active' | 'suspended';
  createdAt: string;
  /** Signs webhook deliveries (see jobs/webhook.ts). */
  webhookSecret: string;
}

export interface KeySummary {
  id: string;
  accountId: string;
  label: string;
  prefix: string;
  environment: KeyEnvironment;
  platforms: string[] | null;
  scopes: string[];
  createdVia: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface CreateKeyInput {
  label: string;
  environment?: KeyEnvironment;
  platforms?: string[] | null;
  expiresAt?: string | null;
  scopes?: string[];
  /** Peppered hash of the machine this key was issued to. */
  deviceHash?: string | null;
  createdVia?: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toAccount(r: any): AccountRow {
  return {
    id: r.id,
    name: r.name,
    contactEmail: r.contact_email,
    planId: r.plan_id,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    webhookSecret: r.webhook_secret,
  };
}

function toKey(r: any): KeySummary {
  return {
    id: r.id,
    accountId: r.account_id,
    label: r.label,
    prefix: r.prefix,
    environment: r.environment,
    platforms: r.platforms,
    scopes: r.scopes,
    createdVia: r.created_via,
    createdAt: r.created_at.toISOString(),
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
    lastUsedAt: iso(r.last_used_at),
  };
}

function toPlan(r: any): PlanRow {
  return {
    id: r.id,
    name: r.name,
    rps: Number(r.rps),
    burst: r.burst,
    dailyQuota: r.daily_quota === null ? null : Number(r.daily_quota),
    maxKeys: r.max_keys,
    platforms: r.platforms,
  };
}

/** Management plane: accounts, plans, keys. Every mutation is audited and invalidates caches. */
export class AccountsService {
  constructor(
    private readonly db: Db,
    private readonly resolver: KeyResolver,
    private readonly pepper: string,
  ) {}

  // ---- plans ---------------------------------------------------------------

  async listPlans(): Promise<PlanRow[]> {
    const { rows } = await this.db.query('SELECT * FROM plans ORDER BY rps');
    return rows.map(toPlan);
  }

  async upsertPlan(plan: PlanRow): Promise<PlanRow> {
    const { rows } = await this.db.query(
      `INSERT INTO plans (id, name, rps, burst, daily_quota, max_keys, platforms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET name=$2, rps=$3, burst=$4, daily_quota=$5, max_keys=$6, platforms=$7
       RETURNING *`,
      [plan.id, plan.name, plan.rps, plan.burst, plan.dailyQuota, plan.maxKeys, plan.platforms],
    );
    await this.invalidateWhere('a.plan_id = $1', [plan.id]);
    await this.audit('plan.upsert', 'plan', plan.id, plan);
    return toPlan(rows[0]);
  }

  // ---- accounts ------------------------------------------------------------

  async createAccount(input: { name: string; contactEmail?: string | null; planId: string }): Promise<AccountRow> {
    await this.requirePlan(input.planId);
    let rows;
    try {
      ({ rows } = await this.db.query(
        `INSERT INTO accounts (name, contact_email, plan_id) VALUES ($1,$2,$3) RETURNING *`,
        [input.name, input.contactEmail ?? null, input.planId],
      ));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw errors.conflict('email_taken', 'An account already uses this email.');
      throw error;
    }
    const account = toAccount(rows[0]);
    await this.audit('account.create', 'account', account.id, input);
    return account;
  }

  /**
   * Anonymous registration of a device. The account, its personal device key and its offline
   * recovery key are created in ONE transaction: a failure never leaves half an account.
   */
  async registerDevice(input: {
    name: string;
    planId: string;
    deviceName: string;
    deviceHash: string | null;
  }): Promise<{ account: AccountRow; key: string; keyMeta: KeySummary; recoveryKey: string }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const plan = await client.query('SELECT 1 FROM plans WHERE id = $1', [input.planId]);
      if (!plan.rowCount) throw errors.signupUnavailable();
      const {
        rows: [row],
      } = await client.query(`INSERT INTO accounts (name, plan_id) VALUES ($1,$2) RETURNING *`, [input.name, input.planId]);
      let device;
      try {
        device = await this.insertKey(client, row.id, {
          label: input.deviceName,
          scopes: DEVICE_SCOPES,
          deviceHash: input.deviceHash,
          createdVia: 'register',
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw errors.deviceAlreadyRegistered();
        throw error;
      }
      const recovery = await this.insertKey(client, row.id, { label: 'recovery', scopes: ['recover'], createdVia: 'register' });
      await client.query('COMMIT');
      const account = toAccount(row);
      await this.audit('account.register', 'account', account.id, { plan: input.planId, device: input.deviceName });
      return { account, key: device.key, keyMeta: device.meta, recoveryKey: recovery.key };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Room for one more device key? (link codes check this BEFORE being consumed.) */
  async assertRoomForDevice(accountId: string): Promise<void> {
    const client = await this.db.connect();
    try {
      const acc = await client.query(`SELECT p.max_keys, a.status FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = $1`, [accountId]);
      if (!acc.rows[0]) throw errors.invalidLinkCode();
      await this.assertKeyRoom(client, accountId, acc.rows[0].max_keys);
    } finally {
      client.release();
    }
  }

  /** A personal device key on an existing account (link code or recovery code). */
  async addDeviceKey(accountId: string, input: { deviceName: string; deviceHash: string | null; via: 'link' | 'recover' }) {
    return this.createKey(accountId, { label: input.deviceName, scopes: DEVICE_SCOPES, deviceHash: input.deviceHash, createdVia: input.via });
  }

  async getAccountPublic(accountId: string): Promise<{ id: string; name: string; plan: string }> {
    const a = await this.getAccount(accountId);
    return { id: a.id, name: a.name, plan: a.planId };
  }

  /** Keys of an account, for the account's owner. */
  async listOwnKeys(accountId: string): Promise<KeySummary[]> {
    return this.listKeys(accountId);
  }

  async revokeOwnedKey(accountId: string, keyId: string): Promise<KeySummary> {
    const { rows } = await this.db.query(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND account_id = $2 RETURNING *`,
      [keyId, accountId],
    );
    if (!rows[0]) throw errors.notFound('Key not found.'); // someone else's key is indistinguishable from a missing one
    await this.resolver.invalidate([rows[0].key_hash]);
    await this.audit('key.revoke', 'key', keyId, { by: 'owner' });
    return toKey(rows[0]);
  }

  async listAccounts(limit: number, offset: number): Promise<{ items: AccountRow[]; total: number }> {
    const [list, count] = await Promise.all([
      this.db.query('SELECT * FROM accounts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
      this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM accounts'),
    ]);
    return { items: list.rows.map(toAccount), total: Number(count.rows[0]!.n) };
  }

  async getAccount(id: string): Promise<AccountRow> {
    const { rows } = await this.db.query('SELECT * FROM accounts WHERE id = $1', [id]);
    if (!rows[0]) throw errors.notFound('Account not found.');
    return toAccount(rows[0]);
  }

  async updateAccount(
    id: string,
    patch: { name?: string; planId?: string; status?: 'active' | 'suspended' },
  ): Promise<AccountRow> {
    if (patch.planId) await this.requirePlan(patch.planId);
    const { rows } = await this.db.query(
      `UPDATE accounts SET
         name    = COALESCE($2, name),
         plan_id = COALESCE($3, plan_id),
         status  = COALESCE($4, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, patch.name ?? null, patch.planId ?? null, patch.status ?? null],
    );
    if (!rows[0]) throw errors.notFound('Account not found.');
    await this.invalidateWhere('k.account_id = $1', [id]);
    await this.audit('account.update', 'account', id, patch);
    return toAccount(rows[0]);
  }

  async rotateWebhookSecret(id: string): Promise<AccountRow> {
    const { rows } = await this.db.query(
      `UPDATE accounts SET webhook_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!rows[0]) throw errors.notFound('Account not found.');
    await this.audit('account.webhook_secret_rotate', 'account', id, null);
    return toAccount(rows[0]);
  }

  // ---- keys ----------------------------------------------------------------

  async listKeys(accountId: string): Promise<KeySummary[]> {
    await this.getAccount(accountId);
    const { rows } = await this.db.query('SELECT * FROM api_keys WHERE account_id = $1 ORDER BY created_at DESC', [
      accountId,
    ]);
    return rows.map(toKey);
  }

  /** Returns the plaintext key ONCE. Only its HMAC is stored. */
  async createKey(accountId: string, input: CreateKeyInput): Promise<{ key: string; meta: KeySummary }> {
    if (input.scopes?.some((sc) => !isScope(sc))) throw errors.invalidRequest('Unknown scope.');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Lock the account row so concurrent creates can't both slip under max_keys.
      const acc = await client.query(
        `SELECT a.id, p.max_keys FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = $1 FOR UPDATE OF a`,
        [accountId],
      );
      if (!acc.rows[0]) throw errors.notFound('Account not found.');

      if (this.usesTheApi(input.scopes)) await this.assertKeyRoom(client, accountId, acc.rows[0].max_keys);

      const created = await this.insertKey(client, accountId, input);
      await client.query('COMMIT');
      await this.audit('key.create', 'key', created.meta.id, { accountId, label: input.label, via: input.createdVia ?? 'admin' });
      return created;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Only keys that can call the API count against the plan's limit: a recovery key must never block a new device. */
  private usesTheApi(scopes: string[] | undefined): boolean {
    return !scopes || scopes.length === 0 || scopes.includes('media');
  }

  private async assertKeyRoom(client: PoolClient, accountId: string, maxKeys: number): Promise<void> {
    const active = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api_keys
        WHERE account_id = $1 AND 'media' = ANY(scopes) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [accountId],
    );
    if (Number(active.rows[0]!.n) >= maxKeys) {
      throw errors.conflict('key_limit_reached', `This plan allows at most ${maxKeys} active keys. Revoke one first.`);
    }
  }

  async revokeKey(keyId: string): Promise<KeySummary> {
    const { rows } = await this.db.query(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING *`,
      [keyId],
    );
    if (!rows[0]) throw errors.notFound('Key not found.');
    await this.resolver.invalidate([rows[0].key_hash]);
    await this.audit('key.revoke', 'key', keyId, null);
    return toKey(rows[0]);
  }

  /**
   * Issue a replacement key and let the old one keep working for `graceSeconds`,
   * so clients can roll over without downtime.
   */
  async rotateKey(keyId: string, graceSeconds: number, ownerAccountId?: string): Promise<{ key: string; meta: KeySummary; previous: KeySummary }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const old = await client.query('SELECT * FROM api_keys WHERE id = $1 FOR UPDATE', [keyId]);
      const row = old.rows[0];
      if (!row || (ownerAccountId && row.account_id !== ownerAccountId)) throw errors.notFound('Key not found.');
      if (row.revoked_at) throw errors.conflict('key_revoked', 'A revoked key cannot be rotated.');

      const created = await this.insertKey(client, row.account_id, {
        label: row.label,
        environment: row.environment,
        platforms: row.platforms,
        expiresAt: iso(row.expires_at),
        scopes: row.scopes,
        deviceHash: row.device_hash,
        createdVia: ownerAccountId ? 'self' : 'admin',
      });
      const updated = await client.query(
        `UPDATE api_keys SET expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamptz), now() + make_interval(secs => $2))
          WHERE id = $1 RETURNING *`,
        [keyId, graceSeconds],
      );
      await client.query('COMMIT');
      await this.resolver.invalidate([row.key_hash]);
      await this.audit('key.rotate', 'key', keyId, { newKeyId: created.meta.id, graceSeconds });
      return { ...created, previous: toKey(updated.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ---- usage ---------------------------------------------------------------

  async usage(accountId: string, days: number) {
    const { rows } = await this.db.query(
      `SELECT day::text AS day, platform, requests::int, errors::int, cache_hits::int, rate_limited::int
         FROM usage_daily
        WHERE account_id = $1 AND day > (now() AT TIME ZONE 'utc')::date - $2::int
        ORDER BY day DESC, platform`,
      [accountId, days],
    );
    return rows as Array<{
      day: string;
      platform: string;
      requests: number;
      errors: number;
      cache_hits: number;
      rate_limited: number;
    }>;
  }

  // ---- internals -----------------------------------------------------------

  private async insertKey(
    client: PoolClient,
    accountId: string,
    input: CreateKeyInput,
  ): Promise<{ key: string; meta: KeySummary }> {
    const environment = input.environment ?? 'live';
    const { key } = generateApiKey(environment);
    const { rows } = await client.query(
      `INSERT INTO api_keys (account_id, label, prefix, key_hash, environment, platforms, expires_at, scopes, device_hash, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        accountId,
        input.label,
        displayPrefix(key),
        hashApiKey(key, this.pepper),
        environment,
        input.platforms ?? null,
        input.expiresAt ?? null,
        input.scopes && input.scopes.length > 0 ? input.scopes : ['media'],
        input.deviceHash ?? null,
        input.createdVia ?? 'admin',
      ],
    );
    return { key, meta: toKey(rows[0]) };
  }

  private async requirePlan(planId: string): Promise<void> {
    const { rowCount } = await this.db.query('SELECT 1 FROM plans WHERE id = $1', [planId]);
    if (!rowCount) throw errors.invalidRequest(`Unknown plan "${planId}".`);
  }

  private async invalidateWhere(condition: string, params: unknown[]): Promise<void> {
    const { rows } = await this.db.query<{ key_hash: string }>(
      `SELECT k.key_hash FROM api_keys k JOIN accounts a ON a.id = k.account_id WHERE ${condition}`,
      params,
    );
    await this.resolver.invalidate(rows.map((r) => r.key_hash));
  }

  private async audit(action: string, targetType: string, targetId: string | null, detail: unknown): Promise<void> {
    await this.db
      .query(`INSERT INTO audit_log (actor, action, target_type, target_id, detail) VALUES ('admin',$1,$2,$3,$4)`, [
        action,
        targetType,
        targetId,
        detail === null ? null : JSON.stringify(detail),
      ])
      .catch(() => {});
  }
}
