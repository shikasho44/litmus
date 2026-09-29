/**
 * Collects the rank input from a case's save (pure; no signals).
 *
 * Sources, in order of trust: the server snapshot (signed token), then the UI-side
 * counters (inquest.grants / suspensions are only known to the UI), then the chat log.
 */
import type { CaseProgress, CaseResult } from '../../state/types';
import { budgetRule, questionBudget, type CaseBudgetOverride } from '../../../shared/budget';
import { runPoints, type RunPoints } from './points';
import { computeRank, type RankInput, type RankResult } from './rank';

export interface CaseMeta {
  difficulty: number;
  estimatedMinutes?: number;
  /** The case's question budget override (CaseSummary.questionBudget). */
  questionBudget?: CaseBudgetOverride;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function collectRankInput(p: CaseProgress | undefined, meta: CaseMeta): RankInput {
  const snap = p?.snapshot;
  const log = p?.log ?? [];
  const answers = log.filter((e) => e.kind === 'answer') as Extract<CaseProgress['log'][number], { kind: 'answer' }>[];
  const questions = log.filter((e) => e.kind === 'question').length;
  const keyQuestions = answers.filter((a) => Array.isArray(a.unlocked) && a.unlocked.length > 0).length;
  const asked = num(snap?.asked, Math.max(questions, answers.length));
  // the question budget of the difficulty the run is played on (shared/budget.ts)
  const play = p?.difficulty ?? 'normal';
  const rule = budgetRule(play);
  return {
    difficulty: meta.difficulty,
    estimatedMinutes: meta.estimatedMinutes,
    asked,
    spent: Math.min(asked, num(snap?.spent, asked)),
    budget: questionBudget(meta.difficulty, play, meta.questionBudget),
    overCost: rule.overCost,
    overCap: rule.overCap,
    keyQuestions,
    answered: answers.length,
    hintsUsed: num(snap?.hintsUsed, p?.hints.length ?? 0),
    debateMisses: num(snap?.debateMisses, p?.inquest?.misses ?? 0),
    grants: num(p?.inquest?.grants),
    verdictAttempts: Math.max(1, num(snap?.verdictAttempts, p?.inquest?.verdictAttempts ?? 1)),
    suspensions: num(p?.inquest?.suspensions),
    gameOvers: runGameOvers(p),
    quizMisses: quizMisses(p),
    elapsedMs: num(p?.elapsedMs),
    debateRounds: num(p?.inquest?.rounds),
    debateCleared: Array.isArray(snap?.debateCleared) ? snap.debateCleared.length : (p?.inquest?.cleared?.length ?? 0),
  };
}

/**
 * Game overs of the run being played: the lifetime counter minus its value at the last clear
 * (normal / hard game overs wipe the failed run's counters, so this is what remembers them).
 */
export function runGameOvers(p: Pick<CaseProgress, 'gameOvers' | 'gameOversAtClear'> | undefined): number {
  return Math.max(0, num(p?.gameOvers) - num(p?.gameOversAtClear));
}

/** Quiz retries recorded by the recall test (answers[i] = wrong attempts on question i). */
export function quizMisses(p: CaseProgress | undefined): number {
  const a = p?.quiz?.answers;
  if (!a) return 0;
  return Object.values(a).reduce((s, v) => s + (typeof v === 'number' && v > 0 ? v : 0), 0);
}

/** Build the CaseResult stored by completeCase() (stats.points = the run's 獲得度数). */
export function buildCaseResult(p: CaseProgress | undefined, meta: CaseMeta, now = Date.now()): { result: CaseResult; rank: RankResult; input: RankInput; points: RunPoints } {
  const input = collectRankInput(p, meta);
  const rank = computeRank(input);
  const playDifficulty = p?.difficulty ?? 'normal';
  const points = runPoints(rank.score, playDifficulty, rank.rank);
  // the clear time (investigation start → accepted verdict); a run solved before it was recorded falls back to its play time
  const clearMs = typeof p?.clearMs === 'number' ? p.clearMs : p?.snapshot?.solved ? num(p.elapsedMs) : undefined;
  const result: CaseResult = {
    rank: rank.rank,
    title: rank.title,
    at: now,
    elapsedMs: input.elapsedMs,
    playDifficulty,
    ...(clearMs !== undefined ? { clearMs } : {}),
    stats: {
      score: rank.score,
      points: points.total,
      asked: input.asked,
      spent: input.spent ?? input.asked,
      budget: rank.budget,
      budgetCost: input.overCost ?? 0,
      budgetCap: input.overCap ?? 0,
      keyQuestions: input.keyQuestions,
      answered: input.answered,
      hintsUsed: input.hintsUsed,
      debateMisses: input.debateMisses,
      grants: input.grants,
      verdictAttempts: input.verdictAttempts,
      suspensions: input.suspensions ?? 0,
      gameOvers: input.gameOvers ?? 0,
      quizMisses: input.quizMisses ?? 0,
      debateRounds: input.debateRounds ?? 0,
      debateCleared: input.debateCleared ?? 0,
      difficulty: meta.difficulty,
      ...(meta.estimatedMinutes ? { estimatedMinutes: meta.estimatedMinutes } : {}),
      // 質問の例 cards used (absent when the run had no cards to deal: an older run)
      ...(p?.examples ? { examplesUsed: p.examples.used.length } : {}),
    },
  };
  return { result, rank, input, points };
}
