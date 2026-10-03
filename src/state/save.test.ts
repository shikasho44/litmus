import { beforeEach, describe, expect, it } from 'vitest';
import { detectiveTotal } from '../features/rank/points';
import { buildCaseResult } from '../features/rank/stats';
import { completeCase, freshCase, getCaseProgress, markCleared, resetAll, resetCase, sanitize, saveData, updateCase } from './save';
import { caseRunMode } from './runMode';
import type { CaseResult, Rank } from './types';

const ID = 'c01-test';
const run = (rank: Rank, score: number, playDifficulty: CaseResult['playDifficulty'] = 'normal', extra: Record<string, number> = {}): CaseResult => ({
  rank,
  title: 't',
  at: 1,
  elapsedMs: 0,
  playDifficulty,
  stats: { score, ...extra },
});

beforeEach(() => {
  resetAll();
});

describe('completeCase — best 獲得度数 and the game-over mark', () => {
  it('the first clear stores the run points as the case best', () => {
    completeCase(ID, run('A', 80, 'hard'));
    const c = getCaseProgress(ID)!;
    expect(c.bestPoints).toBe(112);
    expect(c.lastResult?.stats.points).toBe(112);
    expect(c.lastResult?.prevBestPoints).toBeUndefined();
    expect(detectiveTotal(saveData.value.cases)).toBe(112);
  });

  it('a weaker replay keeps the best (no farming); a stronger one raises it', () => {
    completeCase(ID, run('A', 80, 'hard'));
    resetCase(ID);
    completeCase(ID, run('S', 100, 'easy'));
    let c = getCaseProgress(ID)!;
    expect(c.bestPoints).toBe(112);
    expect(c.lastResult?.stats.points).toBe(60);
    expect(c.lastResult?.prevBestPoints).toBe(112);
    resetCase(ID);
    completeCase(ID, run('S+', 100, 'hard'));
    c = getCaseProgress(ID)!;
    expect(c.bestPoints).toBe(150);
    expect(c.lastResult?.prevBestPoints).toBe(112);
    expect(detectiveTotal(saveData.value.cases)).toBe(150);
  });

  it('game overs are charged per run: the mark moves at every clear and survives resetCase', () => {
    updateCase(ID, { gameOvers: 2 });
    let r = buildCaseResult(getCaseProgress(ID), { difficulty: 1 });
    expect(r.input.gameOvers).toBe(2);
    completeCase(ID, r.result);
    expect(getCaseProgress(ID)!.gameOversAtClear).toBe(2);
    // replay: one more game over (normal/hard: resetCase + new run)
    resetCase(ID);
    updateCase(ID, (c) => ({ ...c, gameOvers: (c.gameOvers ?? 0) + 1 }));
    resetCase(ID);
    const c = getCaseProgress(ID)!;
    expect(c.gameOvers).toBe(3);
    expect(c.gameOversAtClear).toBe(2);
    r = buildCaseResult(c, { difficulty: 1 });
    expect(r.input.gameOvers).toBe(1);
    expect(r.rank.penalties.find((p) => p.id === 'gameOvers')?.points).toBe(12);
  });

  it('resetCase keeps the best points; resetAll wipes the 名探偵度数', () => {
    completeCase(ID, run('S', 95));
    completeCase('c02-test', run('B', 60, 'easy'));
    resetCase(ID);
    expect(getCaseProgress(ID)!.bestPoints).toBe(95);
    expect(detectiveTotal(saveData.value.cases)).toBe(95 + 36);
    resetAll();
    expect(detectiveTotal(saveData.value.cases)).toBe(0);
  });
});

describe('sanitize — the new optional case fields', () => {
  const blob = (c: Record<string, unknown>) => ({ version: 1, settings: {}, meta: {}, cases: { [ID]: { ...freshCase(ID), ...c } } });

  it('keeps valid numbers (rounded, ≥ 0) and drops junk', () => {
    expect(sanitize(blob({ bestPoints: 123.4 })).cases[ID].bestPoints).toBe(123);
    expect(sanitize(blob({ bestPoints: -5 })).cases[ID].bestPoints).toBe(0);
    expect(sanitize(blob({ bestPoints: 'lots' })).cases[ID].bestPoints).toBeUndefined();
    expect(sanitize(blob({ gameOvers: 3, gameOversAtClear: 9 })).cases[ID].gameOversAtClear).toBe(3);
    expect(sanitize(blob({ gameOvers: 3, gameOversAtClear: -1 })).cases[ID].gameOversAtClear).toBe(0);
    expect(sanitize(blob({ gameOvers: 2 })).cases[ID].gameOversAtClear).toBeUndefined();
  });

  it('a case completed before the feature gets its last run as the best, and its old game overs are forgiven', () => {
    const c = sanitize(blob({ completed: true, stage: 'complete', gameOvers: 2, bestRank: 'A', lastResult: run('A', 80, 'hard') })).cases[ID];
    expect(c.bestPoints).toBe(112);
    expect(c.gameOversAtClear).toBe(2);
    const inProgress = sanitize(blob({ completed: false, lastResult: run('A', 80, 'hard') })).cases[ID];
    expect(inProgress.bestPoints).toBeUndefined();
  });
});

