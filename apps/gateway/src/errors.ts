/**
 * Every failure the API returns is an RFC 9457 `application/problem+json` document.
 * `code` is a stable, machine-readable identifier; `detail` is for humans.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options: {
      headers?: Record<string, string>;
      extensions?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
  }
}

export const errors = {
  invalidRequest: (detail: string, extensions?: Record<string, unknown>) =>
    new AppError(400, 'invalid_request', detail, extensions ? { extensions } : {}),

  unauthorized: (detail = 'A valid API key is required.') =>
    new AppError(401, 'unauthorized', detail, { headers: { 'www-authenticate': 'Bearer' } }),

  forbidden: (code: string, detail: string) => new AppError(403, code, detail),

  notFound: (detail = 'Resource not found.') => new AppError(404, 'not_found', detail),

  conflict: (code: string, detail: string) => new AppError(409, code, detail),

  unsupportedPlatform: (detail: string) => new AppError(422, 'unsupported_platform', detail),

  contentUnavailable: (detail = 'The requested media is unavailable or private.') =>
    new AppError(422, 'content_unavailable', detail),

  rateLimited: (
    reason: 'rate' | 'daily_quota',
    retryAfterSeconds: number,
    headers: Record<string, string> = {},
  ) =>
    new AppError(
      429,
      reason === 'rate' ? 'rate_limited' : 'quota_exceeded',
      reason === 'rate'
        ? 'Too many requests. Slow down and retry after the indicated delay.'
        : 'Daily quota exhausted. It resets at 00:00 UTC.',
      { headers: { ...headers, 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) } },
    ),

  providersExhausted: (attempts: ReadonlyArray<{ provider: string; outcome: string }>) =>
    new AppError(502, 'upstream_unavailable', 'All upstream providers failed for this request.', {
      extensions: { attempts },
    }),

  overloaded: (retryAfterSeconds = 2) =>
    new AppError(503, 'overloaded', 'The service is at capacity. Retry shortly.', {
      headers: { 'retry-after': String(retryAfterSeconds) },
    }),
};

export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId?: string;
  [extension: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function toProblem(error: AppError, requestId?: string): ProblemDocument {
  return {
    type: `urn:nice-api-hub:error:${error.code}`,
    title: TITLES[error.status] ?? 'Error',
    status: error.status,
    code: error.code,
    detail: error.message,
    ...(requestId ? { requestId } : {}),
    ...error.options.extensions,
  };
}
