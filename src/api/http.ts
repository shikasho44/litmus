/**
 * GameApi over HTTP (dev server, vite preview, Vercel).
 *
 * - one overall deadline per call (REQUEST_DEADLINE_MS ≈ 12 s), not per attempt: the server
 *   answers a turn within 9 s (pipeline TURN_DEADLINE_MS) or not at all, so waiting longer — or
 *   retrying after a timeout — only doubles the silence (it used to take 24.6 s to show an error)
 * - one automatic retry, only after a FAST failure (< FAST_FAIL_MS): a network error or a
 *   500/502/503 that the server did not mark retryable:false. Never after a timeout or a 504.
 *   (All POSTs are safe to repeat: the server is stateless, progress lives in the signed token.)
 * - `slowRequests` counts calls still waiting after SLOW_MS (5 s), so the UI can let Holma say
 *   something instead of only showing the EXAMINING dots
 * - every failure is an ApiError with a code the UI can switch on:
 *     network · timeout · rate_limited · bad_request · bad_token · server
 */
import { signal } from '@preact/signals';
import type {
  AskRequest, AskResponse, CasePublic, CaseSummary, GameApi, GrantRequest, HintRequest, HintResponse,
  InquestStartRequest, InquestStartResponse, ProgressSnapshot, ProgressToken, ReconstructionRequest,
  ReconstructionResult, ReconstructionSubmit, ReconstructionView, ShotRequest, ShotResponse, SolutionResponse,
  VerdictRequest, VerdictResponse,
} from '../../shared/api';
import { ApiError } from '../../shared/api';

type Code = ApiError['code'];
const CODES: readonly Code[] = ['network', 'timeout', 'rate_limited', 'bad_request', 'bad_token', 'server'];

/** Whole call, retry included. */
export const REQUEST_DEADLINE_MS = 12_000;
/** First attempt (leaves room for a fast retry inside the deadline). */
export const HTTP_TIMEOUT_MS = 11_000;
/** A failure later than this is not retried (the server was busy, not unreachable). */
export const FAST_FAIL_MS = 2_000;
/** After this long a call counts as slow (slowRequests). */
export const SLOW_MS = 5_000;
/** Number of HTTP calls in flight for longer than SLOW_MS (UI: Holma's "still examining" line). */
export const slowRequests = signal(0);
const API_BASE = String((import.meta.env.VITE_API_BASE as string | undefined) || '/api').replace(/\/+$/, '');

function codeFor(status: number, bodyCode: unknown): Code {
  if (typeof bodyCode === 'string' && (CODES as readonly string[]).includes(bodyCode)) return bodyCode as Code;
  if (status === 401) return 'bad_token';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'server';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once<T>(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ac.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw ac.signal.aborted ? new ApiError('timeout', 'request timed out', true) : new ApiError('network', 'network error', true);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      if (ac.signal.aborted) throw new ApiError('timeout', 'request timed out', true);
      data = undefined;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | undefined)?.error;
      const code = codeFor(res.status, err?.code);
      const retryable = typeof err?.retryable === 'boolean' ? err.retryable : code === 'server' || code === 'rate_limited';
      const e = new ApiError(code, typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`, retryable);
      (e as ApiError & { status?: number }).status = res.status;
      throw e;
    }
    if (data === undefined) throw new ApiError('server', 'empty response', true);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Worth one more try: failed fast, and not a 504 / timeout / explicit retryable:false. */
function retryableFast(e: unknown, elapsedMs: number): boolean {
  if (!(e instanceof ApiError) || elapsedMs >= FAST_FAIL_MS) return false;
  if (e.code === 'network') return true;
  // status 0 = no HTTP error status (an unreadable / empty 200 body).
  const status = (e as ApiError & { status?: number }).status ?? 0;
  return e.code === 'server' && e.retryable !== false && (status === 0 || (status >= 500 && status <= 503));
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const started = Date.now();
  let slow = false;
  const slowTimer = setTimeout(() => {
    slow = true;
    slowRequests.value = slowRequests.peek() + 1;
  }, SLOW_MS);
  try {
    try {
      return await once<T>(method, path, body, HTTP_TIMEOUT_MS);
    } catch (e) {
      if (!retryableFast(e, Date.now() - started)) throw e;
      await sleep(350 + Math.random() * 400);
      return await once<T>(method, path, body, Math.max(1_000, REQUEST_DEADLINE_MS - (Date.now() - started)));
    }
  } finally {
    clearTimeout(slowTimer);
    if (slow) slowRequests.value = Math.max(0, slowRequests.peek() - 1);
  }
}

export const httpApi: GameApi = {
  listCases: () => call<CaseSummary[]>('GET', '/cases'),
  getCase: (caseId) => call<CasePublic>('GET', `/cases/${encodeURIComponent(caseId)}`),
  newToken: (caseId) => call<{ token: ProgressToken; progress: ProgressSnapshot }>('POST', '/token', { caseId }),
  ask: (req: AskRequest) => call<AskResponse>('POST', '/ask', req),
  hint: (req: HintRequest) => call<HintResponse>('POST', '/hint', req),
  inquestStart: (req: InquestStartRequest) => call<InquestStartResponse>('POST', '/inquest/start', req),
  shot: (req: ShotRequest) => call<ShotResponse>('POST', '/inquest/shot', req),
  grant: (req: GrantRequest) => call<ShotResponse>('POST', '/inquest/grant', req),
  verdict: (req: VerdictRequest) => call<VerdictResponse>('POST', '/inquest/verdict', req),
  reconstruction: (req: ReconstructionRequest) => call<ReconstructionView>('POST', '/reconstruction', req),
  submitReconstruction: (req: ReconstructionSubmit) => call<ReconstructionResult>('POST', '/reconstruction/submit', req),
  solution: (req: { caseId: string; token: ProgressToken }) => call<SolutionResponse>('POST', '/solution', req),
};
