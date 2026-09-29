import { describe, expect, it } from 'vitest';
import type { CaseProgress } from '../../state/types';
import { allRoundsCleared, computeRank, formatPenalty, keyRateTarget, PENALTY_RULES, penaltyPoints, penaltyStep, questionPar, rankAdvice, RANK_TITLES, rankTitleOf, RUN_DISTINCTIONS, runDistinctions, type CountPenaltyId, type RankInput } from './rank';
import { buildCaseResult, collectRankInput, quizMisses, runGameOvers } from './stats';

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
    expect(r.title).toBe('誤差ゼロの審問官');
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
    expect(a.line).toMatch(/囁き1回|反応なし4回/);
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

describe('game overs and recall-test retries (2026-09-27)', () => {
  it('each game over of the run costs 12, capped at 36', () => {
    const pts = (gameOvers: number) => computeRank(base({ gameOvers })).penalties.find((p) => p.id === 'gameOvers')?.points ?? 0;
    expect(pts(0)).toBe(0);
    expect(pts(1)).toBe(12);
    expect(pts(2)).toBe(24);
    expect(pts(3)).toBe(36);
    expect(pts(5)).toBe(36);
    expect(computeRank(base({ gameOvers: 1 })).score).toBe(88);
    expect(computeRank(base({ gameOvers: 2 })).rank).toBe('A');
  });

  it('each quiz retry costs 2, capped at 8', () => {
    const pts = (quizMisses: number) => computeRank(base({ quizMisses })).penalties.find((p) => p.id === 'quiz')?.points ?? 0;
    expect(pts(1)).toBe(2);
    expect(pts(3)).toBe(6);
    expect(pts(4)).toBe(8);
    expect(pts(9)).toBe(8);
    expect(computeRank(base({ quizMisses: 1 })).score).toBe(98);
  });

  it('the new penalties do not depend on the case difficulty', () => {
    for (const d of [1, 2, 3]) {
      const r = computeRank(base({ difficulty: d, gameOvers: 1, quizMisses: 2 }));
      expect(r.penalties.filter((p) => p.id === 'gameOvers' || p.id === 'quiz').map((p) => p.points)).toEqual([12, 4]);
    }
  });

  it('Holma names a game over when it alone cost the S', () => {
    const inp = base({ gameOvers: 2 });
    const a = rankAdvice(inp);
    expect(a.target).toBe('S');
    expect(a.blockers.map((b) => b.id)).toEqual(['gameOvers']);
    expect(a.line).toBe('ゲームオーバー2回がなければ、Sでしたねェ。');
  });

  it('quiz retries are named in the advice with the count', () => {
    const inp = base({ quizMisses: 4, verdictAttempts: 3, debateMisses: 2 });
    const r = computeRank(inp);
    expect(r.penalties.find((p) => p.id === 'quiz')?.points).toBe(8);
    const a = rankAdvice(inp, r);
    expect(a.blockers.length).toBeGreaterThan(0);
    if (a.blockers.some((b) => b.id === 'quiz')) expect(a.line).toContain('確認テストのやり直し4回');
  });

  it('collectRankInput counts only the game overs since the last clear, and the quiz retries', () => {
    const p = { log: [], hints: [], elapsedMs: 0, gameOvers: 5, gameOversAtClear: 3, quiz: { answers: { '0': 2, '1': 1 }, correct: ['0', '1'] } } as unknown as CaseProgress;
    expect(runGameOvers(p)).toBe(2);
    expect(runGameOvers({ gameOvers: 2 })).toBe(2);
    expect(runGameOvers({ gameOvers: 1, gameOversAtClear: 3 })).toBe(0);
    expect(runGameOvers(undefined)).toBe(0);
    const i = collectRankInput(p, { difficulty: 1 });
    expect(i.gameOvers).toBe(2);
    expect(i.quizMisses).toBe(3);
    const { result, points } = buildCaseResult(p, { difficulty: 1 });
    expect(result.stats.gameOvers).toBe(2);
    expect(result.stats.quizMisses).toBe(3);
    expect(result.stats.score).toBe(100 - 24 - 6);
    expect(result.stats.points).toBe(points.total);
    expect(points.total).toBe(70); // normal ×1.0
  });
});

