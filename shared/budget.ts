/**
 * 質問枠 (question budget) and Holma's free nudges — design bible §3-1b, docs/decisions.md
 * 2026-09-28. Shared by the server (counting, the hard limit of room-bound versus runs) and the
 * browser (counter, warnings, nudges, rank).
 *
 * EVERY NUMBER TO TUNE LIVES IN `BUDGET_TUNING` BELOW. Plain constants and pure functions only
 * (no zod, no Node, no signals): the game client imports this file as values.
 *
 *   par(case difficulty d)  = parBase + parPerLevel × d          → 22 / 30 / 38 (the old rank par)
 *   budget(d, play)         = round(par × factor[play])            (a case may override: questionBudget)
 *     見習い easy    guide  ×1.3 → 29 / 39 / 49  no limit, no cost — a counter and gentle words
 *     審問官 normal  soft   ×1.0 → 22 / 30 / 38  beyond it every counted question costs 1.5 事件スコア
 *     教授   hard    hard   ×0.8 → 18 / 24 / 30  when it runs out the investigation closes
 *   2026-09-29 (owner: "I could never use them up, especially on 教授"): the factors were
 *   1.6 / 1.3 / 1.1, and every published case now sets its own questionBudget (content/cases).
 *   A provisional first pass — to be tuned from play.
 *
 * What counts ("charged"): a question part answered はい / いいえ / 一部そう / 関係ない that is
 * not small talk (the engine's meta kinds). 「具体的に」「答えられない」, hint / how-to / answer
 * requests, small talk, the culprit seal and the safety filter are free — none of them can ever
 * unlock a finding. `asked` (ProgressSnapshot.asked) keeps counting every part as before.
 */
import type { AnswerClass } from './constants';
import type { Difficulty } from './api';

export type BudgetKind = 'guide' | 'soft' | 'hard';

export interface BudgetRule {
  kind: BudgetKind;
  /** budget = round(par × factor). */
  factor: number;
  /** 事件スコア points per counted question beyond the budget (0 = free). */
  overCost: number;
  /** Cap of that penalty. */
  overCap: number;
  /** Free Holma nudges per run. */
  nudges: number;
  /** Which moments may carry one: a run of questions without a new finding / the budget running low. */
  nudgeOn: { stuck: boolean; low: boolean };
}

export const BUDGET_TUNING = {
  /** par = parBase + parPerLevel × case difficulty (1..3). Same as the rank's par before 2026-09-28. */
  parBase: 14,
  parPerLevel: 8,
  rules: {
    easy: { kind: 'guide', factor: 1.3, overCost: 0, overCap: 0, nudges: 4, nudgeOn: { stuck: true, low: true } },
    normal: { kind: 'soft', factor: 1.0, overCost: 1.5, overCap: 24, nudges: 3, nudgeOn: { stuck: true, low: true } },
    hard: { kind: 'hard', factor: 0.8, overCost: 1.5, overCap: 24, nudges: 1, nudgeOn: { stuck: false, low: true } },
  } satisfies Record<Difficulty, BudgetRule>,
  /** 'low' once at most this share of the budget is left (and at least 1 question). */
  lowShare: 0.25,
  /** No budget is smaller than this (a tiny per-case override is clamped). */
  minBudget: 3,
  nudge: {
    /** Answers in a row without a new finding (or hint / nudge) before Holma mutters. */
    stuck: 6,
    /** At least this many answers between two nudges. */
    gap: 5,
    /** From this shard progress on, a stuck player is told the inquest may be ready. */
    readyProgress: 0.6,
  },
  /** Normal mode, beyond the budget: Holma remarks on the 1st over-budget question and every Nth after. */
  overRemarkEvery: 5,
} as const;

/** Per-case override (shared/case-schema.ts `questionBudget`): exact budgets per play difficulty. */
export type CaseBudgetOverride = Partial<Record<Difficulty, number>>;

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const isDiff = (v: unknown): v is Difficulty => DIFFS.includes(v as Difficulty);
const clampD = (d: number) => Math.min(3, Math.max(1, Math.round(Number.isFinite(d) ? d : 1) || 1));

/** Question par of a case difficulty (1..3). */
export function casePar(caseDifficulty: number): number {
  return BUDGET_TUNING.parBase + BUDGET_TUNING.parPerLevel * clampD(caseDifficulty);
}

export function budgetRule(play: Difficulty | undefined): BudgetRule {
  return BUDGET_TUNING.rules[isDiff(play) ? play : 'normal'];
}

/** The number of counted questions a run of this case at this play difficulty gets. */
export function questionBudget(caseDifficulty: number, play: Difficulty | undefined, override?: CaseBudgetOverride | null): number {
  const d = isDiff(play) ? play : 'normal';
  const o = override?.[d];
  const raw = typeof o === 'number' && Number.isFinite(o) && o > 0 ? Math.round(o) : Math.round(casePar(caseDifficulty) * BUDGET_TUNING.rules[d].factor);
  return Math.max(BUDGET_TUNING.minBudget, raw);
}

/** Answer classes that can count against the budget (and the only ones that can unlock a finding). */
export const CHARGED_CLASSES: readonly AnswerClass[] = ['yes', 'no', 'partial', 'irrelevant'];

/** Does an answered part count? `meta` = the engine's meta kind (small talk, hint request, …). */
export function isCharged(answerClass: AnswerClass, meta?: string | null): boolean {
  return !meta && CHARGED_CLASSES.includes(answerClass);
}

export type BudgetState = 'ok' | 'low' | 'zero' | 'over' | 'closed';

export interface BudgetView {
  kind: BudgetKind;
  play: Difficulty;
  budget: number;
  spent: number;
  /** max(0, budget − spent) */
  left: number;
  /** max(0, spent − budget) */
  over: number;
  /**
   * ok · low (≤ lowShare left) · zero (exactly used up, soft/guide) · over (beyond, soft/guide)
   * · closed (hard budget used up: no more questions).
   */
  state: BudgetState;
  rule: BudgetRule;
}

export function lowThreshold(budget: number): number {
  return Math.max(1, Math.ceil(budget * BUDGET_TUNING.lowShare));
}

export function budgetView(spent: number, budget: number, play: Difficulty | undefined): BudgetView {
  const rule = budgetRule(play);
  const s = Math.max(0, Math.floor(Number.isFinite(spent) ? spent : 0));
  const b = Math.max(1, Math.floor(budget));
  const left = Math.max(0, b - s);
  const over = Math.max(0, s - b);
  const state: BudgetState =
    left === 0 ? (rule.kind === 'hard' ? 'closed' : over > 0 ? 'over' : 'zero') : left <= lowThreshold(b) ? 'low' : 'ok';
  return { kind: rule.kind, play: isDiff(play) ? play : 'normal', budget: b, spent: s, left, over, state, rule };
}

/** The 事件スコア points a run loses for `spent` counted questions against `budget` (rounded to 0.1). */
export function overBudgetPoints(spent: number, budget: number, overCost: number, overCap: number): number {
  const over = Math.max(0, (Number.isFinite(spent) ? spent : 0) - budget);
  return Math.round(Math.min(overCap, over * overCost) * 10) / 10;
}
