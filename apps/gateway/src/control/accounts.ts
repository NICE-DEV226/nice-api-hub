import type { PoolClient } from 'pg';
import type { Db } from '../infra/db.js';
import { errors } from '../errors.js';
import type { KeyResolver } from '../gateway/keyResolver.js';
import { displayPrefix, generateApiKey, hashApiKey, type KeyEnvironment } from '../gateway/keys.js';

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
}

export interface KeySummary {
  id: string;
  accountId: string;
  label: string;
  prefix: string;
  environment: KeyEnvironment;
  platforms: string[] | null;
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
    const { rows } = await this.db.query(
      `INSERT INTO accounts (name, contact_email, plan_id) VALUES ($1,$2,$3) RETURNING *`,
      [input.name, input.contactEmail ?? null, input.planId],
    );
    const account = toAccount(rows[0]);
    await this.audit('account.create', 'account', account.id, input);
    return account;
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
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Lock the account row so concurrent creates can't both slip under max_keys.
      const acc = await client.query(
        `SELECT a.id, p.max_keys FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = $1 FOR UPDATE OF a`,
        [accountId],
      );
      if (!acc.rows[0]) throw errors.notFound('Account not found.');

      const active = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM api_keys
          WHERE account_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
        [accountId],
      );
      if (Number(active.rows[0]!.n) >= acc.rows[0].max_keys) {
        throw errors.conflict('key_limit_reached', `This plan allows at most ${acc.rows[0].max_keys} active keys.`);
      }

      const created = await this.insertKey(client, accountId, input);
      await client.query('COMMIT');
      await this.audit('key.create', 'key', created.meta.id, { accountId, label: input.label });
      return created;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
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
  async rotateKey(keyId: string, graceSeconds: number): Promise<{ key: string; meta: KeySummary; previous: KeySummary }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const old = await client.query('SELECT * FROM api_keys WHERE id = $1 FOR UPDATE', [keyId]);
      const row = old.rows[0];
      if (!row) throw errors.notFound('Key not found.');
      if (row.revoked_at) throw errors.conflict('key_revoked', 'A revoked key cannot be rotated.');

      const created = await this.insertKey(client, row.account_id, {
        label: row.label,
        environment: row.environment,
        platforms: row.platforms,
        expiresAt: iso(row.expires_at),
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
      `INSERT INTO api_keys (account_id, label, prefix, key_hash, environment, platforms, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        accountId,
        input.label,
        displayPrefix(key),
        hashApiKey(key, this.pepper),
        environment,
        input.platforms ?? null,
        input.expiresAt ?? null,
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
