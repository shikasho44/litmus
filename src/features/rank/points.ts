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
 * The levels are absolute thresholds (a share of the content would drop everyone's title each time
 * a case is added). 2026-10-04 (docs/decisions.md 「名探偵度数の称号を11段＋★に」): the first
 * ladder (5 levels, top at 480) was topped after a handful of cases, so it became 11 named levels
 * plus an endless tail — after 伝説の名探偵, 「伝説の名探偵 ★2, ★3…」 every LEGEND_STAR_STEP.
 * Early growth stays quick (Lv2 ≈ one solved case, Lv3 ≈ two); 名探偵 needs about the eight
 * official cases played well (8 × 110 = 880); 伝説の名探偵 needs far more than today's content
 * (8 × 150 = 1,200 at most): 17 cases at the maximum, about 20 at high play. Saves keep only
 * points, so retuning needs no migration (a title may drop; nothing special is shown for that).
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
  /** The tail after the top named level: ★2, ★3 … (0 below it). */
  stars: number;
}

/**
 * THE ladder — every threshold lives here (tests, the 遊び方 page and the docs read it).
 * Badge tiers (DetectiveBadge, degree.css): Lv1–2 bronze · Lv3–4 silver · Lv5–6 gold ·
 * Lv7 formalin (名探偵) · Lv8 cyan · Lv9 violet · Lv10 crimson · Lv11 prismatic (伝説) · the ★ tail
 * prismatic with its star count.
 */
export const DETECTIVE_LEVELS: DetectiveRank[] = [
  { level: 1, name: '駆け出し探偵', en: 'ROOKIE', min: 1, stars: 0 },
  { level: 2, name: '一人前の探偵', en: 'FULL-FLEDGED', min: 80, stars: 0 },
  { level: 3, name: '所見を読む探偵', en: 'READER', min: 180, stars: 0 },
  { level: 4, name: '腕利き探偵', en: 'ACE', min: 300, stars: 0 },
  { level: 5, name: '検死に通じた探偵', en: 'EXAMINER', min: 450, stars: 0 },
  { level: 6, name: '審問の切れ者', en: 'SHARP', min: 630, stars: 0 },
  { level: 7, name: '名探偵', en: 'MASTER', min: 850, stars: 0 },
  { level: 8, name: '死因を見抜く名探偵', en: 'SEER', min: 1150, stars: 0 },
  { level: 9, name: '名を還す名探偵', en: 'NAME-GIVER', min: 1550, stars: 0 },
  { level: 10, name: '零番安置室の名探偵', en: 'ROOM ZERO', min: 2000, stars: 0 },
  { level: 11, name: '伝説の名探偵', en: 'LEGEND', min: 2500, stars: 0 },
];

/** After the top named level, one more ★ (and one more level) every this many points. */
export const LEGEND_STAR_STEP = 500;

export const NO_DETECTIVE_RANK: DetectiveRank = { level: 0, name: 'まだ称号なし', en: 'UNRANKED', min: 0, stars: 0 };

const TOP_RANK = DETECTIVE_LEVELS[DETECTIVE_LEVELS.length - 1];
/** The highest named level (伝説の名探偵); levels above it are its ★ tail. */
export const TOP_DETECTIVE_LEVEL = TOP_RANK.level;

/** The rank at a level: a named one, or the ★ tail above the top (Lv12 = 伝説の名探偵 ★2 …). */
export function detectiveRank(level: number): DetectiveRank {
  const lv = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
  if (lv === 0) return NO_DETECTIVE_RANK;
  if (lv <= TOP_RANK.level) return DETECTIVE_LEVELS[lv - 1];
  const stars = lv - TOP_RANK.level + 1;
  return { level: lv, name: `${TOP_RANK.name} ★${stars}`, en: `${TOP_RANK.en} ★${stars}`, min: TOP_RANK.min + (lv - TOP_RANK.level) * LEGEND_STAR_STEP, stars };
}

/** The badge colour tier of a level (0..TOP_DETECTIVE_LEVEL): the ★ tail keeps the top tier. */
export function detectiveTier(level: number): number {
  return Math.max(0, Math.min(TOP_RANK.level, Math.floor(Number.isFinite(level) ? level : 0)));
}

export interface DetectiveLevel extends DetectiveRank {
  total: number;
  /** The next badge — there is always one: past the top named level the ★ tail goes on. */
  next: DetectiveRank;
  /** Points still needed for the next badge. */
  toNext: number;
  /** 0..1 progress from this badge's threshold to the next one. */
  progress: number;
}

export function detectiveLevel(total: number): DetectiveLevel {
  const t = Math.round(num(total));
  let cur = NO_DETECTIVE_RANK;
  for (const l of DETECTIVE_LEVELS) if (t >= l.min) cur = l;
  if (cur === TOP_RANK) cur = detectiveRank(TOP_RANK.level + Math.floor((t - TOP_RANK.min) / LEGEND_STAR_STEP));
  const next = detectiveRank(cur.level + 1);
  const span = next.min - cur.min;
  return {
    ...cur,
    total: t,
    next,
    toNext: next.min - t,
    progress: Math.min(1, Math.max(0, (t - cur.min) / span)),
  };
}
