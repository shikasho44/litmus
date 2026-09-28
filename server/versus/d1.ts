/**
 * RoomStore over Cloudflare D1 (the Worker deployment, docs/DEPLOY.md §3) — the same Redis-hash
 * semantics as MemoryRoomStore / UpstashRoomStore, in SQL (cloudflare/migrations/0001_init.sql):
 *
 *   vs_keys   (k, exp)       one row per room key; exp = epoch ms, NULL = no expiry
 *   vs_fields (k, f, v)      one row per hash field
 *
 * Atomicity: every write is ONE D1 batch (a transaction on D1's single writer). The contested
 * fields (first solve `win`, a slot `p:<i>`, `start`, `meta`) are claimed with
 * INSERT … ON CONFLICT DO NOTHING RETURNING — exactly one concurrent caller gets the row back,
 * like HSETNX. HINCRBY is an UPSERT … RETURNING. No read-modify-write of a shared blob.
 *
 * Expiry (like Redis EXPIRE): a write with ttlSec sets exp = now + ttl for the whole key. An
 * expired key is invisible to hgetall and is wiped at the start of the next write to it (so a
 * write to an expired key starts a fresh hash, as in Redis). The Worker's cron trigger also
 * deletes every expired key (purgeExpired) so abandoned rooms do not pile up.
 *
 * Failures surface as a retryable 503 `room store unavailable` (details go to the log only).
 */
import { EngineError } from '../engine/errors.js';
import type { D1DatabaseLike, D1PreparedStatementLike, D1Value } from '../cloudflare/d1.js';
import type { RoomStore } from './store.js';

const unavailable = (op: string, e: unknown) => {
  console.error(`[janedoe] versus room store (d1): ${op} failed: ${e instanceof Error ? e.message : String(e)}`);
  return new EngineError('server', 'room store unavailable', 503, true);
};

const SQL = {
  /** Fields of a live key (an expired key reads as absent). ?1 key, ?2 now */
  getAll: `SELECT f, v FROM vs_fields WHERE k = ?1
             AND NOT EXISTS (SELECT 1 FROM vs_keys WHERE k = ?1 AND exp IS NOT NULL AND exp <= ?2)`,
  /** Lazy expiry before a write: drop an expired key's fields, then the key. ?1 key, ?2 now */
  dropExpiredFields: `DELETE FROM vs_fields WHERE k = ?1
                        AND EXISTS (SELECT 1 FROM vs_keys WHERE k = ?1 AND exp IS NOT NULL AND exp <= ?2)`,
  dropExpiredKey: `DELETE FROM vs_keys WHERE k = ?1 AND exp IS NOT NULL AND exp <= ?2`,
  /** (Re)set the key's expiry (EXPIRE), creating the key row. ?1 key, ?2 exp */
  touch: `INSERT INTO vs_keys (k, exp) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET exp = excluded.exp`,
  /** Make sure the key row exists without touching an existing expiry (write without ttl). ?1 key */
  ensureKey: `INSERT INTO vs_keys (k, exp) VALUES (?1, NULL) ON CONFLICT (k) DO NOTHING`,
  /** Expire an existing key only (HDEL + EXPIRE never creates a key). ?1 key, ?2 exp */
  touchExisting: `UPDATE vs_keys SET exp = ?2 WHERE k = ?1`,
  /** HSETNX. ?1 key, ?2 field, ?3 value → one row when this call set it */
  setNx: `INSERT INTO vs_fields (k, f, v) VALUES (?1, ?2, ?3) ON CONFLICT (k, f) DO NOTHING RETURNING 1 AS ok`,
  /** HSET (one field). ?1 key, ?2 field, ?3 value */
  set: `INSERT INTO vs_fields (k, f, v) VALUES (?1, ?2, ?3) ON CONFLICT (k, f) DO UPDATE SET v = excluded.v`,
  /** HDEL (one field). ?1 key, ?2 field */
  del: `DELETE FROM vs_fields WHERE k = ?1 AND f = ?2`,
  /** An emptied hash disappears (Redis deletes a hash with no fields). ?1 key */
  dropIfEmpty: `DELETE FROM vs_keys WHERE k = ?1 AND NOT EXISTS (SELECT 1 FROM vs_fields WHERE k = ?1)`,
  /**
   * HINCRBY → the new value. Values are stored as TEXT like Redis strings; both sides are cast
   * to INTEGER so a number bound as REAL can never turn "2" into "2.0". A non-numeric value
   * counts as 0 (as in MemoryRoomStore). ?1 key, ?2 field, ?3 delta
   */
  incr: `INSERT INTO vs_fields (k, f, v) VALUES (?1, ?2, CAST(CAST(?3 AS INTEGER) AS TEXT))
           ON CONFLICT (k, f) DO UPDATE SET v = CAST(CAST(vs_fields.v AS INTEGER) + CAST(?3 AS INTEGER) AS TEXT)
           RETURNING v`,
  /** Cron: every expired key and its fields. ?1 now */
  purgeFields: `DELETE FROM vs_fields WHERE k IN (SELECT k FROM vs_keys WHERE exp IS NOT NULL AND exp <= ?1)`,
  purgeKeys: `DELETE FROM vs_keys WHERE exp IS NOT NULL AND exp <= ?1`,
} as const;

