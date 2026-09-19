import { ProviderError } from './types.js';

export interface UpstreamRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  /** Hard cap on the response body size. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * fetch() wrapper for talking to upstream providers. Translates every failure mode
 * into a `ProviderError` so the orchestrator can reason about it uniformly, and
 * bounds the response size so a misbehaving upstream can't exhaust memory.
 */
export async function upstreamText(req: UpstreamRequest): Promise<string> {
  let response: Response;
  try {
    response = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      signal: req.signal,
      redirect: 'follow',
    });
  } catch (error) {
    if (req.signal.aborted || (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
      throw new ProviderError('timeout', 'upstream request timed out', { cause: error });
    }
    throw new ProviderError('upstream', `upstream request failed: ${(error as Error).message}`, {
      cause: error,
    });
  }

  if (response.status === 429 || response.status === 403 || response.status === 451) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError('blocked', `upstream refused the request (HTTP ${response.status})`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError('upstream', `upstream returned HTTP ${response.status}`);
  }

  const max = req.maxBytes ?? DEFAULT_MAX_BYTES;
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > max) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError('bad_response', 'upstream response too large');
  }

  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > max) {
        await reader.cancel().catch(() => {});
        throw new ProviderError('bad_response', 'upstream response too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (req.signal.aborted) throw new ProviderError('timeout', 'upstream response timed out', { cause: error });
    throw new ProviderError('upstream', 'upstream connection dropped', { cause: error });
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function upstreamJson<T>(req: UpstreamRequest): Promise<T> {
  const text = await upstreamText(req);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ProviderError('bad_response', 'upstream returned invalid JSON', { cause: error });
  }
}
