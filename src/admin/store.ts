/**
 * Admin console state: hash route, auth gate, and the shared data (health / status / cases)
 * that several sections read. Everything is a signal; sections subscribe by reading `.value`.
 */
import { computed, signal } from '@preact/signals';
import { AdminError, adminApi, getAdminToken, setAdminToken } from './api';
import type { AdminCases, AdminStatus, Health } from './types';

/* ------------------------------------------------------------------ */
/* Route: #/<section>/<arg>?k=v                                        */
/* ------------------------------------------------------------------ */

export type Section = 'overview' | 'cases' | 'ask' | 'traces' | 'bench' | 'token';
export const SECTIONS: { id: Section; label: string; en: string; icon: 'pulse' | 'notebook' | 'send' | 'log' | 'star' | 'tag' }[] = [
  { id: 'overview', label: '概要', en: 'OVERVIEW', icon: 'pulse' },
  { id: 'cases', label: '事件データ', en: 'CASES', icon: 'notebook' },
  { id: 'ask', label: '質問テスト', en: 'ASK PLAYGROUND', icon: 'send' },
  { id: 'traces', label: 'トレース', en: 'TRACES', icon: 'log' },
  { id: 'bench', label: 'ベンチ', en: 'BENCH', icon: 'star' },
  { id: 'token', label: 'トークン', en: 'TOKEN TOOL', icon: 'tag' },
];

export interface Route {
  section: Section;
  arg?: string;
  query: URLSearchParams;
}

function parseHash(): Route {
  const raw = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [s, ...rest] = path.split('/').filter(Boolean);
  const section = (SECTIONS.some((x) => x.id === s) ? s : 'overview') as Section;
  return { section, arg: rest.length ? decodeURIComponent(rest.join('/')) : undefined, query: new URLSearchParams(qs ?? '') };
}

export const route = signal<Route>(parseHash());
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => (route.value = parseHash()));

export function go(section: Section, arg?: string, query?: Record<string, string | undefined>): void {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') q.set(k, v);
  const hash = `#/${section}${arg ? `/${encodeURIComponent(arg)}` : ''}${q.toString() ? `?${q}` : ''}`;
  if (location.hash !== hash) location.hash = hash;
  else route.value = parseHash();
}

/** Updates query keys of the current route without adding a history entry. */
export function setQuery(patch: Record<string, string | undefined>): void {
  const r = route.value;
  const q = new URLSearchParams(r.query);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') q.delete(k);
    else q.set(k, v);
  }
  const hash = `#/${r.section}${r.arg ? `/${encodeURIComponent(r.arg)}` : ''}${q.toString() ? `?${q}` : ''}`;
  history.replaceState(null, '', hash);
  route.value = parseHash();
}

/* ------------------------------------------------------------------ */
/* Auth + shared data                                                  */
/* ------------------------------------------------------------------ */

export type AuthState = 'checking' | 'ok' | 'need-token' | 'offline';
export const auth = signal<AuthState>('checking');
export const authError = signal<string>('');
export const hasToken = signal<boolean>(!!getAdminToken());

export const health = signal<Health | null>(null);
export const status = signal<AdminStatus | null>(null);
export const cases = signal<AdminCases | null>(null);
export const casesError = signal<string>('');
export const lastRefresh = signal<number>(0);
/** Bumped by the global 再読込 button; sections with their own data (traces, bench) watch it. */
export const refreshTick = signal<number>(0);
/** Hand-over from the token tool to the ask playground (kept out of the URL). */
export const pendingAsk = signal<{ caseId: string; token?: string; question?: string } | null>(null);

export const caseIds = computed(() => (cases.value?.cases ?? []).map((c) => c.id));

export async function refreshHealth(): Promise<void> {
  try {
    health.value = await adminApi.health();
  } catch {
    health.value = null;
  }
}

export async function refreshStatus(): Promise<void> {
  status.value = await adminApi.status();
}

export async function refreshCases(): Promise<void> {
  try {
    cases.value = await adminApi.cases();
    casesError.value = '';
  } catch (e) {
    casesError.value = e instanceof Error ? e.message : String(e);
  }
}

export async function refreshAll(): Promise<void> {
  refreshTick.value++;
  await Promise.all([refreshHealth(), refreshStatus().catch(() => undefined), refreshCases()]);
  lastRefresh.value = Date.now();
}

/** Probes /api/admin/status with the stored token and sets `auth`. */
export async function connect(): Promise<void> {
  auth.value = 'checking';
  authError.value = '';
  void refreshHealth();
  try {
    status.value = await adminApi.status();
    auth.value = 'ok';
    void refreshCases();
    lastRefresh.value = Date.now();
  } catch (e) {
    if (e instanceof AdminError && e.unauthorized) {
      auth.value = 'need-token';
      if (getAdminToken()) authError.value = 'トークンが違うか、このサーバーでは管理 API が無効です（ADMIN_TOKEN 未設定）。';
    } else {
      auth.value = 'offline';
      authError.value = e instanceof Error ? e.message : String(e);
    }
  }
}

export async function signIn(token: string): Promise<void> {
  setAdminToken(token.trim());
  hasToken.value = !!token.trim();
  await connect();
}

export function signOut(): void {
  setAdminToken('');
  hasToken.value = false;
  status.value = null;
  cases.value = null;
  void connect();
}