describe('penaltyStep (the in-play 「減点 −n」)', () => {
  const ids = Object.keys(PENALTY_RULES) as CountPenaltyId[];

  it('the steps add up to what computeRank charges', () => {
    for (const d of [1, 2, 3])
      for (const id of ids)
        for (let count = 0; count <= 8; count++) {
          let sum = 0;
          for (let k = 0; k < count; k++) sum += penaltyStep(id, k, d);
          expect(Math.round(sum * 10) / 10).toBe(penaltyPoints(id, count, d));
        }
  });

  it('matches the per-event sizes by difficulty', () => {
    expect([1, 2, 3].map((d) => penaltyStep('hints', 0, d))).toEqual([8, 7, 6]);
    expect([1, 2, 3].map((d) => penaltyStep('misses', 0, d))).toEqual([4, 3.5, 3]);
    expect([1, 2, 3].map((d) => penaltyStep('grants', 0, d))).toEqual([10, 9, 8]);
    expect([1, 2, 3].map((d) => penaltyStep('verdict', 0, d))).toEqual([6, 5.5, 5]);
    expect(penaltyStep('gameOvers', 0, 2)).toBe(12);
    expect(penaltyStep('quiz', 0, 2)).toBe(2);
    expect(penaltyStep('suspensions', 3, 2)).toBe(5);
  });

  it('shows the marginal amount at a cap, then nothing', () => {
    // misses at difficulty 2: 3.5 each, cap 20 → the 6th miss adds 2.5, the 7th nothing
    expect(penaltyStep('misses', 5, 2)).toBe(2.5);
    expect(penaltyStep('misses', 6, 2)).toBe(0);
    expect(penaltyStep('gameOvers', 2, 1)).toBe(12);
    expect(penaltyStep('gameOvers', 3, 1)).toBe(0);
    expect(penaltyStep('quiz', 3, 1)).toBe(2);
    expect(penaltyStep('quiz', 4, 1)).toBe(0);
    expect(penaltyStep('verdict', 4, 1)).toBe(0);
  });

  it('a wrong verdict costs one more retry, counted from the attempts before it', () => {
    // two wrong verdicts, then the right one = verdictAttempts 3 = two retries
    const d = 2;
    const charged = computeRank(base({ difficulty: d, verdictAttempts: 3 })).penalties.find((p) => p.id === 'verdict')?.points;
    expect(penaltyStep('verdict', 0, d) + penaltyStep('verdict', 1, d)).toBe(charged);
  });

  it('formats like the float shows it', () => {
    expect(formatPenalty(3.5)).toBe('3.5');
    expect(formatPenalty(6)).toBe('6');
    expect(formatPenalty(2.5000001)).toBe('2.5');
  });
});

describe('question budget (shared/budget.ts) as the question par', () => {
  const soft = { budget: 29, overCost: 1.5, overCap: 24 };
  const qPoints = (i: RankInput) => computeRank(i).penalties.find((p) => p.id === 'questions')?.points ?? 0;

  it('charges only counted questions beyond the budget, at the mode cost and cap', () => {
    expect(qPoints(base({ ...soft, asked: 29, spent: 29, answered: 29, keyQuestions: 15 }))).toBe(0);
    expect(qPoints(base({ ...soft, asked: 33, spent: 33, answered: 33, keyQuestions: 17 }))).toBe(6);
    // free questions (「具体的に」, small talk…) do not count
    expect(qPoints(base({ ...soft, asked: 40, spent: 29, answered: 40, keyQuestions: 20 }))).toBe(0);
    expect(qPoints(base({ ...soft, asked: 120, spent: 120, answered: 120, keyQuestions: 60 }))).toBe(24);
    // 見習い: a guide only, no cost
    expect(qPoints(base({ budget: 35, overCost: 0, overCap: 0, asked: 80, spent: 80, answered: 80, keyQuestions: 40 }))).toBe(0);
    expect(computeRank(base({ ...soft })).budget).toBe(29);
  });

  it('without budget fields the old rule applies (par by case difficulty, 0.6 per question)', () => {
    const r = computeRank(base({ asked: 32, answered: 32, keyQuestions: 16 }));
    expect(r.budget).toBe(questionPar(1));
    expect(r.penalties.find((p) => p.id === 'questions')?.points).toBe(6);
  });

  it('names the budget in the advice', () => {
    const i = base({ ...soft, asked: 45, spent: 45, answered: 45, keyQuestions: 23 });
    const a = rankAdvice(i);
    expect(computeRank(i).rank).not.toBe('S');
    expect(a.line).toContain('質問枠より16問多い質問');
    expect(rankAdvice(base({ asked: 30, answered: 30, keyQuestions: 15, hintsUsed: 1 })).line).not.toContain('質問枠');
  });

  it('collectRankInput takes the budget of the difficulty played (and the case override)', () => {
    const p = (difficulty: 'easy' | 'normal' | 'hard', spent?: number) =>
      ({
        caseId: 'c01',
        stage: 'quiz',
        difficulty,
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
        snapshot: { unlocked: [], memos: [], asked: 30, ...(spent === undefined ? {} : { spent }), hintsUsed: 0, debateCleared: [], debateMisses: 0, verdictAttempts: 1, solved: true, reconstructed: true, progress: 1, nearCore: true },
      }) as CaseProgress;
    expect(collectRankInput(p('normal', 26), { difficulty: 1 })).toMatchObject({ asked: 30, spent: 26, budget: 22, overCost: 1.5, overCap: 24 });
    expect(collectRankInput(p('easy', 26), { difficulty: 1 })).toMatchObject({ budget: 29, overCost: 0 });
    expect(collectRankInput(p('hard', 26), { difficulty: 3 })).toMatchObject({ budget: 30, overCost: 1.5 });
    expect(collectRankInput(p('hard', 26), { difficulty: 1, questionBudget: { hard: 8 } })).toMatchObject({ budget: 8 });
    // a snapshot from before the budget: spent = asked
    expect(collectRankInput(p('normal'), { difficulty: 1 }).spent).toBe(30);
    // stored stats recompute to the same result
    const { result, rank } = buildCaseResult(p('normal', 33), { difficulty: 1 });
    expect(result.stats).toMatchObject({ asked: 30, spent: 30, budget: 22, budgetCost: 1.5, budgetCap: 24 });
    const again = computeRank({
      difficulty: 1,
      asked: result.stats.asked,
      spent: result.stats.spent,
      budget: result.stats.budget,
      overCost: result.stats.budgetCost,
      overCap: result.stats.budgetCap,
      keyQuestions: result.stats.keyQuestions,
      answered: result.stats.answered,
      hintsUsed: 0,
      debateMisses: 0,
      grants: 0,
      verdictAttempts: 1,
      elapsedMs: 0,
    });
    expect(again.score).toBe(rank.score);
  });
});

