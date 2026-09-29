/**
 * 審問官ランク (design bible §3-6) — a pure, unit-tested scoring function.
 *
 * The score is deliberately NOT the star of the result screen: it starts at 100 and loses
 * points for the things the bible lists (question count vs. par, key-question rate, hints,
 * noise-break misses, begging for evidence, verdict retries, suspensions, time) plus, since
 * 2026-09-27, game overs during the run and recall-test retries (くられ先生: a mistake must be
 * felt). Pars and most penalty sizes scale with the case difficulty (1..3), so a hard case
 * forgives more. The count-based penalties are one table (PENALTY_RULES) so the in-play
 * 「減点 −n」 feedback (penaltyStep) always matches what the result will charge.
 *
 * Questions (2026-09-28, shared/budget.ts): the run's question budget (質問枠, per case and play
 * difficulty) is the par, and every counted question beyond it costs `overCost` points (見習い 0,
 * 審問官 1.5, cap 24). A stored result without those fields is scored the old way (par
 * 22/30/38 by case difficulty, every question 0.6 beyond it) so older records still explain.
 *
 *   S ≥ 88 (and no hints / no grants) · A ≥ 70 · B ≥ 50 · C otherwise
 *   S+ = S, and every 反証 round of the case cleared with the player's own findings (none
 *        skipped — 反証 is optional — and no begging Holma for evidence)
 *
 * Each rank comes with a one-line title in Holma's voice, chosen by the run's most telling
 * trait (e.g. no misses → 「ためらわぬ指先」, hints used → 「囁きに耳を貸す者」).
 */
import type { Rank } from '../../state/types';
import { casePar, overBudgetPoints } from '../../../shared/budget';

export interface RankInput {
  /** Case difficulty 1..3 (clamped). */
  difficulty: number;
  /** Questions the server counted (ProgressSnapshot.asked). */
  asked: number;
  /** Questions counted against the budget (ProgressSnapshot.spent). Default: `asked`. */
  spent?: number;
  /** The run's question budget (shared/budget.ts questionBudget). Default: questionPar(difficulty). */
  budget?: number;
  /** Points per counted question beyond the budget (default 0.6, the rule before 2026-09-28) and their cap (default 24). */
  overCost?: number;
  overCap?: number;
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
  /** Game overs during this run (CaseProgress.gameOvers since the last clear). */
  gameOvers?: number;
  /** Recall-test (確認テスト) wrong picks. */
  quizMisses?: number;
  elapsedMs: number;
  /** The case's estimated play time; defaults to 10 + 5 × difficulty minutes. */
  estimatedMinutes?: number;
  /** 反証 (debate) rounds of the case (0 / unknown = no S+). */
  debateRounds?: number;
  /** Rounds the player cleared (skipped ones are not). */
  debateCleared?: number;
}

export type PenaltyId = 'questions' | 'keyRate' | 'hints' | 'misses' | 'grants' | 'verdict' | 'suspensions' | 'gameOvers' | 'quiz' | 'time';

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
  /** Question par for this case difficulty. */
  par: number;
  /** The question budget the run was scored against (= par for older records). */
  budget: number;
  penalties: Penalty[];
}

export const RANK_THRESHOLDS: Record<Exclude<Rank, 'C' | 'S+'>, number> = { S: 88, A: 70, B: 50 };

export const RANK_LABEL: Record<Rank, { jp: string; en: string }> = {
  'S+': { jp: '至高の審問官', en: 'PERFECT' },
  S: { jp: '特級審問官', en: 'SUPREME' },
  A: { jp: '上級審問官', en: 'EXCELLENT' },
  B: { jp: '審問官', en: 'GOOD' },
  C: { jp: '見習い審問官', en: 'APPRENTICE' },
};

