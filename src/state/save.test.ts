import { beforeEach, describe, expect, it } from 'vitest';
import { detectiveTotal } from '../features/rank/points';
import { buildCaseResult } from '../features/rank/stats';
import { completeCase, freshCase, getCaseProgress, resetAll, resetCase, sanitize, saveData, updateCase } from './save';
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
