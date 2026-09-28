/**
 * 質問枠 in the browser (design bible §3-1b): the counter's view of a case run, and what Holma
 * says unasked after a turn — remarks on the budget and the free nudges ("ひとりごと") a human
 * game master would drop at the right moment. Pure (no signals, no DOM): unit-tested.
 *
 * The numbers live in shared/budget.ts (BUDGET_TUNING). The server counts (ProgressSnapshot.spent);
 * this file only reads the snapshot.
 *
 * Nudges (free, never an answer, never the same text twice in a run, at most rule.nudges per run):
 *   stuck — `nudge.stuck` answers in a row without a new finding (nor a whisper / nudge since)
 *   low   — the budget has just dropped to its last quarter (merged into Holma's budget remark)
 *   ready — a stuck player whose shards are ≥ readyProgress lit is told the inquest may be ready
 * Sources, in order: the case's `nudges` (authored), the starter questions not asked yet (as
 * 「たとえば『…』」), then the case's idle lines that do not assume the player is idle.
 */
import type { CaseSummary, Difficulty, HolmaMood, ProgressSnapshot } from '../../../shared/api';
import { BUDGET_TUNING, budgetView, overBudgetPoints, questionBudget, type BudgetView } from '../../../shared/budget';
import type { CaseProgress, LogEntry, NudgeReason } from '../../state/types';

export type { BudgetView } from '../../../shared/budget';

/** Counted questions of a snapshot (older snapshots without `spent` count every question). */
export function spentOf(snap: Pick<ProgressSnapshot, 'asked' | 'spent'> | undefined): number {
  if (!snap) return 0;
  const asked = Number.isFinite(snap.asked) ? snap.asked : 0;
  return typeof snap.spent === 'number' && Number.isFinite(snap.spent) ? Math.min(asked, snap.spent) : asked;
}

type BudgetCase = Pick<CaseSummary, 'difficulty' | 'questionBudget'>;

export function budgetFor(c: BudgetCase, play: Difficulty | undefined, spent: number): BudgetView {
  return budgetView(spent, questionBudget(c.difficulty, play, c.questionBudget), play);
}

/** The budget view of a case run (null until the case data is known). */
export function caseBudget(c: BudgetCase | undefined | null, p: Pick<CaseProgress, 'difficulty' | 'snapshot'> | undefined): BudgetView | null {
  if (!c) return null;
  return budgetFor(c, p?.difficulty ?? 'normal', spentOf(p?.snapshot));
}

/** 事件スコア points the questions of this turn cost (normal mode beyond the budget; 0 otherwise). */
export function turnPenalty(before: BudgetView, after: BudgetView): number {
  const pts = (v: BudgetView) => overBudgetPoints(v.spent, v.budget, v.rule.overCost, v.rule.overCap);
  return Math.max(0, Math.round((pts(after) - pts(before)) * 10) / 10);
}

/* ------------------------------------------------------------------ */
/* Counter text                                                        */
/* ------------------------------------------------------------------ */

export interface CounterText {
  /** Short label before the number (残り / 目安 / 超過 / 締切). */
  label: string;
  /** The big number (left, or +over). */
  value: string;
  /** "/ N" (omitted when closed). */
  of?: string;
  /** Full sentence for screen readers and the tooltip. */
  aria: string;
}

export function ruleText(v: Pick<BudgetView, 'kind' | 'budget' | 'rule'>): string {
  if (v.kind === 'guide') return `質問の目安は${v.budget}問（超えても減点なし）`;
  if (v.kind === 'soft') return `質問枠は${v.budget}問（超えると1問ごとに減点${formatPts(v.rule.overCost)}）`;
  return `質問は${v.budget}問まで（尽きたら審問へ）`;
}

const formatPts = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1));

/** The difficulty chooser's line for a mode: 「質問枠 29問」 + what happens at the end of it. */
export function chooserText(v: Pick<BudgetView, 'kind' | 'budget'>): { head: string; sub: string } {
  if (v.kind === 'guide') return { head: `質問の目安 ${v.budget}問`, sub: '超えても減点なし' };
  if (v.kind === 'soft') return { head: `質問枠 ${v.budget}問`, sub: '超えると1問ごとに減点' };
  return { head: `質問は ${v.budget}問まで`, sub: '尽きたら審問へ' };
}

export function counterText(v: BudgetView): CounterText {
  const rule = ruleText(v);
  const free = '「具体的に」や雑談などは数えません。';
  if (v.state === 'closed') return { label: '質問', value: '締切', aria: `質問は締め切られました。${rule}`, of: undefined };
  if (v.over > 0)
    return {
      label: v.kind === 'guide' ? '目安超え' : '超過',
      value: `+${v.over}`,
      of: `/${v.budget}`,
      aria: `質問は${v.budget}問の${v.kind === 'guide' ? '目安' : '枠'}を${v.over}問超えています。${rule}。${free}`,
    };
  return {
    label: v.kind === 'guide' ? '目安' : '残り',
    value: String(v.left),
    of: `/${v.budget}`,
    aria: `質問の${v.kind === 'guide' ? '目安まで' : '残り'}${v.left}問（${v.budget}問中）。${rule}。${free}`,
  };
}

/* ------------------------------------------------------------------ */
/* Remarks and nudges                                                  */
/* ------------------------------------------------------------------ */

export type RemarkLineKey =
  | 'budget.guideLow'
  | 'budget.guideReached'
  | 'budget.softLow'
  | 'budget.softZero'
  | 'budget.softOver'
  | 'budget.hardLow'
  | 'budget.hardClosed'
  | 'nudge.ready'
  | 'nudge.starter';

export interface RemarkLine {
  text: string;
  mood: HolmaMood;
}

