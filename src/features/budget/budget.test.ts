import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../state/types';
import { budgetFor, caseBudget, counterText, nextDirection, planRemarks, spentOf, stuckStreak, turnPenalty, type RemarkLineKey, type TurnInput } from './budget';

// the remark / counter logic is tested on fixed budgets (29 / 35 / 24, the defaults before 2026-09-29)
const c1 = { difficulty: 1, questionBudget: { easy: 35, normal: 29, hard: 24 } };
let seq = 0;
const q = (text: string): LogEntry => ({ id: `q${++seq}`, at: 0, kind: 'question', text });
const a = (unlocked: string[] = [], extra: Partial<Extract<LogEntry, { kind: 'answer' }>> = {}): LogEntry => ({
  id: `a${++seq}`,
  at: 0,
  kind: 'answer',
  question: 'x',
  answerClass: unlocked.length ? 'yes' : 'no',
  line: '',
  mood: 'normal',
  unlocked,
  memos: [],
  ...extra,
});
const turns = (n: number, unlocked: string[] = []) => Array.from({ length: n }, (_, i) => [q(`質問${i}`), a(unlocked)]).flat();
const line = (key: RemarkLineKey) => ({ text: key === 'nudge.starter' ? '（例）「{q}」' : `<${key}>`, mood: 'normal' as const });

function input(over: Partial<TurnInput> & { play?: 'easy' | 'normal' | 'hard'; from: number; to: number }): TurnInput {
  const play = over.play ?? 'normal';
  return {
    before: budgetFor(c1, play, over.from),
    after: budgetFor(c1, play, over.to),
    log: over.log ?? [],
    progress: over.progress ?? 0.2,
    solved: over.solved ?? false,
    pool: over.pool ?? { nudges: ['N1', 'N2', 'N3', 'N4'] },
    line,
  };
}

describe('budget view in the browser', () => {
  it('reads spent (older snapshots: asked) and the run difficulty', () => {
    expect(spentOf(undefined)).toBe(0);
    expect(spentOf({ asked: 7 })).toBe(7);
    expect(spentOf({ asked: 7, spent: 5 })).toBe(5);
    expect(spentOf({ asked: 3, spent: 5 })).toBe(3);
    expect(caseBudget(undefined, undefined)).toBeNull();
    expect(caseBudget(c1, { difficulty: 'hard', snapshot: { asked: 4, spent: 3 } as never })).toMatchObject({ budget: 24, spent: 3, left: 21, kind: 'hard' });
    expect(caseBudget({ difficulty: 1, questionBudget: { hard: 6 } }, { difficulty: 'hard', snapshot: undefined })).toMatchObject({ budget: 6, left: 6 });
  });

  it('counter text for every state', () => {
    expect(counterText(budgetFor(c1, 'normal', 3))).toMatchObject({ label: '残り', value: '26', of: '/29' });
    expect(counterText(budgetFor(c1, 'easy', 3))).toMatchObject({ label: '目安', value: '32', of: '/35' });
    expect(counterText(budgetFor(c1, 'normal', 31))).toMatchObject({ label: '超過', value: '+2' });
    expect(counterText(budgetFor(c1, 'easy', 40))).toMatchObject({ label: '目安超え', value: '+5' });
    expect(counterText(budgetFor(c1, 'hard', 24))).toMatchObject({ value: '締切', of: undefined });
    expect(counterText(budgetFor(c1, 'normal', 3)).aria).toContain('超えると1問ごとに減点1.5');
  });

  it('the in-play penalty matches the rank rule (normal only, per counted question beyond the budget)', () => {
    expect(turnPenalty(budgetFor(c1, 'normal', 28), budgetFor(c1, 'normal', 29))).toBe(0);
    expect(turnPenalty(budgetFor(c1, 'normal', 28), budgetFor(c1, 'normal', 31))).toBe(3);
    expect(turnPenalty(budgetFor(c1, 'easy', 40), budgetFor(c1, 'easy', 41))).toBe(0);
    // at the cap nothing more is charged
    expect(turnPenalty(budgetFor(c1, 'normal', 60), budgetFor(c1, 'normal', 61))).toBe(0);
  });
});

describe('budget remarks', () => {
  it('審問官: low once, then used up, then beyond (first over and every 5th)', () => {
    expect(planRemarks(input({ from: 20, to: 21 })).map((r) => r.reason)).toEqual(['low']);
    expect(planRemarks(input({ from: 21, to: 22 }))).toEqual([]);
    expect(planRemarks(input({ from: 28, to: 29 })).map((r) => r.text)).toEqual(['<budget.softZero>']);
    expect(planRemarks(input({ from: 29, to: 30 })).map((r) => r.text)).toEqual(['<budget.softOver>']);
    expect(planRemarks(input({ from: 30, to: 31 }))).toEqual([]);
    expect(planRemarks(input({ from: 33, to: 34 })).map((r) => r.reason)).toEqual(['over']);
    // a multi-question turn jumping past zero only remarks on being over
    expect(planRemarks(input({ from: 28, to: 30 })).map((r) => r.reason)).toEqual(['over']);
    // a free question (nothing counted) never remarks
    expect(planRemarks(input({ from: 29, to: 29 }))).toEqual([]);
  });

  it('見習い: gentle low and reached, nothing beyond', () => {
    expect(planRemarks(input({ play: 'easy', from: 25, to: 26 })).map((r) => r.text)).toEqual(['<budget.guideLow>']);
    expect(planRemarks(input({ play: 'easy', from: 34, to: 35 })).map((r) => r.text)).toEqual(['<budget.guideReached>']);
    expect(planRemarks(input({ play: 'easy', from: 36, to: 37 }))).toEqual([]);
  });

  it('教授: low, then closed; nothing after closing', () => {
    expect(planRemarks(input({ play: 'hard', from: 17, to: 18 })).map((r) => r.reason)).toEqual(['low']);
    expect(planRemarks(input({ play: 'hard', from: 23, to: 24 })).map((r) => r.text)).toEqual(['<budget.hardClosed>']);
  });
});