/** All titles (13). Order inside a rank = priority when several apply; the last one is the default. */
export const RANK_TITLES: RankTitle[] = [
  { id: 'flawless', rank: 'S+', title: '完全無欠の審問官', comment: 'すべての記憶を、ご自分の所見で。……私の出番は、ありませんでしたねェ。' },
  { id: 'one-shot', rank: 'S', title: '誤差ゼロの審問官', comment: '誤差なし、迷いなし。……少々、つまらないくらいですねェ。' },
  { id: 'silent', rank: 'S', title: '寡黙な解剖医', comment: '言葉少なに、急所だけを。お見事ですとも。' },
  { id: 'ace', rank: 'S', title: '零番の切り札', comment: 'この部屋の切り札は、どうやらあなたのようで。' },
  { id: 'probe', rank: 'A', title: '鋭利なプローブ', comment: '訊くたびに、何かを掘り当てる。良い指先です。' },
  { id: 'unwavering', rank: 'A', title: 'ためらわぬ指先', comment: '誤差に所見を当てる指先に、震えはありませんでしたねェ。' },
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
  return casePar(clamp(Math.round(n(difficulty)) || 1, 1, 3)); // 22 / 30 / 38
}

/** Legacy question rule (records from before the question budget). */
const LEGACY_OVER_COST = 0.6;
const LEGACY_OVER_CAP = 24;

/** The question budget, cost and count a rank input is scored with (defaults = the legacy rule). */
export function questionTerms(input: Pick<RankInput, 'difficulty' | 'asked' | 'spent' | 'budget' | 'overCost' | 'overCap'>) {
  const d = clamp(Math.round(n(input.difficulty)) || 1, 1, 3);
  const spent = input.spent === undefined ? n(input.asked) : n(input.spent);
  const budget = n(input.budget) || questionPar(d);
  const overCost = input.overCost === undefined ? LEGACY_OVER_COST : n(input.overCost);
  const overCap = input.overCap === undefined ? LEGACY_OVER_CAP : n(input.overCap);
  return { spent, budget, overCost, overCap, legacy: input.budget === undefined };
}

/** Target key-question rate (a hard case has more dead ends). */
export function keyRateTarget(difficulty: number): number {
  const d = clamp(Math.round(n(difficulty)) || 1, 1, 3);
  return 0.5 - 0.05 * (d - 1); // .50 / .45 / .40
}

/** 「寡黙な解剖医」: counted questions ≤ this share of min(par, the run's 質問枠). */
export const SILENT_SHARE = 0.7;

/**
 * Distinctions a run earns beside its rank title (they never change the score). 2026-09-29:
 * solved without using any 質問の例 card — waiting for cards is the only cost of using them, so
 * not using them is honoured instead of using them being punished.
 */
export interface RunDistinction {
  id: string;
  title: string;
  /** What it was earned for (shown under the name). */
  note: string;
  /** Holma's aside. */
  comment: string;
}

export const RUN_DISTINCTIONS: RunDistinction[] = [
  { id: 'own-words', title: '素手の審問官', note: '質問の例を一枚も使わずに解決', comment: '札には一度も手を伸ばさずに。問いまで自前とは、恐れ入りますねェ。' },
];

/** The distinctions of a stored run (`stats.examplesUsed` is absent in records from before the cards). */
export function runDistinctions(stats: Record<string, number> | undefined): RunDistinction[] {
  return stats?.examplesUsed === 0 ? RUN_DISTINCTIONS.filter((d) => d.id === 'own-words') : [];
}

/** Titles renamed on 2026-09-29 (the 反証 wording): saves keep the old text, the screen shows the new name. */
const LEGACY_TITLE_IDS: Record<string, string> = { 一撃の審問官: 'one-shot', ためらわぬ弾丸: 'unwavering' };

/** The title a stored result names — by its text, or by its old text from before a rename. */
export function rankTitleOf(text: string | undefined): RankTitle | undefined {
  if (!text) return undefined;
  const id = LEGACY_TITLE_IDS[text];
  return RANK_TITLES.find((t) => t.title === text || (id && t.id === id));
}

/** The penalties that grow with a count of events (hint used, shot missed, …). */
export type CountPenaltyId = 'hints' | 'misses' | 'grants' | 'verdict' | 'suspensions' | 'gameOvers' | 'quiz';

/**
 * Points per event and cap, by case difficulty d (1..3). `verdict` counts RETRIES (attempts − 1).
 * One table for computeRank and the in-play feedback (penaltyStep).
 */
