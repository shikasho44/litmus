/**
 * The whole online-versus service suite (tests/versus/service.test.ts) again, with every room
 * in the D1 store (server/versus/d1.ts on node:sqlite) instead of memory: room lifecycle, expiry,
 * token binding, the atomic first solve, elimination — same expectations, other store.
 */
import { expect, it, vi } from 'vitest';
import { MemoryRoomStore } from '../../server/versus/store';

vi.mock('../../server/versus/store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../server/versus/store')>();
  const { D1RoomStore } = await import('../../server/versus/d1');
  const { SqliteD1 } = await import('./sqlite-d1');
  /** Stands in for `new MemoryRoomStore(clock)` in the shared suite. */
  class D1BackedStore extends D1RoomStore {
    constructor(clock?: () => number) {
      super(new SqliteD1(), clock);
    }
  }
  return { ...orig, MemoryRoomStore: D1BackedStore };
});

it('the shared suite below really runs on D1', () => {
  expect(new MemoryRoomStore().kind).toBe('d1');
});

await import('../versus/service.test');