describe('free nudges', () => {
  it('after 6 answers without a finding, the case nudges in order, never twice', () => {
    expect(planRemarks(input({ from: 5, to: 6, log: turns(5) }))).toEqual([]);
    const first = planRemarks(input({ from: 6, to: 7, log: turns(6) }));
    expect(first).toEqual([{ reason: 'stuck', text: 'N1', mood: 'normal', nudge: 'N1' }]);
    const given: LogEntry = { id: 'n1', at: 0, kind: 'nudge', reason: 'stuck', text: 'N1', nudge: 'N1' };
    // the streak starts over after a nudge
    expect(planRemarks(input({ from: 7, to: 8, log: [...turns(6), given, ...turns(3)] }))).toEqual([]);
    expect(planRemarks(input({ from: 12, to: 13, log: [...turns(6), given, ...turns(6)] }))[0]).toMatchObject({ nudge: 'N2' });
  });

  it('a finding or a whisper resets the streak', () => {
    expect(stuckStreak([...turns(8), a(['F1']), ...turns(2)])).toBe(2);
    expect(stuckStreak([...turns(8), { id: 'h', at: 0, kind: 'hint', level: 1, text: 'h' }, ...turns(1)])).toBe(1);
    expect(stuckStreak([...turns(3), a([], { notice: 'support' })])).toBe(3);
  });

  it('respects the per-mode count: 審問官 3, 教授 only with the low remark, 見習い 4', () => {
    const given = (n: number): LogEntry[] => Array.from({ length: n }, (_, i) => [{ id: `n${i}`, at: 0, kind: 'nudge', reason: 'stuck', text: `N${i + 1}`, nudge: `N${i + 1}` } as LogEntry, ...turns(6)]).flat();
    expect(planRemarks(input({ from: 1, to: 2, log: given(2) }))[0]).toMatchObject({ nudge: 'N3' });
    expect(planRemarks(input({ from: 1, to: 2, log: given(3) }))).toEqual([]);
    expect(planRemarks(input({ play: 'easy', from: 1, to: 2, log: given(3) }))[0]).toMatchObject({ nudge: 'N4' });
    // 教授: a stuck streak alone never nudges …
    expect(planRemarks(input({ play: 'hard', from: 3, to: 4, log: turns(10) }))).toEqual([]);
    // … the budget running low does, once, merged into the remark
    const low = planRemarks(input({ play: 'hard', from: 17, to: 18, log: turns(10) }));
    expect(low).toEqual([{ reason: 'low', text: '<budget.hardLow>\nN1', mood: 'normal', nudge: 'N1' }]);
    const after = [...turns(10), { id: 'n', at: 0, kind: 'nudge', reason: 'low', text: 'x', nudge: 'N1' } as LogEntry, ...turns(8)];
    expect(planRemarks(input({ play: 'hard', from: 22, to: 23, log: after }))).toEqual([]);
  });

  it('a stuck player with most shards lit hears that the inquest may be ready (once)', () => {
    const r = planRemarks(input({ from: 6, to: 7, log: turns(6), progress: 0.7 }));
    expect(r).toEqual([{ reason: 'ready', text: '<nudge.ready>', mood: 'normal', nudge: '<nudge.ready>' }]);
    const log = [...turns(6), { id: 'r', at: 0, kind: 'nudge', reason: 'ready', text: 'r', nudge: 'r' } as LogEntry, ...turns(6)];
    expect(planRemarks(input({ from: 12, to: 13, log, progress: 0.8 }))[0]).toMatchObject({ reason: 'stuck', nudge: 'N1' });
  });

  it('no case nudges: unasked starters, then idle lines that fit a busy player', () => {
    const pool = { starters: ['部屋に窓はありましたか？', '彼女は一人でしたか？'], idle: ['手が止まっていますねェ。', '床を見なさい。'] };
    const starter = () => ({ text: '（例）「{q}」', mood: 'normal' as const });
    const log = [q('部屋に窓はありましたか'), a()];
    expect(nextDirection(pool, log, starter)).toEqual({ text: '（例）「彼女は一人でしたか？」', nudge: '彼女は一人でしたか？' });
    const used = (n: string): LogEntry => ({ id: n, at: 0, kind: 'nudge', reason: 'stuck', text: n, nudge: n });
    expect(nextDirection(pool, [...log, used('彼女は一人でしたか？')], starter)).toEqual({ text: '床を見なさい。', nudge: '床を見なさい。' });
    expect(nextDirection(pool, [...log, used('彼女は一人でしたか？'), used('床を見なさい。')], starter)).toBeNull();
  });

  it('never after the solve or once the budget closed', () => {
    expect(planRemarks(input({ from: 6, to: 7, log: turns(6), solved: true }))).toEqual([]);
  });
});