export class D1RoomStore implements RoomStore {
  readonly kind = 'd1' as const;

  constructor(
    private readonly db: D1DatabaseLike,
    private readonly clock: () => number = Date.now,
  ) {}

  private st(sql: string, ...values: D1Value[]): D1PreparedStatementLike {
    return this.db.prepare(sql).bind(...values);
  }

  /**
   * One write = one transaction: [lazy expiry, …ops, expiry]. Returns the rows of `ops`
   * (index-aligned with the ops passed in).
   */
  private async write(op: string, key: string, ops: D1PreparedStatementLike[], ttlSec: number | undefined, mode: 'upsert' | 'existing' = 'upsert'): Promise<Record<string, unknown>[][]> {
    const now = this.clock();
    const stmts = [this.st(SQL.dropExpiredFields, key, now), this.st(SQL.dropExpiredKey, key, now), ...ops];
    if (mode === 'upsert') stmts.push(ttlSec === undefined ? this.st(SQL.ensureKey, key) : this.st(SQL.touch, key, now + Math.max(1, Math.round(ttlSec)) * 1000));
    else {
      stmts.push(this.st(SQL.dropIfEmpty, key));
      if (ttlSec !== undefined) stmts.push(this.st(SQL.touchExisting, key, now + Math.max(1, Math.round(ttlSec)) * 1000));
    }
    let res;
    try {
      res = await this.db.batch(stmts);
    } catch (e) {
      throw unavailable(op, e);
    }
    return res.slice(2, 2 + ops.length).map((r) => (r?.results ?? []) as Record<string, unknown>[]);
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    let rows: { f: string; v: string }[];
    try {
      rows = (await this.st(SQL.getAll, key, this.clock()).all<{ f: string; v: string }>()).results ?? [];
    } catch (e) {
      throw unavailable('HGETALL', e);
    }
    if (rows.length === 0) return null;
    const out: Record<string, string> = {};
    for (const r of rows) out[String(r.f)] = String(r.v);
    return out;
  }

  async hsetnx(key: string, field: string, value: string, ttlSec?: number): Promise<boolean> {
    const [rows] = await this.write('HSETNX', key, [this.st(SQL.setNx, key, field, value)], ttlSec);
    return rows.length === 1;
  }

  async hset(key: string, fields: Record<string, string>, ttlSec?: number): Promise<void> {
    const entries = Object.entries(fields);
    if (entries.length === 0) return;
    await this.write('HSET', key, entries.map(([f, v]) => this.st(SQL.set, key, f, String(v))), ttlSec);
  }

  async hdel(key: string, fields: string[], ttlSec?: number): Promise<void> {
    if (fields.length === 0) return;
    await this.write('HDEL', key, fields.map((f) => this.st(SQL.del, key, f)), ttlSec, 'existing');
  }

  async hincrby(key: string, field: string, by: number, ttlSec?: number): Promise<number> {
    const [rows] = await this.write('HINCRBY', key, [this.st(SQL.incr, key, field, Math.trunc(by))], ttlSec);
    return Number(rows[0]?.v ?? NaN);
  }

  /** Cron trigger: deletes every expired room. Returns the number of keys removed. */
  async purgeExpired(now = this.clock()): Promise<number> {
    try {
      const res = await this.db.batch([this.st(SQL.purgeFields, now), this.st(SQL.purgeKeys, now)]);
      return Number(res[1]?.meta?.changes ?? 0);
    } catch (e) {
      throw unavailable('purge', e);
    }
  }
}