describe('rankTitleOf (titles renamed for the 反証 wording, 2026-09-29)', () => {
  it('finds a title by its current text', () => {
    expect(rankTitleOf('誤差ゼロの審問官')?.id).toBe('one-shot');
    expect(rankTitleOf('完全無欠の審問官')?.id).toBe('flawless');
  });
  it('shows an old saved title under its new name', () => {
    expect(rankTitleOf('一撃の審問官')?.title).toBe('誤差ゼロの審問官');
    expect(rankTitleOf('ためらわぬ弾丸')?.title).toBe('ためらわぬ指先');
  });
  it('returns nothing for an unknown or missing title', () => {
    expect(rankTitleOf('知らない称号')).toBeUndefined();
    expect(rankTitleOf(undefined)).toBeUndefined();
  });
  it('no title uses the shooting words any more', () => {
    for (const t of RANK_TITLES) expect(`${t.title}${t.comment}`, t.id).not.toMatch(/撃|弾|ノイズ/u);
  });
});

describe('寡黙な解剖医 and the distinctions (2026-09-29)', () => {
  const s = (over: Partial<RankInput>) =>
    computeRank({ difficulty: 1, asked: 10, answered: 10, keyQuestions: 8, hintsUsed: 0, debateMisses: 1, grants: 0, verdictAttempts: 1, elapsedMs: 0, ...over });
  it('寡黙 is measured against the smaller of the par and the run budget', () => {
    // par 22, budget 15 → at most 10 counted questions
    expect(s({ spent: 10, asked: 10, budget: 15, overCost: 1.5, overCap: 24 }).titleId).toBe('silent');
    expect(s({ spent: 11, asked: 11, answered: 11, budget: 15, overCost: 1.5, overCap: 24 }).titleId).toBe('ace');
    // a roomy budget does not loosen it beyond the par (22 × 0.7 → 15)
    expect(s({ spent: 15, asked: 15, answered: 15, keyQuestions: 12, budget: 40, overCost: 1.5, overCap: 24 }).titleId).toBe('silent');
    expect(s({ spent: 16, asked: 16, answered: 16, keyQuestions: 12, budget: 40, overCost: 1.5, overCap: 24 }).titleId).toBe('ace');
  });
  it('素手の審問官: only when the run recorded that it used no example card', () => {
    expect(runDistinctions({ examplesUsed: 0 }).map((d) => d.id)).toEqual(['own-words']);
    expect(runDistinctions({ examplesUsed: 1 })).toEqual([]);
    expect(runDistinctions({})).toEqual([]);
    expect(runDistinctions(undefined)).toEqual([]);
    for (const d of RUN_DISTINCTIONS) expect(`${d.title}${d.comment}`).not.toMatch(/撃|弾|ノイズ/u);
  });
});
