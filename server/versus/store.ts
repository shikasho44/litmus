/**
 * RoomStore — the few Redis hash commands the versus service needs, with two implementations:
 *   MemoryRoomStore  one process (dev server, tests, local preview with VERSUS_STORE=memory)
 *   UpstashRoomStore Upstash Redis over its REST API (server/versus/upstash.ts) — serverless
 *
 * One room = one hash. Every player writes only its own fields (`g:<slot>`, `s:<slot>` …), and
 * the contested ones are claimed with HSETNX (first solve, slot, start), so concurrent requests
 * never overwrite each other with a read-modify-write of a shared blob.
 *
 * `ttlSec` on a write also (re)sets the key's expiry in the same round trip (Redis pipeline), so
 * a room lives TTL seconds after its last write and no write can leave a key without expiry.
 */
export interface RoomStore {
  readonly kind: 'memory' | 'redis';
  /** Every field of the hash, or null when the key does not exist (or has expired). */
  hgetall(key: string): Promise<Record<string, string> | null>;
  /** Sets the field only when it is absent. true = this call set it. */
  hsetnx(key: string, field: string, value: string, ttlSec?: number): Promise<boolean>;
  hset(key: string, fields: Record<string, string>, ttlSec?: number): Promise<void>;
  hdel(key: string, fields: string[], ttlSec?: number): Promise<void>;
  /** Atomic increment; returns the new value. */
  hincrby(key: string, field: string, by: number, ttlSec?: number): Promise<number>;
}

interface Entry {
  h: Map<string, string>;
  exp: number;
}

/** In-process store with Redis semantics (single-threaded JS makes every method atomic). */
export class MemoryRoomStore implements RoomStore {
  readonly kind = 'memory' as const;
  private readonly data = new Map<string, Entry>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly maxKeys = 5000,
  ) {}

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e && e.exp <= this.clock()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private ensure(key: string): Entry {
    let e = this.live(key);
    if (!e) {
      e = { h: new Map(), exp: Infinity };
      this.data.set(key, e);
      if (this.data.size > this.maxKeys) this.prune();
    }
    return e;
  }

  private touch(e: Entry, ttlSec?: number) {
    if (ttlSec !== undefined) e.exp = this.clock() + ttlSec * 1000;
  }

  private prune() {
    const now = this.clock();
    for (const [k, e] of this.data) if (e.exp <= now) this.data.delete(k);
    // still too many: drop the oldest-inserted (Map keeps insertion order)
    for (const k of this.data.keys()) {
      if (this.data.size <= this.maxKeys) break;
      this.data.delete(k);
    }
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const e = this.live(key);
    if (!e || e.h.size === 0) return null;
    return Object.fromEntries(e.h);
  }

  async hsetnx(key: string, field: string, value: string, ttlSec?: number): Promise<boolean> {
    const e = this.ensure(key);
    const set = !e.h.has(field);
    if (set) e.h.set(field, value);
    this.touch(e, ttlSec);
    return set;
  }

  async hset(key: string, fields: Record<string, string>, ttlSec?: number): Promise<void> {
    const e = this.ensure(key);
    for (const [f, v] of Object.entries(fields)) e.h.set(f, v);
    this.touch(e, ttlSec);
  }

  async hdel(key: string, fields: string[], ttlSec?: number): Promise<void> {
    const e = this.live(key);
    if (!e) return;
    for (const f of fields) e.h.delete(f);
    if (e.h.size === 0) this.data.delete(key);
    else this.touch(e, ttlSec);
  }

  async hincrby(key: string, field: string, by: number, ttlSec?: number): Promise<number> {
    const e = this.ensure(key);
    const cur = Number(e.h.get(field) ?? '0');
    const next = (Number.isFinite(cur) ? cur : 0) + by;
    e.h.set(field, String(next));
    this.touch(e, ttlSec);
    return next;
  }

  /** Tests / admin: number of live keys. */
  size(): number {
    this.prune();
    return this.data.size;
  }
}

/**
 * The process-wide memory store (dev server): survives runtime re-creation when the env
 * signature changes, not a server restart.
 */
let shared: MemoryRoomStore | undefined;
export function sharedMemoryStore(): MemoryRoomStore {
  return (shared ??= new MemoryRoomStore());
}
