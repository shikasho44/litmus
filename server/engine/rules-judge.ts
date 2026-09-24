/**
 * Offline, deterministic judge. Used in 'rules' mode, as the fallback for every other
 * mode, as the prior passed to model judges, and by the validator's self-consistency check.
 *
 * Order of decisions:
 *   1. hard metas (empty / too long)
 *   2. a near-verbatim authored probe (≥ PROBE_OVERRIDE) — authored labels beat heuristics
 *   3. other metas (asks for the answer / a hint, small talk, about Holma, insults)
 *   4. an authored probe above PROBE_THRESHOLD (label flipped when negation differs)
 *   5. open wh-questions → 'vague' (please ask yes/no)   [before keywords on purpose:
 *      "何時に死んだ？" must not become "はい" because 時間 is a keyword]
 *   6. 「〜は関係ありますか」 relevance questions → 'yes' when the fact pointed at matters
 *      (importance ≥ 2), otherwise 'irrelevant' ('no' / 'irrelevant' for 「関係ないですよね」)
 *   7. keyword facts (most specific): compare the question's proposition with the fact's
 *      statement polarity; else fact.ifAsked (flipped for negated confirmations)
 *   8. a mid-similarity probe labelled 'irrelevant' → 'irrelevant'
 *   9. otherwise 'vague'
 */
import type { AnswerClass } from '../../shared/case-schema.js';
import { factPolarityFor, type CaseIndex } from './case-index.js';
import type { AnalyzedQuestion, MetaKind } from './normalize.js';
import { detectMeta } from './normalize.js';
import type { Candidates, ScoredProbe } from './retrieve.js';
import { retrieve } from './retrieve.js';
import type { Judge, JudgeDecision, JudgeInput } from './judge-types.js';

export const PROBE_THRESHOLD = 0.6;
export const PROBE_OVERRIDE = 0.9;
const IRRELEVANT_SOFT = 0.45;

const META_CLASS: Record<MetaKind, AnswerClass> = {
  askAnswer: 'cannot',
  askHint: 'cannot',
  offtopic: 'irrelevant',
  aboutHolma: 'irrelevant',
  rude: 'cannot',
  empty: 'vague',
  tooLong: 'vague',
};

export function flipAnswer(a: AnswerClass): AnswerClass {
  return a === 'yes' ? 'no' : a === 'no' ? 'yes' : a;
}

/** Closeness from the importance of the facts a yes/no/partial answer touched. */
export function closenessOf(answer: AnswerClass, factIds: string[], index: CaseIndex): 0 | 1 | 2 | 3 {
  if (answer !== 'yes' && answer !== 'no' && answer !== 'partial') return 0;
  let imp = 0;
  for (const id of factIds) imp = Math.max(imp, index.factById.get(id)?.fact.importance ?? 0);
  return imp >= 4 ? 3 : imp === 3 ? 2 : imp === 2 ? 1 : 0;
}

function fromProbe(best: ScoredProbe, index: CaseIndex): JudgeDecision {
  const p = best.entry.probe;
  let answerClass = p.answer;
  if (best.flip) answerClass = flipAnswer(answerClass);
  const factIds = p.facts.filter((id) => index.factById.has(id));
  const factStrength: Record<string, number> = {};
  for (const id of factIds) factStrength[id] = best.score;
  return {
    answerClass,
    factIds,
    confidence: best.score,
    closeness: closenessOf(answerClass, factIds, index),
    qtype: p.kind === 'meta' ? 'meta' : 'yesno',
    source: 'probe',
    factStrength,
    probe: { q: p.q, score: best.score, kind: p.kind, flipped: best.flip },
  };
}

function metaDecision(meta: MetaKind, best?: ScoredProbe): JudgeDecision {
  return {
    answerClass: META_CLASS[meta],
    factIds: [],
    confidence: 0.9,
    closeness: 0,
    qtype: 'meta',
    source: 'meta',
    meta,
    probe: best ? { q: best.entry.probe.q, score: best.score, kind: best.entry.probe.kind, flipped: best.flip } : undefined,
  };
}

