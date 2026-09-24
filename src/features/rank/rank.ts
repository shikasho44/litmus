/**
 * 審問官ランク (design bible §3-6) — a pure, unit-tested scoring function.
 *
 * The score is deliberately NOT the star of the result screen: it starts at 100 and loses
 * points for the things the bible lists (question count vs. par, key-question rate, hints,
 * noise-break misses, begging for evidence, verdict retries, suspensions, time). Pars and
 * penalty sizes scale with the case difficulty (1..3), so a hard case forgives more.
 *
 *   S ≥ 88 (and no hints / no grants) · A ≥ 70 · B ≥ 50 · C otherwise
 *
 * Each rank comes with a one-line title in Holma's voice, chosen by the run's most telling
 * trait (e.g. no misses → 「ためらわぬ弾丸」, hints used → 「囁きに耳を貸す者」).
 */
import type { Rank } from '../../state/types';

export interface RankInput {
  /** Case difficulty 1..3 (clamped). */
  difficulty: number;
  /** Questions the server counted (ProgressSnapshot.asked). */
  asked: number;
  /** Answers that unlocked at least one finding. */
  keyQuestions: number;
  /** Answers in the log — the denominator of the key-question rate. 0 = unknown (no penalty). */
  answered: number;
  hintsUsed: number;
  /** Noise-break misses in the inquest. */
  debateMisses: number;
  /** 「ホルマに泣きつく」 count. */
  grants: number;
  /** Verdict (死因宣告) submissions, including the correct one. */
  verdictAttempts: number;
  /** Inquest suspensions (composure hit 0). */
  suspensions?: number;
  elapsedMs: number;
  /** The case's estimated play time; defaults to 10 + 5 × difficulty minutes. */
  estimatedMinutes?: number;
}

export type PenaltyId = 'questions' | 'keyRate' | 'hints' | 'misses' | 'grants' | 'verdict' | 'suspensions' | 'time';

export interface Penalty {
  id: PenaltyId;
  label: string;
  points: number;
}

export interface RankTitle {
  id: string;
  rank: Rank;
  title: string;
  /** Holma's one-liner under the title. */
  comment: string;
}

export interface RankResult {
  rank: Rank;
  /** 0..100 (rounded). */
  score: number;
  title: string;
  titleId: string;
  comment: string;
  /** keyQuestions / answered, or null when unknown. */
  keyRate: number | null;
  /** Question par for this difficulty. */
  par: number;
  penalties: Penalty[];
}

export const RANK_THRESHOLDS: Record<Exclude<Rank, 'C'>, number> = { S: 88, A: 70, B: 50 };

export const RANK_LABEL: Record<Rank, { jp: string; en: string }> = {
  S: { jp: '特級審問官', en: 'SUPREME' },
  A: { jp: '上級審問官', en: 'EXCELLENT' },
  B: { jp: '審問官', en: 'GOOD' },
  C: { jp: '見習い審問官', en: 'APPRENTICE' },
};

