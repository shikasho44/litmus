/**
 * RoomStore contract: the D1 store (server/versus/d1.ts, real SQL on node:sqlite) behaves like
 * the memory store (Redis-hash semantics) — HSETNX / HSET / HDEL / HINCRBY, per-key expiry,
 * lazy expiry on write, first-writer-wins under concurrency — plus D1-only purge and outages.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api';
import { MemoryRoomStore, type RoomStore } from '../../server/versus/store';
import { D1RoomStore } from '../../server/versus/d1';
import { SqliteD1 } from './sqlite-d1';

type Made = { store: RoomStore; advance: (ms: number) => void; db?: SqliteD1 };

const makers: [string, () => Made][] = [
  [
    'memory',
    () => {
      let now = 1_800_000_000_000;
      return { store: new MemoryRoomStore(() => now), advance: (ms) => (now += ms) };
    },
  ],
  [
    'd1',
    () => {
      let now = 1_800_000_000_000;
      const db = new SqliteD1();
      return { store: new D1RoomStore(db, () => now), advance: (ms) => (now += ms), db };
    },
  ],
];

describe.each(makers)('RoomStore contract (%s)', (_name, make) => {
  it('HGETALL of a missing key is null', async () => {
    const { store } = make();
    expect(await store.hgetall('jd:vs:NONE')).toBeNull();
  });

  it('HSETNX sets once; HSET overwrites; values are strings', async () => {
    const { store } = make();
    expect(await store.hsetnx('k', 'meta', '{"a":1}', 60)).toBe(true);
    expect(await store.hsetnx('k', 'meta', '{"a":2}', 60)).toBe(false);
    await store.hset('k', { 'p:0': 'x', 's:0': '17' }, 60);
    await store.hset('k', { 's:0': '18' }, 60);
    expect(await store.hgetall('k')).toEqual({ meta: '{"a":1}', 'p:0': 'x', 's:0': '18' });
  });

  it('HINCRBY counts from zero and keeps integer strings', async () => {
    const { store } = make();
    expect(await store.hincrby('k', 'a:0', 1, 60)).toBe(1);
    expect(await store.hincrby('k', 'a:0', 1, 60)).toBe(2);
    expect(await store.hincrby('k', 'a:0', 3, 60)).toBe(5);
    expect(await store.hincrby('k', 'k:1', -2, 60)).toBe(-2);
    const all = await store.hgetall('k');
    expect(all).toEqual({ 'a:0': '5', 'k:1': '-2' });
    // a non-numeric value counts as 0
    await store.hset('k', { junk: 'abc' }, 60);
    expect(await store.hincrby('k', 'junk', 2, 60)).toBe(2);
  });

  it('HDEL removes fields; an emptied hash disappears; a missing key is a no-op', async () => {
    const { store } = make();
    await store.hdel('missing', ['a'], 60);
    expect(await store.hgetall('missing')).toBeNull();
    await store.hset('k', { a: '1', b: '2' }, 60);
    await store.hdel('k', ['a'], 60);
    expect(await store.hgetall('k')).toEqual({ b: '2' });
    await store.hdel('k', ['b', 'zzz'], 60);
    expect(await store.hgetall('k')).toBeNull();
    // the key really is gone: HSETNX of a previously set field works again
    expect(await store.hsetnx('k', 'a', 'again', 60)).toBe(true);
  });

  it('keys expire TTL seconds after the last write; a write after expiry starts a fresh hash', async () => {
    const { store, advance } = make();
    await store.hset('k', { a: '1' }, 10);
    advance(9_000);
    await store.hset('k', { b: '2' }, 10); // refreshes the whole key
    advance(9_000);
    expect(await store.hgetall('k')).toEqual({ a: '1', b: '2' });
    advance(1_001);
    expect(await store.hgetall('k')).toBeNull();
    // an expired key is gone: old fields do not come back and HSETNX succeeds
    expect(await store.hsetnx('k', 'a', 'new', 10)).toBe(true);
    expect(await store.hgetall('k')).toEqual({ a: 'new' });
    // an expired counter restarts at zero
    await store.hincrby('c', 'n', 5, 10);
    advance(10_001);
    expect(await store.hincrby('c', 'n', 1, 10)).toBe(1);
  });

  it('HDEL with a TTL refreshes an existing key only', async () => {
    const { store, advance } = make();
    await store.hset('k', { a: '1', b: '2' }, 10);
    advance(9_000);
    await store.hdel('k', ['a'], 10);
    advance(9_000);
    expect(await store.hgetall('k')).toEqual({ b: '2' });
    await store.hdel('nokey', ['x'], 10);
    expect(await store.hgetall('nokey')).toBeNull();
  });

  it('first writer wins: one of many concurrent HSETNX gets the field', async () => {
    const { store } = make();
    const res = await Promise.all(Array.from({ length: 12 }, (_, i) => store.hsetnx('room', 'win', `p${i}`, 60)));
    expect(res.filter(Boolean)).toHaveLength(1);
    const winner = res.indexOf(true);
    expect((await store.hgetall('room'))?.win).toBe(`p${winner}`);
    // concurrent increments are not lost
    await Promise.all(Array.from({ length: 10 }, () => store.hincrby('room', 'a:0', 1, 60)));
    expect((await store.hgetall('room'))?.['a:0']).toBe('10');
  });
});

describe('D1RoomStore specifics', () => {
  it('purgeExpired deletes expired keys and their fields, nothing else', async () => {
    let now = 1_800_000_000_000;
    const db = new SqliteD1();
    const store = new D1RoomStore(db, () => now);
    await store.hset('old', { a: '1', b: '2' }, 10);
    await store.hset('live', { a: '1' }, 100);
    now += 11_000;
    expect(await store.purgeExpired()).toBe(1);
    expect(db.rows('vs_keys').map((r) => r.k)).toEqual(['live']);
    expect(db.rows('vs_fields').map((r) => r.k)).toEqual(['live']);
    expect(await store.hgetall('live')).toEqual({ a: '1' });
  });

  it('every write is one round trip (one D1 batch) and every key has an expiry', async () => {
    const db = new SqliteD1();
    const store = new D1RoomStore(db);
    const before = db.calls;
    await store.hset('k', { a: '1', b: '2', c: '3' }, 60);
    await store.hsetnx('k', 'd', '4', 60);
    await store.hincrby('k', 'e', 1, 60);
    await store.hdel('k', ['a', 'b'], 60);
    expect(db.calls - before).toBe(4);
    expect(db.rows('vs_keys').every((r) => typeof r.exp === 'number' && (r.exp as number) > Date.now())).toBe(true);
  });

  it('an outage is a retryable 503 "room store unavailable"', async () => {
    const db = new SqliteD1();
    const store = new D1RoomStore(db);
    for (const call of [() => store.hgetall('k'), () => store.hsetnx('k', 'f', 'v', 60), () => store.hincrby('k', 'f', 1, 60)]) {
      db.failNext();
      const e = await call().then(
        () => null,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ code: 'server', message: 'room store unavailable', retryable: true, status: 503 });
    }
    // after the outage the store works again
    expect(await store.hsetnx('k', 'f', 'v', 60)).toBe(true);
  });
});