export function judgeRules(q: AnalyzedQuestion, cand: Candidates, index: CaseIndex): JudgeDecision {
  const best = cand.probes[0];
  const keywordFacts = cand.facts.filter((f) => f.hits.length > 0);
  const meta = detectMeta(q.raw, q.norm, keywordFacts.length > 0);
  const probeInfo = best ? { q: best.entry.probe.q, score: best.score, kind: best.entry.probe.kind, flipped: best.flip } : undefined;

  if (meta === 'tooLong' || meta === 'empty') return metaDecision(meta, best);
  if (best && best.score >= PROBE_OVERRIDE && meta !== 'rude') return fromProbe(best, index);
  if (meta) return metaDecision(meta, best);
  if (best && best.score >= PROBE_THRESHOLD) return fromProbe(best, index);

  if (q.open) {
    return { answerClass: 'vague', factIds: [], confidence: 0.7, closeness: 0, qtype: 'open', source: 'open', meta: 'open', probe: probeInfo };
  }

  if (q.relevance) {
    const top = keywordFacts[0];
    const f = top?.entry.fact;
    // 「熱中症は関係ありますか」 against a ruled-out fact (ifAsked 'no') → いいえ.
    const ruledOut = !!f && f.ifAsked === 'no' && f.importance >= 1;
    const matters = !!f && (ruledOut || f.importance >= 2);
    const base: AnswerClass = !matters ? 'irrelevant' : ruledOut ? 'no' : f.ifAsked === 'partial' ? 'partial' : 'yes';
    const answerClass: AnswerClass = q.negated && matters ? flipAnswer(base) : base;
    return {
      answerClass,
      factIds: matters ? [f.id] : [],
      confidence: round(f ? 0.4 + 0.45 * top.keywordStrength : 0.55),
      closeness: matters ? closenessOf(answerClass, [f.id], index) : 0,
      qtype: 'yesno',
      source: 'keyword',
      meta: undefined,
      factStrength: matters ? { [f.id]: top.keywordStrength } : undefined,
      probe: probeInfo,
    };
  }

  if (keywordFacts.length > 0) {
    const top = pickKeywordFact(q, keywordFacts);
    const f = top.entry.fact;
    // Prefer comparing what the question proposes with what the fact states (in the clause that
    // holds the keyword); fall back to the author's topic polarity (ifAsked) otherwise.
    const fPol = factPolarityFor(top.entry, top.hits);
    const answerClass: AnswerClass =
      f.ifAsked !== 'partial' && q.prop.determinate && fPol
        ? q.prop.polarity === fPol ? 'yes' : 'no'
        : q.negated ? flipAnswer(f.ifAsked) : f.ifAsked;
    return {
      answerClass,
      factIds: [f.id],
      confidence: round(0.45 + 0.5 * top.keywordStrength),
      closeness: closenessOf(answerClass, [f.id], index),
      qtype: 'yesno',
      source: 'keyword',
      factStrength: { [f.id]: top.keywordStrength },
      probe: probeInfo,
    };
  }

  if (best && best.score >= IRRELEVANT_SOFT && best.entry.probe.answer === 'irrelevant') {
    return { answerClass: 'irrelevant', factIds: [], confidence: round(best.score * 0.8), closeness: 0, qtype: 'yesno', source: 'probe', probe: probeInfo };
  }

  return { answerClass: 'vague', factIds: [], confidence: 0.2, closeness: 0, qtype: 'unknown', source: 'fallback', probe: probeInfo };
}

const CAUSE_MARKER = /(?:のせい|が原因|が理由|のため|だから|のから|によって|のおかげ)/u;
/**
 * Most specific keyword fact. For causal questions (「胃の斑点は毒のせいですか」) the fact
 * named right before the causal marker is what is being asked about.
 */
function pickKeywordFact<T extends { hits: string[]; score: number }>(q: AnalyzedQuestion, facts: T[]): T {
  const m = CAUSE_MARKER.exec(q.norm);
  if (m) {
    let best: T | undefined;
    let bestEnd = -1;
    for (const f of facts) {
      for (const h of f.hits) {
        const at = q.norm.lastIndexOf(h, m.index);
        const end = at + h.length;
        if (at >= 0 && end <= m.index && end > bestEnd) {
          bestEnd = end;
          best = f;
        }
      }
    }
    if (best) return best;
  }
  return facts[0];
}

/** Judge-interface wrapper (so the pipeline can treat rules like any other judge). */
export class RulesJudge implements Judge {
  readonly name = 'rules';
  async judge(input: JudgeInput): Promise<JudgeDecision> {
    return input.rules ?? judgeRules(input.question, input.candidates, input.index);
  }
}

/** Convenience for scripts/tests: analyse + retrieve + judge in one go. */
export function judgeText(q: AnalyzedQuestion, index: CaseIndex): JudgeDecision {
  return judgeRules(q, retrieve(q, index), index);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
