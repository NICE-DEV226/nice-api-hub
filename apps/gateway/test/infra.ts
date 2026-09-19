import { loadConfig, type Config } from '../src/config.js';
import { createDb, migrate, type Db } from '../src/infra/db.js';
import { createRedis } from '../src/infra/redis.js';
import type { Redis } from 'ioredis';

/** Integration tests need real Postgres + Redis (see scripts/dev-services.sh); they skip otherwise. */
export const hasInfra = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL);

export const ADMIN_TOKEN = 'admin-token-for-tests-'.padEnd(40, 'x');
export const KEY_PEPPER = 'pepper-for-tests-'.padEnd(40, 'y');

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL,
    KEY_PEPPER,
    ADMIN_TOKEN,
    USAGE_FLUSH_INTERVAL_MS: '3600000',
    CACHE_TTL_SECONDS: '60',
    JOBS_ENABLED: 'false',
    ...overrides,
  });
}

export async function freshInfra(): Promise<{ db: Db; redis: Redis; config: Config }> {
  const config = testConfig();
  const db = createDb(config.DATABASE_URL);
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
  await migrate(db);
  const redis = createRedis(config.REDIS_URL);
  await redis.connect();
  await redis.flushdb();
  return { db, redis, config };
}
