/**
 * Daily spend guard (in memory, per server instance). When the estimated spend for the
 * current UTC day exceeds DAILY_COST_LIMIT_USD, the pipeline forces 'rules' mode.
 * Serverless instances each keep their own counter, so the limit is approximate by design;
 * provider-side limits (OpenRouter key limits) remain the hard stop.
 */
export class BudgetGuard {
  private day = '';
  private spent = 0;
  private calls = 0;

  constructor(readonly limitUsd: number, private readonly clock: () => number = Date.now) {}

  private roll(): void {
    const d = new Date(this.clock()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.spent = 0;
      this.calls = 0;
    }
  }

  add(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    this.roll();
    this.spent += costUsd;
    this.calls++;
  }

  exceeded(): boolean {
    // Negative / NaN → unlimited. 0 → never spend (always rules).
    if (!Number.isFinite(this.limitUsd) || this.limitUsd < 0) return false;
    this.roll();
    return this.spent >= this.limitUsd;
  }

  status(): { day: string; spentUsd: number; limitUsd: number; calls: number; exceeded: boolean } {
    this.roll();
    return { day: this.day, spentUsd: Math.round(this.spent * 1e6) / 1e6, limitUsd: this.limitUsd, calls: this.calls, exceeded: this.exceeded() };
  }
}
