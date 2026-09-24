/**
 * Cause-of-death verdict (死因宣告). Rules keyword groups on the normalised text, merged
 * with optional VerdictJudge probabilities. Never reveals the answer: feedback comes from
 * the line bank and each missing element's authored `missingFeedback`.
 *
 *   correct  all solveRule.required matched and no wrong claim
 *   almost   all solveRule.almost matched
 *   missing  ≥ 1 answer element matched
 *   wrong    nothing matched
 */
import type { Case } from '../../shared/case-schema.js';
import type { VerdictResult } from '../../shared/api.js';
import type { RulesVerdict, VerdictJudgeOutput } from './judge-types.js';
import { containsAffirmed, normalize } from './normalize.js';

export const ELEMENT_PROB = 0.7;
export const WRONG_PROB = 0.7;

const SENTENCE_SPLIT = /[。．.！!？?\n\r；;]+/u;
const CLAUSE_SPLIT = /[、，,：:・\s]+/u;
const B = '｜'; // clause boundary kept in the normalised text so words never match across clauses
/**
 * Sentence-level negation / misbelief markers. A wrong claim mentioned in such a sentence
 * (「毒物は検出されなかった」「熱中症と思われたが」「殺人ではなく事故」) is not held
 * against the player. Deliberately lenient: a false "negated" only matters when every
 * required element already matched.
 */
const NEGATED_SENTENCE = /(?:な(?:い|く|かった|かっ|し|さそう)|ず(?:に|｜|$)|ません|無(?:い|く|し)|否定|違(?:う|い|っ)|ちが(?:う|い|っ)|誤(?:り|解|認)|勘違い|思い込|と思われ|と思っ|と疑|と見られ|ではなく|じゃなく|除外|関係な|無関係|とは限らな|わけではな|ありえな|あり得な)/u;

export interface PreparedVerdict {
  /** Whole text, normalised, clauses separated by ｜. */
  joined: string;
  sentences: { norm: string; negated: boolean }[];
}

export function prepareVerdictText(text: string): PreparedVerdict {
  const sentences = text
    .split(SENTENCE_SPLIT)
    .map((s) => s.split(CLAUSE_SPLIT).map(normalize).filter(Boolean).join(B))
    .filter(Boolean)
    .map((norm) => ({ norm, negated: NEGATED_SENTENCE.test(norm) }));
  return { joined: sentences.map((s) => s.norm).join(B), sentences };
}

export function rulesVerdict(c: Case, text: string | PreparedVerdict): RulesVerdict {
  const p = typeof text === 'string' ? prepareVerdictText(text) : text;
  const has = (w: string) => {
    const n = normalize(w);
    return !n || p.joined.includes(n);
  };
  const affirmed = (w: string) => {
    const n = normalize(w);
    return !n || p.sentences.some((s) => !s.negated && containsAffirmed(s.norm, n));
  };
  const elements: Record<string, boolean> = {};
  for (const el of c.answerElements) elements[el.id] = el.keywordGroups.some((g) => g.every(has));
  const wrongClaims: Record<string, boolean> = {};
  for (const w of c.wrongClaims) wrongClaims[w.id] = w.keywordGroups.some((g) => g.every(affirmed));
  return { elements, wrongClaims };
}

export interface VerdictEvaluation {
  result: VerdictResult;
  matched: string[];
  wrongClaims: string[];
  missing: string[];
  rules: RulesVerdict;
  model?: { elements: Record<string, number>; wrongClaims: Record<string, number> };
}

export function evaluateVerdict(c: Case, text: string, model?: VerdictJudgeOutput): VerdictEvaluation {
  const rules = rulesVerdict(c, prepareVerdictText(text));
  const matched = c.answerElements
    .filter((el) => rules.elements[el.id] || (model?.elements[el.id] ?? 0) >= ELEMENT_PROB)
    .map((el) => el.id);
  const wrongClaims = c.wrongClaims
    .filter((w) => {
      const p = model?.wrongClaims[w.id];
      return p === undefined ? rules.wrongClaims[w.id] : p >= WRONG_PROB || (rules.wrongClaims[w.id] && p >= 0.4);
    })
    .map((w) => w.id);
  const has = new Set(matched);
  const allRequired = c.solveRule.required.every((id) => has.has(id));
  const allAlmost = c.solveRule.almost.every((id) => has.has(id));
  let result: VerdictResult;
  if (allRequired && wrongClaims.length === 0) result = 'correct';
  else if (allAlmost) result = 'almost';
  else if (matched.length > 0) result = 'missing';
  else result = 'wrong';
  const missing = c.answerElements.filter((el) => !has.has(el.id) && (el.required || c.solveRule.required.includes(el.id))).map((el) => el.id);
  return {
    result,
    matched: result === 'wrong' ? [] : matched,
    wrongClaims,
    missing,
    rules,
    model: model ? { elements: model.elements, wrongClaims: model.wrongClaims } : undefined,
  };
}