/** All titles (12). Order inside a rank = priority when several apply; the last one is the default. */
export const RANK_TITLES: RankTitle[] = [
  { id: 'one-shot', rank: 'S', title: '一撃の審問官', comment: '迷いのない一撃。……少々、つまらないくらいですねェ。' },
  { id: 'silent', rank: 'S', title: '寡黙な解剖医', comment: '言葉少なに、急所だけを。お見事ですとも。' },
  { id: 'ace', rank: 'S', title: '零番の切り札', comment: 'この部屋の切り札は、どうやらあなたのようで。' },
  { id: 'probe', rank: 'A', title: '鋭利なプローブ', comment: '訊くたびに、何かを掘り当てる。良い指先です。' },
  { id: 'unwavering', rank: 'A', title: 'ためらわぬ弾丸', comment: 'ノイズを撃ち抜く手に、震えはありませんでしたねェ。' },
  { id: 'observer', rank: 'A', title: '慎重な観察者', comment: '石橋を叩いて、叩いて、渡る。嫌いではありませんよ。' },
  { id: 'whisper', rank: 'B', title: '囁きに耳を貸す者', comment: '私の囁き、お役に立ちましたか？　クックック。' },
  { id: 'tenacious', rank: 'B', title: '粘り強い書記官', comment: '何度でも言い直す。その粘り、記録しておきますとも。' },
  { id: 'detour', rank: 'B', title: '遠回りの名探偵', comment: '遠回りも、道には違いありません。景色は良かったでしょう？' },
  { id: 'regular', rank: 'C', title: 'ホルマの常連客', comment: '泣きつかれるのは、嫌いじゃありませんよ？' },
  { id: 'night-owl', rank: 'C', title: '夜更かしの審問官', comment: '夜はまだ長い。……ええ、実に長かったですねェ。' },
  { id: 'rookie', rank: 'C', title: '迷える新任', comment: '最初は誰でも迷うもの。それでも彼女は、名前を取り戻しましたよ。' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Question par: how many questions a sharp player needs. Grows with difficulty. */
export function questionPar(difficulty: number): number {
  const d = clamp(Math.round(n(difficulty)) || 1, 1, 3);
  return 14 + 8 * d; // 22 / 30 / 38
}

/** Target key-question rate (a hard case has more dead ends). */
export function keyRateTarget(difficulty: number): number {
  const d = clamp(Math.round(n(difficulty)) || 1, 1, 3);
  return 0.5 - 0.05 * (d - 1); // .50 / .45 / .40
}

export function computeRank(input: RankInput): RankResult {
  const d = clamp(Math.round(n(input.difficulty)) || 1, 1, 3);
  const asked = n(input.asked);
  const answered = n(input.answered);
  const key = Math.min(n(input.keyQuestions), answered || Infinity);
  const hints = n(input.hintsUsed);
  const misses = n(input.debateMisses);
  const grants = n(input.grants);
  const verdicts = Math.max(1, n(input.verdictAttempts));
  const suspensions = n(input.suspensions);
  const minutes = n(input.elapsedMs) / 60000;
  const est = n(input.estimatedMinutes) || 10 + 5 * d;
  const par = questionPar(d);
  const keyRate = answered > 0 ? key / answered : null;
  const target = keyRateTarget(d);

  const penalties: Penalty[] = [];
  const add = (id: PenaltyId, label: string, points: number) => {
    const p = Math.round(points * 10) / 10;
    if (p > 0) penalties.push({ id, label, points: p });
  };

  add('questions', '質問の多さ', Math.min(24, Math.max(0, asked - par) * 0.6));
  if (keyRate !== null) add('keyRate', '空振りの質問', Math.min(20, Math.max(0, target - keyRate) * 50));
  add('hints', 'ホルマの囁き', hints * (9 - d)); // 8 / 7 / 6 per hint
  add('misses', 'ノイズ・ブレイクの失敗', Math.min(20, misses * (4.5 - 0.5 * d))); // 4 / 3.5 / 3
  add('grants', '泣きつき', grants * (11 - d)); // 10 / 9 / 8
  add('verdict', '死因宣告のやり直し', Math.min(24, (verdicts - 1) * (7 - d * 0.5 - 0.5))); // 6 / 5.5 / 5
  add('suspensions', '審問の中断', suspensions * 5);
  add('time', '所要時間', Math.min(8, Math.max(0, minutes - est * 2) * 0.5));

  const total = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.round(clamp(100 - total, 0, 100));

  let rank: Rank;
  if (score >= RANK_THRESHOLDS.S && hints === 0 && grants === 0) rank = 'S';
  else if (score >= RANK_THRESHOLDS.A) rank = 'A';
  else if (score >= RANK_THRESHOLDS.B) rank = 'B';
  else rank = 'C';

  const pts = (id: PenaltyId) => penalties.find((p) => p.id === id)?.points ?? 0;
  const worst = [...penalties].sort((a, b) => b.points - a.points)[0]?.id;

  const pick = (): string => {
    switch (rank) {
      case 'S':
        if (verdicts === 1 && misses === 0) return 'one-shot';
        if (asked > 0 && asked <= par * 0.7) return 'silent';
        return 'ace';
      case 'A':
        if (keyRate !== null && keyRate >= target + 0.1) return 'probe';
        if (misses === 0) return 'unwavering';
        return 'observer';
      case 'B':
        if (worst === 'hints' || (hints > 0 && pts('hints') >= pts('questions'))) return 'whisper';
        if (worst === 'verdict' || verdicts >= 3) return 'tenacious';
        return 'detour';
      default:
        if (grants > 0) return 'regular';
        if (pts('time') > 0 || worst === 'questions') return 'night-owl';
        return 'rookie';
    }
  };
  const t = RANK_TITLES.find((x) => x.id === pick())!;
  return { rank, score, title: t.title, titleId: t.id, comment: t.comment, keyRate, par, penalties };
}
