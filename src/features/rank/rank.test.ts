import { describe, expect, it } from 'vitest';
import type { CaseProgress } from '../../state/types';
import { allRoundsCleared, computeRank, keyRateTarget, questionPar, rankAdvice, RANK_TITLES, type RankInput } from './rank';
import { buildCaseResult, collectRankInput, quizMisses } from './stats';

const base = (over: Partial<RankInput> = {}): RankInput => ({
  difficulty: 1,
  asked: 16,
  keyQuestions: 9,
  answered: 16,
  hintsUsed: 0,
  debateMisses: 0,
  grants: 0,
  verdictAttempts: 1,
  suspensions: 0,
  elapsedMs: 9 * 60_000,
  estimatedMinutes: 15,
  ...over,
});

const ORDER = ['S+', 'S', 'A', 'B', 'C'];
const worseOrEqual = (a: string, b: string) => ORDER.indexOf(a) >= ORDER.indexOf(b);

describe('computeRank', () => {
  it('a sharp, clean run is S with a one-shot title', () => {
    const r = computeRank(base());
    expect(r.rank).toBe('S');
    expect(r.score).toBe(100);
    expect(r.title).toBe('一撃の審問官');
    expect(r.penalties).toEqual([]);
  });

  it('S needs no hints and no grants even with a high score', () => {
    expect(computeRank(base({ hintsUsed: 1 })).rank).toBe('A');
    expect(computeRank(base({ grants: 1 })).rank).not.toBe('S');
  });

  it('a heavy-assist run is C', () => {
    const r = computeRank(base({ asked: 70, answered: 70, keyQuestions: 10, hintsUsed: 3, grants: 2, verdictAttempts: 6, debateMisses: 5 }));
    expect(r.rank).toBe('C');
    expect(r.title).toBe('ホルマの常連客');
  });

  it('a typical first run lands in A or B', () => {
    const r = computeRank(base({ difficulty: 2, asked: 40, answered: 40, keyQuestions: 14, hintsUsed: 1, debateMisses: 2, verdictAttempts: 2, estimatedMinutes: 20, elapsedMs: 25 * 60_000 }));
    expect(['A', 'B']).toContain(r.rank);
  });

  it('pars scale with difficulty', () => {
    expect(questionPar(1)).toBeLessThan(questionPar(2));
    expect(questionPar(2)).toBeLessThan(questionPar(3));
    expect(keyRateTarget(3)).toBeLessThan(keyRateTarget(1));
  });

  it('the same play is never ranked worse on a harder case', () => {
    const runs: Partial<RankInput>[] = [
      { asked: 36, answered: 36, keyQuestions: 12 },
      { asked: 50, answered: 50, keyQuestions: 15, hintsUsed: 1, debateMisses: 3, verdictAttempts: 3 },
      { asked: 28, answered: 28, keyQuestions: 8, debateMisses: 4, grants: 1 },
      { asked: 60, answered: 60, keyQuestions: 12, hintsUsed: 2, verdictAttempts: 4 },
    ];
    for (const run of runs) {
      const s1 = computeRank(base({ ...run, difficulty: 1 }));
      const s2 = computeRank(base({ ...run, difficulty: 2 }));
      const s3 = computeRank(base({ ...run, difficulty: 3 }));
      expect(s2.score).toBeGreaterThanOrEqual(s1.score);
      expect(s3.score).toBeGreaterThanOrEqual(s2.score);
      expect(worseOrEqual(s1.rank, s3.rank)).toBe(true);
    }
  });

  it('an unknown key-question rate is not penalised', () => {
    const r = computeRank(base({ answered: 0, keyQuestions: 0 }));
    expect(r.keyRate).toBeNull();
    expect(r.penalties.find((p) => p.id === 'keyRate')).toBeUndefined();
  });

  it('a low key-question rate costs points', () => {
    const r = computeRank(base({ keyQuestions: 2, answered: 16 }));
    expect(r.penalties.find((p) => p.id === 'keyRate')?.points).toBeGreaterThan(0);
  });

  it('time is a small factor only', () => {
    const slow = computeRank(base({ elapsedMs: 5 * 3600_000 }));
    expect(slow.score).toBeGreaterThanOrEqual(92);
  });

  it('is robust to junk input', () => {
    const r = computeRank({ difficulty: NaN, asked: -3, keyQuestions: 99, answered: 1, hintsUsed: NaN, debateMisses: -1, grants: 0, verdictAttempts: 0, elapsedMs: -5 } as RankInput);
    expect(['S', 'A', 'B', 'C']).toContain(r.rank);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.keyRate).toBe(1);
  });

  it('every rank tier has titles and every picked title exists', () => {
    for (const rank of ['S', 'A', 'B', 'C']) expect(RANK_TITLES.filter((t) => t.rank === rank).length).toBeGreaterThanOrEqual(3);
    expect(new Set(RANK_TITLES.map((t) => t.id)).size).toBe(RANK_TITLES.length);
    const samples: Partial<RankInput>[] = [
      {},
      { asked: 12, answered: 12, keyQuestions: 7, debateMisses: 1 },
      { hintsUsed: 1, keyQuestions: 12 },
      { hintsUsed: 1, debateMisses: 1, keyQuestions: 7 },
      { hintsUsed: 3 },
      { verdictAttempts: 5 },
      { asked: 52, answered: 52, keyQuestions: 20 },
      { grants: 3, hintsUsed: 3 },
      { hintsUsed: 3, verdictAttempts: 4, debateMisses: 4, elapsedMs: 6 * 3600_000 },
      { hintsUsed: 3, debateMisses: 5, verdictAttempts: 5 },
    ];
    const seen = new Set<string>();
    for (const s of samples) {
      const r = computeRank(base(s));
      const t = RANK_TITLES.find((x) => x.id === r.titleId)!;
      expect(t.rank).toBe(r.rank);
      seen.add(r.titleId);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});

describe('collectRankInput / buildCaseResult', () => {
  const progress = (): CaseProgress => ({
    caseId: 'c01-x',
    stage: 'quiz',
    startedAt: 0,
    updatedAt: 0,
    elapsedMs: 600_000,
    log: [
      { id: '1', at: 0, kind: 'question', text: 'a' },
      { id: '2', at: 0, kind: 'answer', question: 'a', answerClass: 'yes', line: '', mood: 'normal', unlocked: ['F01'], memos: [] },
      { id: '3', at: 0, kind: 'question', text: 'b' },
      { id: '4', at: 0, kind: 'answer', question: 'b', answerClass: 'irrelevant', line: '', mood: 'normal', unlocked: [], memos: [] },
    ],
    facts: {},
    factOrder: [],
    seenFacts: [],
    memos: {},
    hints: [{ level: 1, text: 'h' }],
    notes: '',
    completed: false,
    clears: 0,
    snapshot: { unlocked: [], memos: [], asked: 2, hintsUsed: 1, debateCleared: [], debateMisses: 2, verdictAttempts: 3, solved: true, reconstructed: true, progress: 1, nearCore: true },
    inquest: { phase: 'done', roundIndex: 0, composure: 3, cleared: [], misses: 2, grants: 1, verdictAttempts: 3, suspensions: 0 },
    quiz: { answers: { '0': 1, '1': 0, '2': 2 }, correct: ['0', '1', '2'] },
  });

  it('reads the snapshot, UI counters and log', () => {
    const i = collectRankInput(progress(), { difficulty: 2, estimatedMinutes: 20 });
    expect(i).toMatchObject({ asked: 2, keyQuestions: 1, answered: 2, hintsUsed: 1, debateMisses: 2, grants: 1, verdictAttempts: 3, elapsedMs: 600_000, difficulty: 2 });
  });

  it('counts quiz retries and stores stats', () => {
    expect(quizMisses(progress())).toBe(3);
    const { result, rank } = buildCaseResult(progress(), { difficulty: 2 }, 123);
    expect(result.rank).toBe(rank.rank);
    expect(result.title).toBe(rank.title);
    expect(result.at).toBe(123);
    expect(result.stats.quizMisses).toBe(3);
    expect(result.stats.score).toBe(rank.score);
  });

  it('works with an empty save', () => {
    const i = collectRankInput(undefined, { difficulty: 1 });
    expect(i.asked).toBe(0);
    expect(i.verdictAttempts).toBe(1);
    expect(computeRank(i).rank).toBe('S');
  });
});

describe('rankAdvice', () => {
  it('a clean S has nothing to blame', () => {
    const a = rankAdvice(base());
    expect(a.target).toBeUndefined();
    expect(a.blockers).toEqual([]);
    expect(a.line).toContain('減点なし');
    expect(a.sCondition).toContain('囁き');
  });

  it('one hint is the whole reason an otherwise clean run is A', () => {
    const inp = base({ hintsUsed: 1 });
    expect(computeRank(inp).rank).toBe('A');
    const a = rankAdvice(inp);
    expect(a.target).toBe('S');
    expect(a.blockers.map((b) => b.id)).toEqual(['hints']);
    expect(a.line).toBe('囁き1回がなければ、Sでしたねェ。');
  });

  it('names two penalties when one is not enough, and the claim holds', () => {
    const inp = base({ hintsUsed: 1, debateMisses: 4 });
    const r = computeRank(inp);
    expect(r.rank).not.toBe('S');
    const a = rankAdvice(inp, r);
    expect(a.blockers.length).toBeGreaterThan(0);
    expect(a.blockers.length).toBeLessThanOrEqual(2);
    if (a.target === 'S') {
      const fixed = { ...inp, hintsUsed: a.blockers.some((b) => b.id === 'hints') ? 0 : inp.hintsUsed, debateMisses: a.blockers.some((b) => b.id === 'misses') ? 0 : inp.debateMisses };
      expect(computeRank(fixed).rank).toBe('S');
    }
    expect(a.line).toMatch(/囁き1回|撃ち損じ4回/);
  });

  it('falls back to the next rank up, then to the heaviest penalties', () => {
    const heavy = base({ asked: 70, answered: 70, keyQuestions: 10, hintsUsed: 3, grants: 2, verdictAttempts: 6, debateMisses: 5 });
    const a = rankAdvice(heavy);
    expect(a.blockers.length).toBeGreaterThan(0);
    expect(a.line.length).toBeGreaterThan(5);
    expect(a.target === undefined || a.target === 'B' || a.target === 'S').toBe(true);
  });
});

describe('S+ (every noise-break round cleared, none skipped)', () => {
  it('S with every round cleared and no begging is S+ with its own title', () => {
    const r = computeRank(base({ debateRounds: 2, debateCleared: 2 }));
    expect(r.rank).toBe('S+');
    expect(r.titleId).toBe('flawless');
    expect(RANK_TITLES.find((t) => t.id === r.titleId)?.rank).toBe('S+');
    expect(rankAdvice(base({ debateRounds: 2, debateCleared: 2 })).line).toContain('完璧');
  });

  it('a skipped round keeps a clean run at S, and Holma says what S+ needed', () => {
    const inp = base({ debateRounds: 2, debateCleared: 1 });
    expect(computeRank(inp).rank).toBe('S');
    const a = rankAdvice(inp);
    expect(a.target).toBe('S+');
    expect(a.line).toContain('S+');
  });

  it('begging for evidence rules out S+ (and S)', () => {
    expect(computeRank(base({ debateRounds: 2, debateCleared: 2, grants: 1 })).rank).not.toMatch(/^S/);
  });

  it('an unknown round count never gives S+', () => {
    expect(computeRank(base({ debateCleared: 2 })).rank).toBe('S');
    expect(allRoundsCleared({ debateRounds: 0, debateCleared: 0, grants: 0 })).toBe(false);
  });

  it('S+ is only the top of S: a penalised run is never lifted by the noise break', () => {
    expect(computeRank(base({ debateRounds: 2, debateCleared: 2, hintsUsed: 1 })).rank).toBe('A');
  });

  it('collectRankInput reads the round count from the inquest and the clears from the snapshot', () => {
    const p = {
      caseId: 'c01-x',
      stage: 'quiz',
      startedAt: 0,
      updatedAt: 0,
      elapsedMs: 0,
      log: [],
      facts: {},
      factOrder: [],
      seenFacts: [],
      memos: {},
      hints: [],
      notes: '',
      completed: false,
      clears: 0,
      difficulty: 'hard',
      snapshot: { unlocked: [], memos: [], asked: 10, hintsUsed: 0, debateCleared: ['r1', 'r2'], debateMisses: 0, verdictAttempts: 1, solved: true, reconstructed: true, progress: 1, nearCore: true },
      inquest: { phase: 'done', roundIndex: 1, composure: 5, cleared: ['r1', 'r2'], misses: 0, grants: 0, verdictAttempts: 1, suspensions: 0, rounds: 2 },
    } as CaseProgress;
    const i = collectRankInput(p, { difficulty: 1 });
    expect(i).toMatchObject({ debateRounds: 2, debateCleared: 2 });
    const { result } = buildCaseResult(p, { difficulty: 1 });
    expect(result.rank).toBe('S+');
    expect(result.playDifficulty).toBe('hard');
    expect(result.stats.debateCleared).toBe(2);
  });
});
