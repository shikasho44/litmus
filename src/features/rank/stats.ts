/**
 * Collects the rank input from a case's save (pure; no signals).
 *
 * Sources, in order of trust: the server snapshot (signed token), then the UI-side
 * counters (inquest.grants / suspensions are only known to the UI), then the chat log.
 */
import type { CaseProgress, CaseResult } from '../../state/types';
import { computeRank, type RankInput, type RankResult } from './rank';

export interface CaseMeta {
  difficulty: number;
  estimatedMinutes?: number;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function collectRankInput(p: CaseProgress | undefined, meta: CaseMeta): RankInput {
  const snap = p?.snapshot;
  const log = p?.log ?? [];
  const answers = log.filter((e) => e.kind === 'answer') as Extract<CaseProgress['log'][number], { kind: 'answer' }>[];
  const questions = log.filter((e) => e.kind === 'question').length;
  const keyQuestions = answers.filter((a) => Array.isArray(a.unlocked) && a.unlocked.length > 0).length;
  return {
    difficulty: meta.difficulty,
    estimatedMinutes: meta.estimatedMinutes,
    asked: num(snap?.asked, Math.max(questions, answers.length)),
    keyQuestions,
    answered: answers.length,
    hintsUsed: num(snap?.hintsUsed, p?.hints.length ?? 0),
    debateMisses: num(snap?.debateMisses, p?.inquest?.misses ?? 0),
    grants: num(p?.inquest?.grants),
    verdictAttempts: Math.max(1, num(snap?.verdictAttempts, p?.inquest?.verdictAttempts ?? 1)),
    suspensions: num(p?.inquest?.suspensions),
    elapsedMs: num(p?.elapsedMs),
    debateRounds: num(p?.inquest?.rounds),
    debateCleared: Array.isArray(snap?.debateCleared) ? snap.debateCleared.length : (p?.inquest?.cleared?.length ?? 0),
  };
}

/** Quiz retries recorded by the recall test (answers[i] = wrong attempts on question i). */
export function quizMisses(p: CaseProgress | undefined): number {
  const a = p?.quiz?.answers;
  if (!a) return 0;
  return Object.values(a).reduce((s, v) => s + (typeof v === 'number' && v > 0 ? v : 0), 0);
}

/** Build the CaseResult stored by completeCase(). */
export function buildCaseResult(p: CaseProgress | undefined, meta: CaseMeta, now = Date.now()): { result: CaseResult; rank: RankResult; input: RankInput } {
  const input = collectRankInput(p, meta);
  const rank = computeRank(input);
  const result: CaseResult = {
    rank: rank.rank,
    title: rank.title,
    at: now,
    elapsedMs: input.elapsedMs,
    playDifficulty: p?.difficulty ?? 'normal',
    stats: {
      score: rank.score,
      asked: input.asked,
      keyQuestions: input.keyQuestions,
      answered: input.answered,
      hintsUsed: input.hintsUsed,
      debateMisses: input.debateMisses,
      grants: input.grants,
      verdictAttempts: input.verdictAttempts,
      suspensions: input.suspensions ?? 0,
      quizMisses: quizMisses(p),
      debateRounds: input.debateRounds ?? 0,
      debateCleared: input.debateCleared ?? 0,
      difficulty: meta.difficulty,
      ...(meta.estimatedMinutes ? { estimatedMinutes: meta.estimatedMinutes } : {}),
    },
  };
  return { result, rank, input };
}
