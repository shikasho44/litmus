/**
 * GameApi over HTTP (dev server, vite preview, Vercel).
 *
 * - 12 s timeout per attempt (AbortController)
 * - one automatic retry on network error / timeout / 5xx (never on 4xx or 429)
 * - every failure is an ApiError with a code the UI can switch on:
 *     network · timeout · rate_limited · bad_request · bad_token · server
 */
import type {
  AskRequest, AskResponse, CasePublic, CaseSummary, GameApi, GrantRequest, HintRequest, HintResponse,
  InquestStartRequest, InquestStartResponse, ProgressSnapshot, ProgressToken, ReconstructionRequest,
  ReconstructionResult, ReconstructionSubmit, ReconstructionView, ShotRequest, ShotResponse, SolutionResponse,
  VerdictRequest, VerdictResponse,
} from '../../shared/api';
import { ApiError } from '../../shared/api';

type Code = ApiError['code'];
const CODES: readonly Code[] = ['network', 'timeout', 'rate_limited', 'bad_request', 'bad_token', 'server'];

export const HTTP_TIMEOUT_MS = 12_000;
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

async function once<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
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

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  try {
    return await once<T>(method, path, body);
  } catch (e) {
    const transient = e instanceof ApiError && (e.code === 'network' || e.code === 'timeout' || (e.code === 'server' && ((e as ApiError & { status?: number }).status ?? 500) >= 500));
    if (!transient) throw e;
    await sleep(350 + Math.random() * 400);
    return once<T>(method, path, body);
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
