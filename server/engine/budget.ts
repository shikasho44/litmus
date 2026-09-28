/**
 * Daily spend guard. When the estimated spend for the current UTC day exceeds
 * DAILY_COST_LIMIT_USD, the pipeline forces 'rules' mode.
 *
 * By default the counter lives in memory, per server instance: serverless instances each keep
 * their own, so the limit is approximate by design; provider-side limits (OpenRouter key
 * limits) remain the hard stop.
 *
 * With a shared `BudgetStore` (the Cloudflare Worker: D1, server/cloudflare/budget-d1.ts) the
 * guard also knows what every other instance spent: `flush()` adds this instance's unsent spend
 * to the store (after the response, ctx.waitUntil) and `refresh()` reads the day's total (before
 * spending requests, throttled). `exceeded()` stays synchronous and uses the best known total:
 *   max(this instance's own spend, last read total + spend not yet sent).
 * The store is advisory: when it fails, the guard keeps working on its local numbers.
 */
export interface BudgetStore {
  /** Adds spend for a UTC day; returns the day's new total (all instances). */
  add(day: string, usd: number, calls: number): Promise<{ spentUsd: number; calls: number }>;
  /** The day's total so far (all instances). */
  get(day: string): Promise<{ spentUsd: number; calls: number }>;
}

export class BudgetGuard {
  private day = '';
  private spent = 0;
  private calls = 0;
  /** Day total as last read from / returned by the shared store (includes our flushed spend). */
  private shared = 0;
  private sharedCalls = 0;
  /** Spend added here and not yet sent to the store. */
  private pending = 0;
  private pendingCalls = 0;
  private refreshedAt = -Infinity;
  private warned = false;

  constructor(
    readonly limitUsd: number,
    private readonly clock: () => number = Date.now,
    private readonly store?: BudgetStore,
  ) {}

  private roll(): void {
    const d = new Date(this.clock()).toISOString().slice(0, 10);
    if (d !== this.day) {
      // A few unsent cents at UTC midnight are dropped with the old day (accepted).
      this.day = d;
      this.spent = 0;
      this.calls = 0;
      this.shared = 0;
      this.sharedCalls = 0;
      this.pending = 0;
      this.pendingCalls = 0;
      this.refreshedAt = -Infinity;
    }
  }

  private effective(): number {
    return Math.max(this.spent, this.shared + this.pending);
  }

  add(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    this.roll();
    this.spent += costUsd;
    this.calls++;
    if (this.store) {
      this.pending += costUsd;
      this.pendingCalls++;
    }
  }

  exceeded(): boolean {
    // Negative / NaN → unlimited. 0 → never spend (always rules).
    if (!Number.isFinite(this.limitUsd) || this.limitUsd < 0) return false;
    this.roll();
    return this.effective() >= this.limitUsd;
  }

  /** Spend not yet sent to the shared store (0 without a store). */
  get unsent(): number {
    return this.pending;
  }

  private storeFailed(op: string, e: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[janedoe] shared budget store: ${op} failed (${e instanceof Error ? e.message : String(e)}) — using this instance's count`);
  }

  /** Reads the day's shared total, at most once per `maxAgeMs`. Never throws. */
  async refresh(maxAgeMs = 0): Promise<void> {
    if (!this.store) return;
    this.roll();
    const now = this.clock();
    if (now - this.refreshedAt < maxAgeMs) return;
    this.refreshedAt = now;
    const day = this.day;
    try {
      const r = await this.store.get(day);
      if (day !== this.day) return;
      this.shared = Math.max(this.shared, r.spentUsd);
      this.sharedCalls = Math.max(this.sharedCalls, r.calls);
    } catch (e) {
      this.storeFailed('read', e);
    }
  }

  /** Sends the unsent spend to the shared store (call after the response). Never throws. */
  async flush(): Promise<void> {
    if (!this.store) return;
    this.roll();
    if (this.pending <= 0) return;
    const day = this.day;
    const usd = this.pending;
    const calls = this.pendingCalls;
    this.pending = 0;
    this.pendingCalls = 0;
    try {
      const r = await this.store.add(day, usd, calls);
      if (day !== this.day) return;
      this.shared = Math.max(this.shared, r.spentUsd);
      this.sharedCalls = Math.max(this.sharedCalls, r.calls);
    } catch (e) {
      if (day === this.day) {
        this.pending += usd;
        this.pendingCalls += calls;
      }
      this.storeFailed('write', e);
    }
  }

  status(): { day: string; spentUsd: number; limitUsd: number; calls: number; exceeded: boolean; shared?: { spentUsd: number; calls: number; unsentUsd: number } } {
    this.roll();
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    return {
      day: this.day,
      spentUsd: round(this.effective()),
      limitUsd: this.limitUsd,
      calls: this.store ? Math.max(this.calls, this.sharedCalls + this.pendingCalls) : this.calls,
      exceeded: this.exceeded(),
      ...(this.store ? { shared: { spentUsd: round(this.shared), calls: this.sharedCalls, unsentUsd: round(this.pending) } } : {}),
    };
  }
}
