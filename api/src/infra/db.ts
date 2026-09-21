import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

export type Db = pg.Pool;

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 10_000,
  });
  // An idle client erroring (e.g. server restart) must not crash the process.
  pool.on('error', () => {});
  return pool;
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * Apply pending SQL migrations in filename order. A Postgres advisory lock makes it
 * safe for several instances to boot at the same time.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
  return applied;
}
