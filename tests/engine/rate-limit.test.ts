import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../server/http/rate-limit';
import { BudgetGuard } from '../../server/engine/budget';

describe('rate limiter', () => {
  it('enforces every window of a bucket independently per key', () => {
    let now = 0;
    const rl = new RateLimiter({ ask: [{ limit: 3, windowMs: 1000 }, { limit: 5, windowMs: 10_000 }] }, () => now);
    for (let i = 0; i < 3; i++) expect(rl.check('ask', 'a').ok).toBe(true);
    const r = rl.check('ask', 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limit).toBe(3);
      expect(r.retryAfterMs).toBeGreaterThanOrEqual(1000);
    }
    expect(rl.check('ask', 'b').ok).toBe(true); // other key
    now = 1500; // short window slides
    expect(rl.check('ask', 'a').ok).toBe(true);
    expect(rl.check('ask', 'a').ok).toBe(true);
    const day = rl.check('ask', 'a'); // 5 in 10 s
    expect(day.ok).toBe(false);
    if (!day.ok) expect(day.limit).toBe(5);
    now = 20_000;
    expect(rl.check('ask', 'a').ok).toBe(true);
    expect(rl.check('unknown-bucket', 'a').ok).toBe(true);
  });

  it('prunes idle keys', () => {
    let now = 0;
    const rl = new RateLimiter({ w: [{ limit: 1, windowMs: 60_000 }] }, () => now, 10);
    for (let i = 0; i < 10; i++) rl.check('w', `ip${i}`);
    now = 120_000;
    rl.check('w', 'fresh');
    expect(rl.size()).toBeLessThanOrEqual(2);
  });
});

describe('rate limiter peek', () => {
  it('reports the verdict without recording a hit', () => {
    let now = 0;
    const rl = new RateLimiter({ f: [{ limit: 2, windowMs: 60_000 }] }, () => now);
    expect(rl.peek('f', 'ip').ok).toBe(true);
    expect(rl.peek('f', 'ip').ok).toBe(true);
    rl.check('f', 'ip');
    rl.check('f', 'ip');
    expect(rl.peek('f', 'ip').ok).toBe(false);
    now = 61_000;
    expect(rl.peek('f', 'ip').ok).toBe(true);
  });
});

describe('budget guard', () => {
  it('trips at the limit and resets daily', () => {
    let now = Date.UTC(2026, 8, 24, 12);
    const b = new BudgetGuard(0.01, () => now);
    b.add(0.004);
    expect(b.exceeded()).toBe(false);
    b.add(0.006);
    expect(b.exceeded()).toBe(true);
    now += 24 * 3600 * 1000;
    expect(b.exceeded()).toBe(false);
    expect(new BudgetGuard(0).exceeded()).toBe(true); // 0 → never spend
    expect(new BudgetGuard(-1).exceeded()).toBe(false); // negative → unlimited
  });
});