describe('first clear and clear time (2026-09-29)', () => {
  const timed = (rank: Rank, clearMs: number, play: CaseResult['playDifficulty'] = 'normal', extra: Record<string, number> = {}): CaseResult => ({
    ...run(rank, 80, play, { spent: 12, budget: 15, ...extra }),
    clearMs,
  });

  it('the first clear is recorded once and never overwritten; the run says 初見 only then', () => {
    completeCase(ID, timed('A', 754_000, 'easy'));
    let c = getCaseProgress(ID)!;
    expect(c.firstClear).toMatchObject({ difficulty: 'easy', clearMs: 754_000, spent: 12, budget: 15, rank: 'A' });
    expect(c.lastResult?.firstClear).toBe(true);
    expect(c.lastResult?.clearMs).toBe(754_000);
    resetCase(ID);
    expect(getCaseProgress(ID)!.firstClear?.clearMs).toBe(754_000);
    completeCase(ID, timed('S+', 300_000, 'hard'));
    c = getCaseProgress(ID)!;
    expect(c.firstClear).toMatchObject({ difficulty: 'easy', clearMs: 754_000, rank: 'A' });
    expect(c.lastResult?.firstClear).toBeUndefined();
    expect(c.lastResult?.clearMs).toBe(300_000);
    expect(c.bestRank).toBe('S+');
  });

  it('a case cleared before the record existed gets none (nothing is invented)', () => {
    updateCase(ID, { completed: true, clears: 1, bestRank: 'B' });
    completeCase(ID, timed('S', 200_000));
    expect(getCaseProgress(ID)!.firstClear).toBeUndefined();
    expect(getCaseProgress(ID)!.lastResult?.firstClear).toBeUndefined();
  });

  it('markCleared keeps the play time at the accepted verdict; resetCase starts it over', () => {
    updateCase(ID, { elapsedMs: 61_000 });
    markCleared(ID);
    updateCase(ID, { elapsedMs: 90_000 });
    markCleared(ID);
    expect(getCaseProgress(ID)!.clearMs).toBe(61_000);
    expect(buildCaseResult(getCaseProgress(ID), { difficulty: 1 }).result.clearMs).toBe(61_000);
    resetCase(ID);
    expect(getCaseProgress(ID)!.clearMs).toBeUndefined();
  });

  it('a run solved without a 質問の例 card is remembered (ownWords); a run that used one is not', () => {
    completeCase(ID, timed('A', 1000, 'normal', { examplesUsed: 2 }));
    expect(getCaseProgress(ID)!.ownWords).toBeUndefined();
    resetCase(ID);
    completeCase(ID, timed('A', 1000, 'normal', { examplesUsed: 0 }));
    expect(getCaseProgress(ID)!.ownWords).toBe(true);
    resetCase(ID);
    expect(getCaseProgress(ID)!.ownWords).toBe(true);
  });

  it('an online versus run never writes a first clear', () => {
    caseRunMode.value = { caseId: ID, lockDifficulty: true };
    try {
      completeCase(ID, timed('S', 100_000));
      expect(getCaseProgress(ID)!.firstClear).toBeUndefined();
      expect(getCaseProgress(ID)!.lastResult?.firstClear).toBeUndefined();
    } finally {
      caseRunMode.value = null;
    }
  });

  it('sanitize keeps a valid record and drops a broken one', () => {
    const blob = (c: Record<string, unknown>) => ({ version: 1, settings: {}, meta: {}, cases: { [ID]: { ...freshCase(ID), ...c } } });
    const ok = { at: 5, difficulty: 'hard', clearMs: 1234, spent: 9, budget: 12, rank: 'S' };
    expect(sanitize(blob({ firstClear: ok })).cases[ID].firstClear).toEqual(ok);
    expect(sanitize(blob({ firstClear: { ...ok, rank: 'Z' } })).cases[ID].firstClear).toBeUndefined();
    expect(sanitize(blob({ firstClear: { ...ok, clearMs: -1 } })).cases[ID].firstClear).toBeUndefined();
    expect(sanitize(blob({ clearMs: 'x' })).cases[ID].clearMs).toBeUndefined();
    expect(sanitize(blob({ examples: { seed: 3, ms: 70_000, dealt: 3, shown: ['a？'], used: ['b？'] } })).cases[ID].examples).toEqual({ seed: 3, ms: 70_000, dealt: 3, shown: ['a？'], used: ['b？'] });
  });
});

describe('a prototype case (?proto=seeds) without its switch — src/config/proto.ts', () => {
  const PROTO = 'c09-rescued-morning'; // shared/proto.ts PROTO_CASES; no switch in tests
  const LAB = 'c10-shaken-bottle'; // shared/proto.ts PROTO_CASES (?proto=lab)

  it('its save stays out of the 名探偵度数 and 「続きから」, and is kept for when the switch is back', async () => {
    const { resumableCaseId, shownCases } = await import('./save');
    completeCase(ID, run('A', 80, 'hard'));
    completeCase(PROTO, run('S', 100, 'hard'));
    completeCase(LAB, run('S', 100, 'normal')); // a リトマス・ラボ sample (?proto=lab): the same rule
    expect(Object.keys(saveData.value.cases).sort()).toEqual([ID, PROTO, LAB].sort());
    expect(Object.keys(shownCases(saveData.value.cases))).toEqual([ID]);
    expect(detectiveTotal(shownCases(saveData.value.cases))).toBe(112);
    // an unfinished prototype run is never the case 「続きから」 reopens
    resetAll();
    updateCase(PROTO, { stage: 'investigation' });
    expect(saveData.value.cases[PROTO]?.stage).toBe('investigation');
    expect(resumableCaseId.value).toBeNull();
    updateCase(ID, { stage: 'investigation' });
    expect(resumableCaseId.value).toBe(ID);
  });

  it('shownCases returns the same object when nothing is hidden', async () => {
    const { shownCases } = await import('./save');
    const cases = { [ID]: freshCase(ID) };
    expect(shownCases(cases)).toBe(cases);
  });
});