export interface Remark {
  reason: NudgeReason;
  text: string;
  mood: HolmaMood;
  /** The direction given (a free nudge): never repeated, counts toward the mode's nudges. */
  nudge?: string;
}

export interface NudgePool {
  nudges?: string[];
  starters?: string[];
  idle?: string[];
}

export interface TurnInput {
  before: BudgetView;
  after: BudgetView;
  /** The case log after this turn's entries. */
  log: LogEntry[];
  /** Shard progress 0..1 after the turn. */
  progress: number;
  solved: boolean;
  pool: NudgePool;
  /** Line bank access ('investigation.' + key). */
  line: (key: RemarkLineKey) => RemarkLine;
}

type NudgeEntry = Extract<LogEntry, { kind: 'nudge' }>;
const isNudge = (e: LogEntry): e is NudgeEntry => e.kind === 'nudge';
const gaveNudge = (e: LogEntry) => isNudge(e) && !!e.nudge;
const isAnswer = (e: LogEntry): e is Extract<LogEntry, { kind: 'answer' }> => e.kind === 'answer' && e.notice !== 'support';

/** Answers since the last entry matching `stop` (all answers when there is none). */
function answersSince(log: LogEntry[], stop: (e: LogEntry) => boolean): number {
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (stop(e)) break;
    if (isAnswer(e)) n++;
  }
  return n;
}

/** Answers in a row without a new finding, a whisper or a nudge. */
export function stuckStreak(log: LogEntry[]): number {
  return answersSince(log, (e) => (isAnswer(e) && e.unlocked.length > 0) || e.kind === 'hint' || gaveNudge(e));
}

/** Directions already given this run. */
export function usedNudges(log: LogEntry[]): string[] {
  return log.filter(gaveNudge).map((e) => (e as NudgeEntry).nudge!);
}

const squash = (s: string) => s.replace(/[\s　？?。、，,！!「」『』…・]/g, '');

/** Case idle lines that assume the player has stopped typing make no sense after a question. */
const IDLE_ONLY = /止ま|手が|指も|考え中|急か|沈黙/;

/** The next direction nobody gave yet: authored nudges → unasked starters → fitting idle lines. */
export function nextDirection(pool: NudgePool, log: LogEntry[], starterLine: () => RemarkLine): { text: string; nudge: string } | null {
  const used = new Set(usedNudges(log));
  for (const n of pool.nudges ?? []) if (n.trim() && !used.has(n)) return { text: n, nudge: n };
  const asked = log.filter((e): e is Extract<LogEntry, { kind: 'question' }> => e.kind === 'question').map((e) => squash(e.text));
  for (const q of pool.starters ?? []) {
    const k = squash(q);
    if (!k || used.has(q) || asked.some((a) => a === k || a.includes(k) || (a.length >= 4 && k.includes(a)))) continue;
    return { text: starterLine().text.replace('{q}', q), nudge: q };
  }
  for (const l of pool.idle ?? []) if (l.trim() && !used.has(l) && !IDLE_ONLY.test(l)) return { text: l, nudge: l };
  return null;
}

/**
 * What Holma says unasked after a turn (0–2 remarks, in order). Budget remarks fire when the
 * turn crosses a threshold; a free nudge when the player is stuck or the budget just ran low.
 */
export function planRemarks(t: TurnInput): Remark[] {
  const { before: b, after: a } = t;
  const out: Remark[] = [];
  const say = (reason: NudgeReason, key: RemarkLineKey): Remark => {
    const l = t.line(key);
    return { reason, text: l.text, mood: l.mood };
  };

  // 1) the budget
  let low: Remark | undefined;
  if (a.spent > b.spent) {
    if (a.kind === 'hard') {
      if (a.state === 'closed' && b.state !== 'closed') out.push(say('closed', 'budget.hardClosed'));
      else if (a.state === 'low' && b.state === 'ok') out.push((low = say('low', 'budget.hardLow')));
    } else if (a.kind === 'soft') {
      const every = BUDGET_TUNING.overRemarkEvery;
      if (a.over > 0 && (b.over === 0 || Math.floor(a.over / every) > Math.floor(b.over / every))) out.push(say('over', 'budget.softOver'));
      else if (a.state === 'zero' && b.state !== 'zero') out.push(say('zero', 'budget.softZero'));
      else if (a.state === 'low' && b.state === 'ok') out.push((low = say('low', 'budget.softLow')));
    } else {
      if (a.left === 0 && b.left > 0) out.push(say('zero', 'budget.guideReached'));
      else if (a.state === 'low' && b.state === 'ok') out.push((low = say('low', 'budget.guideLow')));
    }
  }

  // 2) a free nudge
  const rule = a.rule;
  const room = !t.solved && a.state !== 'closed' && usedNudges(t.log).length < rule.nudges;
  if (!room) return out;
  const gapOk = answersSince(t.log, gaveNudge) >= BUDGET_TUNING.nudge.gap;
  const starter = () => t.line('nudge.starter');
  if (low && rule.nudgeOn.low && gapOk) {
    const d = nextDirection(t.pool, t.log, starter);
    if (d) {
      low.text = `${low.text}\n${d.text}`;
      low.nudge = d.nudge;
    }
    return out;
  }
  if (rule.nudgeOn.stuck && gapOk && stuckStreak(t.log) >= BUDGET_TUNING.nudge.stuck) {
    if (t.progress >= BUDGET_TUNING.nudge.readyProgress && !t.log.some((e) => isNudge(e) && e.reason === 'ready')) {
      const r = say('ready', 'nudge.ready');
      out.push({ ...r, nudge: r.text });
      return out;
    }
    const d = nextDirection(t.pool, t.log, starter);
    if (d) out.push({ reason: 'stuck', text: d.text, mood: 'normal', nudge: d.nudge });
  }
  return out;
}
