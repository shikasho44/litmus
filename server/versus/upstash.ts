/**
 * RoomStore over Upstash Redis' REST API (plain fetch, no SDK — no new dependency).
 *
 *   POST <url>/pipeline   Authorization: Bearer <token>   body [["HSETNX","k","f","v"],["EXPIRE","k","10800"]]
 *   → [{ "result": 1 }, { "result": 1 }]   (an item may be { "error": "…" })
 *
 * Env (server only, never shipped to the browser): UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN,
 * or the names Vercel's Upstash / KV integration injects: KV_REST_API_URL + KV_REST_API_TOKEN.
 * The token is never logged; failures surface as a retryable 503 (`room store unavailable`).
 */
import { EngineError } from '../engine/errors.js';
import type { EnvLike } from '../engine/env.js';
import type { RoomStore } from './store.js';

type Cmd = (string | number)[];
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface UpstashConfig {
  url: string;
  token: string;
}

/** The configured Upstash REST endpoint, or undefined. */
export function upstashConfig(env: EnvLike): UpstashConfig | undefined {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  if (!url || !token || !/^https:\/\//i.test(url)) return undefined;
  return { url: url.replace(/\/+$/, ''), token };
}

const unavailable = (why: string) => {
  // The reason goes to the server log only (it never contains the token).
  console.error(`[janedoe] versus room store: ${why}`);
  return new EngineError('server', 'room store unavailable', 503, true);
};

export class UpstashRoomStore implements RoomStore {
  readonly kind = 'redis' as const;

  constructor(
    private readonly cfg: UpstashConfig,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly timeoutMs = 4000,
  ) {}

  private async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.url}/pipeline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(cmds.map((c) => c.map(String))),
        signal: ac.signal,
      });
    } catch (e) {
      throw unavailable(ac.signal.aborted ? 'timeout' : `network (${e instanceof Error ? e.name : 'error'})`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw unavailable(`HTTP ${res.status}`);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw unavailable('unreadable response');
    }
    if (!Array.isArray(data) || data.length !== cmds.length) throw unavailable('unexpected response shape');
    return data.map((d, i) => {
      const item = d as { result?: unknown; error?: unknown };
      if (item && typeof item.error === 'string') throw unavailable(`${String(cmds[i][0])} failed`);
      return item?.result;
    });
  }

  private withTtl(cmd: Cmd, key: string, ttlSec?: number): Cmd[] {
    return ttlSec === undefined ? [cmd] : [cmd, ['EXPIRE', key, Math.max(1, Math.round(ttlSec))]];
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const [r] = await this.pipeline([['HGETALL', key]]);
    if (!Array.isArray(r) || r.length === 0) return null;
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < r.length; i += 2) out[String(r[i])] = String(r[i + 1]);
    return out;
  }

  async hsetnx(key: string, field: string, value: string, ttlSec?: number): Promise<boolean> {
    const [r] = await this.pipeline(this.withTtl(['HSETNX', key, field, value], key, ttlSec));
    return Number(r) === 1;
  }

  async hset(key: string, fields: Record<string, string>, ttlSec?: number): Promise<void> {
    const flat = Object.entries(fields).flat();
    if (flat.length === 0) return;
    await this.pipeline(this.withTtl(['HSET', key, ...flat], key, ttlSec));
  }

  async hdel(key: string, fields: string[], ttlSec?: number): Promise<void> {
    if (fields.length === 0) return;
    await this.pipeline(this.withTtl(['HDEL', key, ...fields], key, ttlSec));
  }

  async hincrby(key: string, field: string, by: number, ttlSec?: number): Promise<number> {
    const [r] = await this.pipeline(this.withTtl(['HINCRBY', key, field, Math.trunc(by)], key, ttlSec));
    return Number(r);
  }
}
