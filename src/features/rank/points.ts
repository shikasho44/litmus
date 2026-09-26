/**
 * 名探偵度数 (detective degree) — design bible §3-6 「名探偵度数」, docs/decisions.md 2026-09-27.
 * Pure functions + constants (no signals), so the thresholds are easy to retune.
 *
 *   獲得度数 (one run)   = round(事件スコア × 難易度倍率) + S+ボーナス
 *                          倍率 見習い 0.6 / 審問官 1.0 / 教授 1.4, S+ボーナス 10
 *   case best            = the highest 獲得度数 of that case (CaseProgress.bestPoints)
 *   名探偵度数 (total)   = Σ case bests — a replay only counts when it beats the case's best,
 *                          so the total cannot be farmed by replaying an easy case.
 *
 * The levels are absolute thresholds: with the three cases the top badge is out of reach
 * (max 3 × 150 = 450); adding cases opens it up.
 */
import type { Difficulty } from '../../../shared/api';
import type { CaseProgress, CaseResult, Rank } from '../../state/types';

export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { easy: 0.6, normal: 1.0, hard: 1.4 };
export const SPLUS_BONUS = 10;

export interface RunPoints {
  /** 事件スコア 0..100. */
  score: number;
  difficulty: Difficulty;
  multiplier: number;
  /** round(score × multiplier). */
  base: number;
  /** S+ bonus (0 or SPLUS_BONUS). */
  bonus: number;
  /** 獲得度数. */
  total: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const isDifficulty = (v: unknown): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';

export function runPoints(score: number, difficulty: Difficulty | undefined, rank: Rank): RunPoints {
  const d = isDifficulty(difficulty) ? difficulty : 'normal';
  const s = Math.min(100, Math.round(num(score)));
  const multiplier = DIFFICULTY_MULTIPLIER[d];
  const base = Math.round(s * multiplier);
  const bonus = rank === 'S+' ? SPLUS_BONUS : 0;
  return { score: s, difficulty: d, multiplier, base, bonus, total: base + bonus };
}

/** The 獲得度数 of a stored run (older runs without stats.points are recomputed from their score). */
export function resultPoints(r: Pick<CaseResult, 'rank' | 'playDifficulty' | 'stats'>): RunPoints {
  const p = runPoints(r.stats?.score ?? 0, r.playDifficulty, r.rank);
  const stored = r.stats?.points;
  return typeof stored === 'number' && Number.isFinite(stored) && stored >= 0 ? { ...p, total: Math.round(stored) } : p;
}

/** 名探偵度数: the sum of every case's best. */
export function detectiveTotal(cases: Record<string, Pick<CaseProgress, 'bestPoints'>> | undefined): number {
  if (!cases) return 0;
  return Object.values(cases).reduce((s, c) => s + Math.round(num(c?.bestPoints)), 0);
}

/* ------------------------------------------------------------------ */
/* Levels / badges                                                      */
/* ------------------------------------------------------------------ */

export interface DetectiveRank {
  level: number;
  name: string;
  en: string;
  /** Total needed. */
  min: number;
}

/** Lv1 bronze → Lv2 silver → Lv3 gold → Lv4 formalin → Lv5 prismatic (DetectiveBadge). */
export const DETECTIVE_LEVELS: DetectiveRank[] = [
  { level: 1, name: '駆け出し探偵', en: 'ROOKIE', min: 1 },
  { level: 2, name: '一人前の探偵', en: 'FULL-FLEDGED', min: 120 },
  { level: 3, name: '腕利き探偵', en: 'ACE', min: 240 },
  { level: 4, name: '名探偵', en: 'MASTER', min: 360 },
  { level: 5, name: '伝説の名探偵', en: 'LEGEND', min: 480 },
];

export const NO_DETECTIVE_RANK: DetectiveRank = { level: 0, name: 'まだ称号なし', en: 'UNRANKED', min: 0 };

export interface DetectiveLevel extends DetectiveRank {
  total: number;
  /** The next badge, or null at the top. */
  next: DetectiveRank | null;
  /** Points still needed for the next badge (0 at the top). */
  toNext: number;
  /** 0..1 progress from this badge's threshold to the next one (1 at the top). */
  progress: number;
}

export function detectiveLevel(total: number): DetectiveLevel {
  const t = Math.round(num(total));
  let cur = NO_DETECTIVE_RANK;
  for (const l of DETECTIVE_LEVELS) if (t >= l.min) cur = l;
  const next = DETECTIVE_LEVELS.find((l) => l.level === cur.level + 1) ?? null;
  const span = next ? next.min - cur.min : 1;
  return {
    ...cur,
    total: t,
    next,
    toNext: next ? next.min - t : 0,
    progress: next ? Math.min(1, Math.max(0, (t - cur.min) / span)) : 1,
  };
}
