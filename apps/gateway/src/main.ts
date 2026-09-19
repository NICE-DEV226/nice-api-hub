import { buildApp } from './http/app.js';
import { loadConfig } from './config.js';
import { createDb } from './infra/db.js';
import { createRedis } from './infra/redis.js';
import { startProbes } from './probes.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
await redis.connect().catch(() => {
  // The API degrades gracefully without Redis; /readyz will report it.
});

const { app, usage, registry, probeStore } = await buildApp({ config, db, redis });

let probes: ReturnType<typeof startProbes> | null = null;
if (config.PROBES_ENABLED) {
  probes = startProbes({ registry, store: probeStore, redis, config, logger: app.log });
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  try {
    probes?.stop();
    await app.close(); // stop accepting, drain in-flight requests
    await usage.stop(); // flush buffered usage counters
    await db.end();
    redis.disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'error during shutdown');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
