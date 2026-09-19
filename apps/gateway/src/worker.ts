import pino from 'pino';
import { loadConfig } from './config.js';
import { createRedis } from './infra/redis.js';
import { DEFAULT_PROVIDERS } from './http/app.js';
import { startProbes, ProbeStore } from './probes.js';
import { PLATFORMS } from './providers/platforms.js';
import { ProviderRegistry } from './providers/registry.js';

/** Standalone probe runner: `node dist/worker.js`. Needs only Redis. */
const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });
const redis = createRedis(config.REDIS_URL);
await redis.connect();

const probes = startProbes({
  registry: new ProviderRegistry(DEFAULT_PROVIDERS, PLATFORMS),
  store: new ProbeStore(redis),
  redis,
  config,
  logger,
});
logger.info('probe worker started');

const stop = () => {
  probes.stop();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
