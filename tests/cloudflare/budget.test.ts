/**
 * Daily spend shared across instances (BudgetGuard + D1BudgetStore on node:sqlite): two Worker
 * isolates each under the limit alone, over it together; throttled refresh; outages fall back to
 * the local count; the day rolls over at UTC midnight.
 */
import { describe, expect, it, vi } from 'vitest';
import { BudgetGuard } from '../../server/engine/budget';
import { D1BudgetStore } from '../../server/cloudflare/budget-d1';
import { SqliteD1 } from './sqlite-d1';

function setup(limit = 0.01) {
  let now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const clock = () => now;
  const db = new SqliteD1();
  const store = new D1BudgetStore(db, clock);
  const a = new BudgetGuard(limit, clock, store);
  const b = new BudgetGuard(limit, clock, store);
  return { db, store, a, b, clock, advance: (ms: number) => (now += ms) };
}

describe('shared daily budget (D1)', () => {
  it('sums every instance: each alone is under the limit, together they are over it', async () => {
    const t = setup(0.01);
    t.a.add(0.006);
    await t.a.flush();
    t.b.add(0.003);
    expect(t.b.exceeded()).toBe(false); // b has not read the shared total yet
    await t.b.refresh();
    expect(t.b.exceeded()).toBe(false); // 0.006 + 0.003
    t.b.add(0.002);
    expect(t.b.exceeded()).toBe(true); // 0.006 (read) + 0.005 (b's unsent)
    await t.b.flush();
    expect(await t.store.get('2026-09-28')).toEqual({ spentUsd: expect.closeTo(0.011, 9), calls: 3 });
    await t.a.refresh();
    expect(t.a.exceeded()).toBe(true);
    expect(t.a.status()).toMatchObject({ day: '2026-09-28', spentUsd: 0.011, calls: 3, exceeded: true, shared: { unsentUsd: 0 } });
  });

  it('refresh is throttled per instance; flush is a no-op when nothing is unsent', async () => {
    const t = setup();
    const c0 = t.db.calls;
    await t.a.refresh(15_000);
    await t.a.refresh(15_000);
    expect(t.db.calls - c0).toBe(1);
    t.advance(15_000);
    await t.a.refresh(15_000);
    expect(t.db.calls - c0).toBe(2);
    await t.a.flush();
    expect(t.db.calls - c0).toBe(2);
    expect(t.a.unsent).toBe(0);
  });

  it('a store outage keeps the local count and retries the unsent spend later', async () => {
    const t = setup(0.01);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    t.a.add(0.004);
    t.db.failNext();
    await t.a.flush(); // never throws
    expect(t.a.unsent).toBeCloseTo(0.004, 9);
    t.db.failNext();
    await t.a.refresh(); // never throws
    t.a.add(0.007);
    expect(t.a.exceeded()).toBe(true); // local spend alone
    await t.a.flush();
    expect(t.a.unsent).toBe(0);
    expect((await t.store.get('2026-09-28')).spentUsd).toBeCloseTo(0.011, 9);
    expect(warn).toHaveBeenCalledTimes(1); // warned once, not per failure
    warn.mockRestore();
  });

  it('rolls over at UTC midnight and prunes old days', async () => {
    const t = setup(0.01);
    t.a.add(0.02);
    await t.a.flush();
    expect(t.a.exceeded()).toBe(true);
    t.advance(12 * 3600_000); // 2026-09-29 00:00 UTC
    expect(t.a.exceeded()).toBe(false);
    await t.a.refresh();
    expect(t.a.exceeded()).toBe(false);
    t.advance(70 * 86_400_000);
    await t.store.prune();
    expect(t.db.rows('budget_daily')).toEqual([]);
  });

  it('without a store the guard is the old per-instance counter', () => {
    const g = new BudgetGuard(0.01);
    g.add(0.02);
    expect(g.exceeded()).toBe(true);
    expect(g.unsent).toBe(0);
    expect(g.status().shared).toBeUndefined();
  });
});
