import { loadConfig } from './config.js';
import { AccountsService } from './control/accounts.js';
import { KeyResolver } from './gateway/keyResolver.js';
import { createDb, migrate } from './infra/db.js';
import { createRedis } from './infra/redis.js';

const USAGE = `Usage: cli <command>
  migrate                                  Apply database migrations
  create-account <name> <planId>           Create an account
  create-key <accountId> <label> [live|test]   Issue an API key (printed once)
`;

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();
const db = createDb(config.DATABASE_URL);

try {
  if (command === 'migrate') {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  } else if (command === 'create-account' || command === 'create-key') {
    const redis = createRedis(config.REDIS_URL);
    await redis.connect().catch(() => {});
    const accounts = new AccountsService(db, new KeyResolver({ db, redis, pepper: config.KEY_PEPPER }), config.KEY_PEPPER);
    if (command === 'create-account') {
      const [name, planId] = args;
      if (!name || !planId) throw new Error(USAGE);
      console.log(JSON.stringify(await accounts.createAccount({ name, planId }), null, 2));
    } else {
      const [accountId, label, env] = args;
      if (!accountId || !label) throw new Error(USAGE);
      const { key, meta } = await accounts.createKey(accountId, {
        label,
        environment: env === 'test' ? 'test' : 'live',
      });
      console.log(JSON.stringify(meta, null, 2));
      console.log(`\nAPI key (shown once): ${key}`);
    }
    redis.disconnect();
  } else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
