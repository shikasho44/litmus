/**
 * BudgetStore on D1 (table budget_daily, cloudflare/migrations/0001_init.sql): the day's
 * estimated AI spend summed over every Worker isolate, so DAILY_COST_LIMIT_USD is one limit for
 * the whole deployment instead of one per isolate (server/engine/budget.ts).
 */
import type { BudgetStore } from '../engine/budget.js';
import type { D1DatabaseLike } from './d1.js';

const ADD = `INSERT INTO budget_daily (day, spent_usd, calls, updated_at) VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT (day) DO UPDATE SET spent_usd = budget_daily.spent_usd + excluded.spent_usd,
                                               calls = budget_daily.calls + excluded.calls,
                                               updated_at = excluded.updated_at
               RETURNING spent_usd, calls`;
const GET = `SELECT spent_usd, calls FROM budget_daily WHERE day = ?1`;
/** Cron: keep ~2 months of daily totals (they are tiny, but not needed forever). ?1 oldest day kept */
const PRUNE = `DELETE FROM budget_daily WHERE day < ?1`;

type Row = { spent_usd: number; calls: number };

export class D1BudgetStore implements BudgetStore {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly clock: () => number = Date.now,
  ) {}

  async add(day: string, usd: number, calls: number): Promise<{ spentUsd: number; calls: number }> {
    const r = await this.db.prepare(ADD).bind(day, usd, Math.trunc(calls), this.clock()).all<Row>();
    const row = r.results?.[0];
    return { spentUsd: Number(row?.spent_usd ?? usd), calls: Number(row?.calls ?? calls) };
  }

  async get(day: string): Promise<{ spentUsd: number; calls: number }> {
    const row = await this.db.prepare(GET).bind(day).first<Row>();
    return { spentUsd: Number(row?.spent_usd ?? 0), calls: Number(row?.calls ?? 0) };
  }

  async prune(keepDays = 62): Promise<void> {
    const oldest = new Date(this.clock() - keepDays * 86_400_000).toISOString().slice(0, 10);
    await this.db.prepare(PRUNE).bind(oldest).run();
  }
}
