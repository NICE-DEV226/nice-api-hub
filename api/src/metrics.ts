import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by route, method and status',
    labelNames: ['route', 'method', 'status'] as const,
    registers: [registry],
  });
  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['route', 'method'] as const,
    buckets: [0.005, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20],
    registers: [registry],
  });
  const providerCalls = new Counter({
    name: 'provider_calls_total',
    help: 'Upstream provider attempts by outcome',
    labelNames: ['provider', 'outcome'] as const,
    registers: [registry],
  });
  const providerDuration = new Histogram({
    name: 'provider_call_duration_seconds',
    help: 'Upstream provider latency',
    labelNames: ['provider'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    registers: [registry],
  });
  const cacheRequests = new Counter({
    name: 'media_cache_requests_total',
    help: 'Media cache lookups',
    labelNames: ['result'] as const,
    registers: [registry],
  });
  const rateLimited = new Counter({
    name: 'rate_limit_denied_total',
    help: 'Requests denied by the rate limiter',
    labelNames: ['reason'] as const,
    registers: [registry],
  });
  const rateLimiterErrors = new Counter({
    name: 'rate_limiter_errors_total',
    help: 'Rate limiter backend failures (Redis)',
    registers: [registry],
  });
  const circuitState = new Gauge({
    name: 'provider_circuit_state',
    help: 'Circuit breaker state per provider: 0 closed, 1 half-open, 2 open',
    labelNames: ['provider'] as const,
    registers: [registry],
  });
  const jobs = new Counter({
    name: 'jobs_total',
    help: 'Asynchronous jobs by final status',
    labelNames: ['status'] as const,
    registers: [registry],
  });
  const webhookDeliveries = new Counter({
    name: 'webhook_deliveries_total',
    help: 'Webhook delivery attempts by outcome',
    labelNames: ['outcome'] as const,
    registers: [registry],
  });
  const usageBuffered = new Gauge({
    name: 'usage_buffer_entries',
    help: 'Usage counters waiting to be flushed to Postgres',
    registers: [registry],
  });
  const usageFlushErrors = new Counter({
    name: 'usage_flush_errors_total',
    help: 'Failed usage flushes',
    registers: [registry],
  });

  return {
    registry,
    httpRequests,
    httpDuration,
    providerCalls,
    providerDuration,
    cacheRequests,
    rateLimited,
    rateLimiterErrors,
    circuitState,
    jobs,
    webhookDeliveries,
    usageBuffered,
    usageFlushErrors,
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
