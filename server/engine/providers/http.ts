/**
 * Minimal JSON-over-HTTP helper shared by the OpenRouter / TypeSafe providers.
 *
 * Pure (global `fetch`, AbortController): runs on Node 20+, Vercel and in tests with a fake
 * fetch. Maps every transport problem to a ProviderError kind the pipeline understands:
 *
 *   our timeout / caller abort / 408      → 'timeout'
 *   fetch rejected (DNS, reset, offline)  → 'network'
 *   429                                   → 'rate_limited'
 *   5xx, unparsable body                  → 'server'
 *   401 / 402 / 403 (key, credits)        → 'config'
 *   other 4xx                             → 'bad_request'
 *
 * Secrets: the Authorization header is built by the caller and never appears in messages.
 */
import { ProviderError } from './types.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface PostOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface PostResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  status: number;
  latencyMs: number;
}

export const DEFAULT_HTTP_TIMEOUT_MS = 8000;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Short, key-free description of an error body. */
export function errorSnippet(text: string): string {
  let msg = text;
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.message ?? j?.error;
    if (typeof m === 'string') msg = m;
    else if (m) msg = JSON.stringify(m);
  } catch {
    /* plain text */
  }
  return msg.replace(/\s+/g, ' ').replace(/(sk|or|ts)-[A-Za-z0-9_-]{8,}/g, '[redacted]').slice(0, 200);
}

export function kindForStatus(status: number): ProviderError['kind'] {
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 402 || status === 403) return 'config';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as { name?: string }).name === 'AbortError' || (e as { name?: string }).name === 'TimeoutError');
}

export async function postJson(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: PostOptions = {},
): Promise<PostResult> {
  const f: FetchLike | undefined = opts.fetchImpl ?? (typeof fetch === 'function' ? (fetch as FetchLike) : undefined);
  if (!f) throw new ProviderError(provider, 'config', 'fetch is not available in this runtime');
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  const onAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const t0 = now();
  try {
    let res: Response;
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      if (timedOut || opts.signal?.aborted || isAbortError(e)) throw new ProviderError(provider, 'timeout', `no response within ${timeoutMs} ms`);
      throw new ProviderError(provider, 'network', e instanceof Error ? e.message.slice(0, 160) : 'fetch failed');
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      if (timedOut || opts.signal?.aborted || isAbortError(e)) throw new ProviderError(provider, 'timeout', `body not received within ${timeoutMs} ms`);
      throw new ProviderError(provider, 'network', 'connection dropped while reading the body');
    }
    if (!res.ok) throw new ProviderError(provider, kindForStatus(res.status), `HTTP ${res.status}: ${errorSnippet(text)}`);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError(provider, 'server', `invalid JSON response (${text.length} bytes)`);
    }
    // Some gateways answer 200 with an error object.
    const err = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (err && typeof err === 'object') {
      const code = Number(err.code);
      throw new ProviderError(provider, Number.isFinite(code) && code >= 400 ? kindForStatus(code) : 'server', `error: ${errorSnippet(JSON.stringify({ error: err }))}`);
    }
    return { data, status: res.status, latencyMs: Math.round(now() - t0) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
