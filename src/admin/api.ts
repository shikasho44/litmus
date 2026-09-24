/**
 * Admin API client. Dev server: /api/admin/* is always open. Production: the server only
 * answers when header `x-admin-token` equals ADMIN_TOKEN (otherwise 404, indistinguishable
 * from a missing route). The token lives in sessionStorage (this tab only, cleared when the
 * tab closes) and is never put in a URL.
 */
import type { PipelineMode } from '../../shared/api';
import type { AdminCases, AdminStatus, BenchReportInfo, Health, MintResult, Stage, TraceRecord } from './types';
import type { AskResponse } from '../../shared/api';

const API_BASE = String((import.meta.env.VITE_API_BASE as string | undefined) || '/api').replace(/\/+$/, '');
const TOKEN_KEY = 'janedoe:admin-token';
const TIMEOUT_MS = 30_000;

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
  /** 404 on an admin route = not authorised (or admin disabled on this server). */
  get unauthorized(): boolean {
    return this.status === 404;
  }
}

let memToken = '';
export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memToken;
  } catch {
    return memToken;
  }
}
export function setAdminToken(v: string): void {
  memToken = v;
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: keep it in memory only */
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = getAdminToken();
  if (token) headers['x-admin-token'] = token;
  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ac.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });
    } catch {
      throw new AdminError(ac.signal.aborted ? 'タイムアウトしました' : 'サーバーに接続できません', 0, ac.signal.aborted ? 'timeout' : 'network');
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new AdminError(err?.message ?? `HTTP ${res.status}`, res.status, err?.code ?? 'server');
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const adminApi = {
  health: () => request<Health>('GET', '/health'),
  status: () => request<AdminStatus>('GET', '/admin/status'),
  cases: () => request<AdminCases>('GET', '/admin/cases'),
  traces: (limit = 100, caseId?: string) =>
    request<TraceRecord[]>('GET', `/admin/traces?limit=${limit}${caseId ? `&caseId=${encodeURIComponent(caseId)}` : ''}`),
  bench: () => request<BenchReportInfo[]>('GET', '/admin/bench'),
  askDebug: (b: { caseId: string; question: string; token?: string; mode?: PipelineMode }) => request<AskResponse>('POST', '/admin/ask-debug', b),
  mintToken: (caseId: string, stage: Stage) => request<MintResult>('POST', '/admin/mint-token', { caseId, stage }),
};

/** Decodes (does NOT verify) a progress token payload `j1.<payload>.<sig>` for display. */
export function decodeToken(token: string): { ok: true; payload: unknown } | { ok: false; error: string } {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'j1') return { ok: false, error: '形式が違います（j1.<payload>.<署名> を想定）' };
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch (e) {
    return { ok: false, error: `payload を読めません: ${e instanceof Error ? e.message : String(e)}` };
  }
}