export const PENALTY_RULES: Record<CountPenaltyId, { label: string; per: (d: number) => number; cap?: number }> = {
  hints: { label: 'ホルマの囁き', per: (d) => 9 - d }, // 8 / 7 / 6 per hint
  misses: { label: '反証の反応なし', per: (d) => 4.5 - 0.5 * d, cap: 20 }, // 4 / 3.5 / 3
  grants: { label: '泣きつき', per: (d) => 11 - d }, // 10 / 9 / 8
  verdict: { label: '死因宣告のやり直し', per: (d) => 7 - d * 0.5 - 0.5, cap: 24 }, // 6 / 5.5 / 5
  suspensions: { label: '審問の中断', per: () => 5 },
  gameOvers: { label: 'ゲームオーバー', per: () => 12, cap: 36 },
  quiz: { label: '確認テストのやり直し', per: () => 2, cap: 8 },
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const caseDiff = (difficulty: number) => clamp(Math.round(n(difficulty)) || 1, 1, 3);

/** The points a count-based penalty costs at `count` events (rounded to 0.1, as computeRank charges it). */
export function penaltyPoints(id: CountPenaltyId, count: number, difficulty: number): number {
  const rule = PENALTY_RULES[id];
  const raw = n(count) * rule.per(caseDiff(difficulty));
  return round1(rule.cap === undefined ? raw : Math.min(rule.cap, raw));
}

/**
 * What ONE more event costs right now: the marginal penalty after `before` events (0 once the
 * cap is reached). Drives the 「減点 −n」 float during play.
 */
export function penaltyStep(id: CountPenaltyId, before: number, difficulty: number, by = 1): number {
  const b = Math.floor(n(before));
  return round1(Math.max(0, penaltyPoints(id, b + by, difficulty) - penaltyPoints(id, b, difficulty)));
}

/** 3.5 → "3.5", 6 → "6" (for 「減点 −n」). */
export const formatPenalty = (points: number) => (Number.isInteger(round1(points)) ? String(round1(points)) : round1(points).toFixed(1));

export function computeRank(input: RankInput): RankResult {
  const d = clamp(Math.round(n(input.difficulty)) || 1, 1, 3);
  const answered = n(input.answered);
  const key = Math.min(n(input.keyQuestions), answered || Infinity);
  const hints = n(input.hintsUsed);
  const misses = n(input.debateMisses);
  const grants = n(input.grants);
  const verdicts = Math.max(1, n(input.verdictAttempts));
  const suspensions = n(input.suspensions);
  const gameOvers = n(input.gameOvers);
  const quizMisses = n(input.quizMisses);
  const minutes = n(input.elapsedMs) / 60000;
  const est = n(input.estimatedMinutes) || 10 + 5 * d;
  const par = questionPar(d);
  const q = questionTerms(input);
  const keyRate = answered > 0 ? key / answered : null;
  const target = keyRateTarget(d);

  const penalties: Penalty[] = [];
  const add = (id: PenaltyId, label: string, points: number) => {
    const p = Math.round(points * 10) / 10;
    if (p > 0) penalties.push({ id, label, points: p });
  };

  const counted = (id: CountPenaltyId, count: number) => add(id, PENALTY_RULES[id].label, penaltyPoints(id, count, d));
  add('questions', '質問の多さ', overBudgetPoints(q.spent, q.budget, q.overCost, q.overCap));
  if (keyRate !== null) add('keyRate', '空振りの質問', Math.min(20, Math.max(0, target - keyRate) * 50));
  counted('hints', hints);
  counted('misses', misses);
  counted('grants', grants);
  counted('verdict', verdicts - 1);
  counted('suspensions', suspensions);
  counted('gameOvers', gameOvers);
  counted('quiz', quizMisses);
  add('time', '所要時間', Math.min(8, Math.max(0, minutes - est * 2) * 0.5));

  const total = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.round(clamp(100 - total, 0, 100));

  let rank: Rank;
  if (score >= RANK_THRESHOLDS.S && hints === 0 && grants === 0) rank = allRoundsCleared(input) ? 'S+' : 'S';
  else if (score >= RANK_THRESHOLDS.A) rank = 'A';
  else if (score >= RANK_THRESHOLDS.B) rank = 'B';
  else rank = 'C';

  const pts = (id: PenaltyId) => penalties.find((p) => p.id === id)?.points ?? 0;
  const worst = [...penalties].sort((a, b) => b.points - a.points)[0]?.id;

  const pick = (): string => {
    switch (rank) {
      case 'S+':
        return 'flawless';
      case 'S':
        if (verdicts === 1 && misses === 0) return 'one-shot';
        // 寡黙: at most 70 % of the smaller of the case's par and the run's 質問枠 (2026-09-29: the
        // budgets shrank, so a quiet run is measured against the tighter of the two)
        if (q.spent > 0 && q.spent <= Math.min(par, q.budget) * SILENT_SHARE) return 'silent';
        return 'ace';
      case 'A':
        if (keyRate !== null && keyRate >= target + 0.1) return 'probe';
        if (misses === 0) return 'unwavering';
        return 'observer';
      case 'B':
        if (worst === 'hints' || (hints > 0 && pts('hints') >= pts('questions'))) return 'whisper';
        if (worst === 'verdict' || worst === 'gameOvers' || verdicts >= 3) return 'tenacious';
        return 'detour';
      default:
        if (grants > 0) return 'regular';
        if (pts('time') > 0 || worst === 'questions') return 'night-owl';
        return 'rookie';
    }
  };
  const t = RANK_TITLES.find((x) => x.id === pick())!;
  return { rank, score, title: t.title, titleId: t.id, comment: t.comment, keyRate, par, budget: q.budget, penalties };
}

/** Every noise-break round cleared by shooting (none skipped). Unknown round count → false. */
export function allRoundsCleared(input: Pick<RankInput, 'debateRounds' | 'debateCleared' | 'grants'>): boolean {
  const rounds = n(input.debateRounds);
  return rounds > 0 && n(input.debateCleared) >= rounds && n(input.grants) === 0;
}

/* ------------------------------------------------------------------ */
/* What cost the rank (result screen, in Holma's voice)                */
/* ------------------------------------------------------------------ */

export interface RankAdvice {
  /** Holma's one-liner: what stood between this run and the next rank up (or a nod for a clean S). */
  line: string;
  /** The rank the line talks about (undefined for S). */
  target?: Rank;
  /** The 1–2 penalties the line names, heaviest first (label with the player's count). */
  blockers: { id: PenaltyId; text: string; points: number }[];
  /** How S is earned, in one short sentence. */
  sCondition: string;
}

const RANK_ORDER: Rank[] = ['S+', 'S', 'A', 'B', 'C'];
const better = (a: Rank, b: Rank) => RANK_ORDER.indexOf(a) < RANK_ORDER.indexOf(b);

/** The same run with one kind of penalty erased (used to test "without X you'd have had S"). */
function withoutPenalty(input: RankInput, id: PenaltyId): RankInput {
  const d = clamp(Math.round(n(input.difficulty)) || 1, 1, 3);
  const est = n(input.estimatedMinutes) || 10 + 5 * d;
  switch (id) {
    case 'questions': {
      const q = questionTerms(input);
      return { ...input, asked: Math.min(n(input.asked), q.budget), spent: Math.min(q.spent, q.budget) };
    }
    case 'keyRate':
      return { ...input, keyQuestions: Math.max(n(input.keyQuestions), Math.ceil(keyRateTarget(d) * n(input.answered))) };
    case 'hints':
      return { ...input, hintsUsed: 0 };
    case 'misses':
      return { ...input, debateMisses: 0 };
    case 'grants':
      return { ...input, grants: 0 };
    case 'verdict':
      return { ...input, verdictAttempts: 1 };
    case 'suspensions':
      return { ...input, suspensions: 0 };
    case 'gameOvers':
      return { ...input, gameOvers: 0 };
    case 'quiz':
      return { ...input, quizMisses: 0 };
    case 'time':
      return { ...input, elapsedMs: Math.min(n(input.elapsedMs), est * 2 * 60000) };
  }
}

/** 「囁き1回」「反応なし2回」… — the player's own numbers, not points. */
export function penaltyText(id: PenaltyId, input: RankInput): string {
  switch (id) {
    case 'questions': {
      const q = questionTerms(input);
      return `${q.legacy ? '目安' : '質問枠'}より${Math.max(1, Math.round(q.spent - q.budget))}問多い質問`;
    }
    case 'keyRate':
      return '空振りの質問';
    case 'hints':
      return `囁き${n(input.hintsUsed)}回`;
    case 'misses':
      return `反応なし${n(input.debateMisses)}回`;
    case 'grants':
      return `泣きつき${n(input.grants)}回`;
    case 'verdict':
      return `宣告のやり直し${Math.max(1, n(input.verdictAttempts) - 1)}回`;
    case 'suspensions':
      return `審問の中断${n(input.suspensions)}回`;
    case 'gameOvers':
      return `ゲームオーバー${n(input.gameOvers)}回`;
    case 'quiz':
      return `確認テストのやり直し${n(input.quizMisses)}回`;
    case 'time':
      return `長い夜（${Math.round(n(input.elapsedMs) / 60000)}分）`;
  }
}

export const S_CONDITION = `減点${100 - RANK_THRESHOLDS.S}点以内、囁きと泣きつきなし`;
export const S_PLUS_CONDITION = 'Sのうえ、反証を全部、自分の所見で成功させる';

/**
 * Names the 1–2 heaviest penalties whose removal would have lifted the run to S (or, when S
 * is out of reach, to the next rank up). Pure: recomputes the rank with each penalty erased.
 */
export function rankAdvice(input: RankInput, result: RankResult = computeRank(input)): RankAdvice {
  const sorted = [...result.penalties].sort((a, b) => b.points - a.points);
  const pack = (ids: PenaltyId[]) => ids.map((id) => ({ id, text: penaltyText(id, input), points: sorted.find((p) => p.id === id)?.points ?? 0 }));
  const join = (ids: PenaltyId[]) => ids.map((id) => penaltyText(id, input)).join('と');

  if (result.rank === 'S+') {
    if (!sorted.length) return { line: '減点なし、記憶はすべてご自分の手で。……完璧、ですねェ。', blockers: [], sCondition: S_CONDITION };
    return { line: `強いて言えば、${join([sorted[0].id])}。……贅沢な悩みですとも。`, blockers: pack([sorted[0].id]), sCondition: S_CONDITION };
  }
  if (result.rank === 'S') {
    if (n(input.debateRounds) > 0 && !allRoundsCleared(input))
      return { line: '反証を全部、ご自分の所見で成功させていれば、S+でしたねェ。', target: 'S+', blockers: [], sCondition: S_CONDITION };
    if (!sorted.length) return { line: '減点なし。……文句のつけようがありませんねェ。', blockers: [], sCondition: S_CONDITION };
    return { line: `強いて言えば、${join([sorted[0].id])}。……贅沢な悩みですとも。`, blockers: pack([sorted[0].id]), sCondition: S_CONDITION };
  }

  const reaches = (ids: PenaltyId[], target: Rank) => {
    const fixed = ids.reduce((inp, id) => withoutPenalty(inp, id), input);
    const r = computeRank(fixed).rank;
    // (S+ also needs every 反証 round: reaching S counts for the 'S' target either way)
    return r === target || better(r, target);
  };
  const find = (target: Rank): PenaltyId[] | null => {
    const top = sorted.slice(0, 4).map((p) => p.id);
    // S also needs no hints / grants: those are forced into the set when present
    const forced = target === 'S' ? top.filter((id) => id === 'hints' || id === 'grants') : [];
    for (const a of top) {
      const set = [...new Set([...forced, a])];
      if (set.length <= 2 && reaches(set, target)) return set;
    }
    for (let i = 0; i < top.length; i++)
      for (let j = i + 1; j < top.length; j++) {
        const set = [...new Set([...forced, top[i], top[j]])];
        if (set.length <= 2 && reaches(set, target)) return set;
      }
    return null;
  };

  const order = (ids: PenaltyId[]) => [...ids].sort((a, b) => (sorted.find((p) => p.id === b)?.points ?? 0) - (sorted.find((p) => p.id === a)?.points ?? 0));
  const toS = find('S');
  if (toS) return { line: `${join(order(toS))}がなければ、Sでしたねェ。`, target: 'S', blockers: pack(order(toS)), sCondition: S_CONDITION };
  const up = RANK_ORDER[RANK_ORDER.indexOf(result.rank) - 1];
  const toUp = up && up !== 'S' && up !== 'S+' ? find(up) : null;
  if (toUp) return { line: `${join(order(toUp))}がなければ、${up}でしたねェ。`, target: up, blockers: pack(order(toUp)), sCondition: S_CONDITION };
  const top2 = sorted.slice(0, 2).map((p) => p.id);
  if (!top2.length) return { line: 'もう少し、手際よく。……次は期待していますよ。', blockers: [], sCondition: S_CONDITION };
  return { line: `いちばん響いたのは、${join(top2)}。……次は期待していますよ。`, blockers: pack(top2), sCondition: S_CONDITION };
}
