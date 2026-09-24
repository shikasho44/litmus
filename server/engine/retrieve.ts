/**
 * Candidate retrieval: which facts and which authored probe questions a player's
 * question is most likely about. Deterministic and cheap (runs on every turn, and
 * feeds both the rules judge and the model judges as context).
 */
import type { AnalyzedQuestion } from './normalize.js';
import { bigrams, comparableFamilies, containment, dice } from './normalize.js';
import type { CaseIndex, IndexedFact, IndexedProbe } from './case-index.js';

export interface ScoredFact {
  id: string;
  score: number;
  /** Keyword-only strength (0..1). 0 when no keyword matched. */
  keywordStrength: number;
  /** Normalised keywords that matched (longest-match, overlaps removed). */
  hits: string[];
  entry: IndexedFact;
}

export interface ScoredProbe {
  score: number;
  /** True when the question proposes the opposite of the probe (label must be flipped). */
  flip: boolean;
  entry: IndexedProbe;
}

export interface Candidates {
  facts: ScoredFact[];
  probes: ScoredProbe[];
}

export const TOP_FACTS = 8;
export const TOP_PROBES = 5;

const HAN = /\p{Script=Han}/u;

/** Weight of a single keyword hit by its normalised length. */
export function keywordWeight(k: string): number {
  const len = [...k].length;
  if (len === 1) return HAN.test(k) ? 0.5 : 0.25;
  return Math.min(0.9, 0.35 + 0.15 * len);
}

/** Keyword hits of `fact` in the normalised question (longest-match; nested hits removed). */
export function keywordHits(norm: string, fact: IndexedFact): string[] {
  const raw = fact.keywords.filter((k) => {
    const len = [...k].length;
    if (len === 1 && !HAN.test(k)) return norm === k; // single kana/latin only as the whole question
    return norm.includes(k);
  });
  // Drop hits contained in a longer hit (酸素 inside 酸素濃度).
  return raw.filter((k) => !raw.some((o) => o !== k && o.length > k.length && o.includes(k)));
}

export function keywordStrength(hits: string[]): number {
  let miss = 1;
  for (const k of hits) miss *= 1 - keywordWeight(k);
  return hits.length === 0 ? 0 : 1 - miss;
}

export function scoreFacts(q: AnalyzedQuestion, index: CaseIndex, limit = TOP_FACTS): ScoredFact[] {
  const qGrams = bigrams(q.core);
  const out: ScoredFact[] = [];
  for (const entry of index.facts) {
    const hits = keywordHits(q.norm, entry);
    const ks = keywordStrength(hits);
    const overlap = containment(qGrams, entry.grams);
    const score = ks + 0.5 * overlap;
    if (hits.length > 0 || overlap >= 0.34) out.push({ id: entry.fact.id, score: round(score), keywordStrength: round(ks), hits, entry });
  }
  out.sort((a, b) => b.score - a.score || b.keywordStrength - a.keywordStrength || a.entry.fact.spoilerLevel - b.entry.fact.spoilerLevel);
  return out.slice(0, limit);
}

/**
 * Probe similarity: bigram Dice on the core forms, with penalties for a different question
 * shape and — importantly — for a different case content word. Char similarity alone would
 * match 「一酸化炭素のせい？」 to the probe 「二酸化炭素のせいですか」 (0.86); when the two
 * texts do not share the same case keywords the keyword route is safer.
 */
export const CONTENT_MISMATCH_PENALTY = 0.65;

export function scoreProbes(q: AnalyzedQuestion, probes: IndexedProbe[], limit = TOP_PROBES, contentWords: readonly string[] = []): ScoredProbe[] {
  const qGrams = bigrams(q.core);
  const qWords = contentWords.filter((w) => q.norm.includes(w));
  const out: ScoredProbe[] = [];
  for (const entry of probes) {
    let s = q.core === entry.core ? 1 : dice(qGrams, entry.grams);
    if (s <= 0) continue;
    // Opposite propositions (「なかったですよね」 vs 「ありましたか」, 「回って」 vs 「止まって」):
    // same topic, the authored label must be flipped. Predicates on different axes
    // (「壊れていた」 vs 「止まっていた」) are not opposites — they are different questions.
    const crossAxis = !comparableFamilies(q.prop.family, entry.prop.family);
    const flip = !crossAxis && q.prop.polarity !== entry.prop.polarity;
    if (flip) s *= 0.95;
    if (crossAxis) s *= 0.85;
    if (q.open !== entry.open) s *= 0.9;
    if (s < 1 && (qWords.some((w) => !entry.norm.includes(w)) || entry.keywords.some((w) => !q.norm.includes(w)))) s *= CONTENT_MISMATCH_PENALTY;
    out.push({ score: round(s), flip, entry });
  }
  out.sort((a, b) => b.score - a.score || a.entry.index - b.entry.index);
  return out.slice(0, limit);
}

export function retrieve(q: AnalyzedQuestion, index: CaseIndex): Candidates {
  return { facts: scoreFacts(q, index), probes: scoreProbes(q, index.probes, TOP_PROBES, index.contentWords) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
