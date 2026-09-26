/**
 * /api/versus/* over fetch (http build only — this module is never part of the static build).
 * No automatic retries: create / join are not idempotent on their own (join is, per tab, via
 * `cid`), and the poller has its own back-off. Errors are VersusError with the HTTP status and
 * the server message, which ui text maps to Japanese (errorText).
 */
import type {
  VersusConfig, VersusCreateRequest, VersusJoinRequest, VersusRoomResponse, VersusRunResponse, VersusSeatResponse,
} from '../../../shared/versus';
import { VERSUS_ERR } from '../../../shared/versus';

const API_BASE = String((import.meta.env.VITE_API_BASE as string | undefined) || '/api').replace(/\/+$/, '');
const TIMEOUT_MS = 8000;

export class VersusError extends Error {
  constructor(
    readonly code: 'network' | 'timeout' | 'rate_limited' | 'bad_request' | 'bad_token' | 'server',
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
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
      throw ac.signal.aborted ? new VersusError('timeout', 'request timed out') : new VersusError('network', 'network error');
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      const code = (['rate_limited', 'bad_request', 'bad_token', 'server'] as const).find((c) => c === err?.code) ?? (res.status >= 500 ? 'server' : 'bad_request');
      throw new VersusError(code, typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`, res.status);
    }
    if (data === undefined) throw new VersusError('server', 'empty response', res.status);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const vsApi = {
  config: () => request<VersusConfig>('GET', '/versus/config', undefined, 10_000),
  create: (b: VersusCreateRequest) => request<VersusSeatResponse>('POST', '/versus/create', b),
  join: (b: VersusJoinRequest) => request<VersusSeatResponse>('POST', '/versus/join', b),
  start: (seat: string) => request<VersusRoomResponse>('POST', '/versus/start', { seat }),
  state: (seat: string) => request<VersusRoomResponse>('POST', '/versus/state', { seat }),
  run: (seat: string) => request<VersusRunResponse>('POST', '/versus/run', { seat }),
  progress: (seat: string, token: string) => request<VersusRoomResponse>('POST', '/versus/progress', { seat, token }),
  leave: (seat: string) => request<{ ok: true }>('POST', '/versus/leave', { seat }, 4000),
};

/** The seat no longer opens the room (expired, closed, freed, forged): the session is over. */
export function isSessionGone(e: unknown): boolean {
  if (!(e instanceof VersusError)) return false;
  if (e.status === 404 || e.status === 410) return true;
  return e.status === 403 && e.message === VERSUS_ERR.seat;
}

/** Japanese for the errors a player can meet. */
export function errorText(e: unknown): string {
  if (!(e instanceof VersusError)) return '通信に失敗しました。もう一度お試しください。';
  switch (e.message) {
    case VERSUS_ERR.badCode:
      return '部屋コードは6文字です（英字と数字。0・O・1・I・L は使いません）。';
    case VERSUS_ERR.badName:
      return '名前は1〜12文字で入力してください。';
    case VERSUS_ERR.notFound:
      return 'その部屋は見つかりません。コードを確かめてください（部屋は約3時間で消えます）。';
    case VERSUS_ERR.closed:
      return 'その部屋はホストが閉じました。';
    case VERSUS_ERR.full:
      return 'その部屋は満員です（最大4人）。';
    case VERSUS_ERR.started:
      return 'その部屋の審問はもう始まっています。';
    case VERSUS_ERR.tooFew:
      return 'あと1人以上そろうと開始できます。';
    case VERSUS_ERR.notHost:
      return '開始できるのはホストだけです。';
    case VERSUS_ERR.out:
      return 'この対戦は脱落しました。観戦はできます。';
    case VERSUS_ERR.left:
      return 'この部屋から退出しています。';
    case VERSUS_ERR.disabled:
      return 'いまは対戦を使えません。';
  }
  if (e.code === 'rate_limited') return '少し間を置いてから、もう一度お試しください。';
  if (e.code === 'network' || e.code === 'timeout') return '通信できませんでした。電波の良いところで、もう一度お試しください。';
  return '通信に失敗しました。もう一度お試しください。';
}
