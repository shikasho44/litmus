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
import { factPolarityFor, type CaseIndex, type IndexedFact } from './case-index.js';
import type { AnalyzedQuestion, MetaKind } from './normalize.js';
import { detectMeta } from './normalize.js';
import type { Candidates, ScoredFact, ScoredProbe } from './retrieve.js';
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

  const routed = keywordFacts.length > 0 ? pickKeywordFact(q, keywordFacts, index) : routeWithoutKeywords(q, index);
  if (routed) {
    const top = routed.fact;
    const f = top.entry.fact;
    // Prefer comparing what the question proposes with what the fact states (in the clause that
    // holds the keyword, on the same axis); fall back to the author's topic polarity (ifAsked).
    const fPol = routed.route === 'keyword' ? factPolarityFor(top.entry, top.hits, q.prop.family) : undefined;
    let answerClass: AnswerClass =
      f.ifAsked !== 'partial' && q.prop.determinate && fPol
        ? q.prop.polarity === fPol ? 'yes' : 'no'
        : q.negated || routed.denies ? flipAnswer(f.ifAsked) : f.ifAsked;
    // 「壊れていた？」 against a fact that says nothing about damage: if the thing was not working
    // (switched off, battery dead) it is partly so — it failed, but it was not broken; otherwise
    // it was intact (a case fact would say so if something had been broken).
    if (routed.route === 'keyword' && q.prop.determinate && q.prop.family === 'broken' && !fPol && f.ifAsked !== 'partial') {
      const working = factPolarityFor(top.entry, top.hits, 'state', true);
      answerClass = working === 'neg' ? 'partial' : q.prop.polarity === 'pos' ? 'yes' : 'no';
    }
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

/* ------------------------------------------------------------------ */
/* Keyword routing                                                      */
/* ------------------------------------------------------------------ */

const CAUSE_MARKER = /(?:のせい|が原因|が理由|のため|だから|のから|によって|による|のおかげ)/u;
/** A keyword that already states a causal / blame proposition (「弟のせい」「暑さが原因」). */
const CAUSAL_KEYWORD = /(?:せい|原因|げんいん|理由|りゆう|ため|によ|が悪|は悪|のミス|の責任|に責任|責任が|責任は)/u;
/** People a 「Xのせい」 question can blame (honorifics / plurals are stripped first). */
const PERSON_TAIL =
  /(?:弟|おとうと|兄|あに|姉|あね|妹|いもうと|家族|かぞく|親|おや|母|はは|父|ちち|両親|夫|妻|恋人|こいびと|彼氏|かれし|友人|ゆうじん|友達|友だち|ともだち|知人|仲間|なかま|大人|おとな|同僚|どうりょう|上司|部下|警備員|けいびいん|捜索隊|そうさくたい|救助隊|救急隊|きゅうきゅうたい|救急隊員|医者|医師|先生|通行人|周り|まわり|周囲|居合わせた人|誰か|だれか|他人|たにん|第三者|犯人|はんにん|人|ひと|者|の方|のかた)$/u;
const HONORIFIC_TAIL = /(?:さん|くん|君|ちゃん|たち|達|ら)+$/u;
/** 「Xが悪い」「Xは悪くない」 — a blame predicate (person X only). */
const BLAME_MARKER = /(?:が|は|も)(?:悪|わる)(?:い|かっ|く)/u;
/** The blame itself is negated: 「弟さんは悪くないですか」 asks for the opposite of 「弟が悪い？」. */
const BLAME_NEGATED = /(?:悪|わる)く(?:な(?:い|かった|さそう)|ありません)/u;
/** Keywords of a "nobody is to blame" fact. */
const BLAME_KEYWORD = /(?:誰の?せい|誰かの?せい|だれの?せい|だれかの?せい|誰も悪|誰かが悪|責め|責任|過失|落ち度)/u;
/** Keywords of a "no crime / no intent" fact. */
const CRIME_KEYWORD = /^(?:殺|殺され|ころされ|殺人|さつじん|他殺|たさつ|殺害|犯人|はんにん|犯罪|事件性|事件|じけん|襲|襲われ|おそわれ|故意|わざと|殺意|悪意|犯行)$/u;
/** Intent / agent words: the question is about someone doing it (on purpose). */
const INTENT =
  /(?:わざと|故意|意図的|計画的|殺意|悪意|仕組ん|仕組ま|細工|犯人|はんにん|犯行|事件(?!性はな|ではな|じゃな)|(?:殺|ころ)(?:さ|し|す|せ|害|人)|他殺|襲(?:わ|撃|っ)|おそわ|狙っ|ねらっ|何者か|誰かが|だれかが|誰かに(?:殺|襲|押|突|閉じ込|やられ|され|盛|狙)|第三者)/u;
/** Agent words strong enough to route to the crime fact even without a keyword hit. */
const AGENT = /(?:犯人|はんにん|犯行|事件(?!性はな|ではな|じゃな)|(?:殺|ころ)(?:さ|し|す|せ|害|人)|他殺|襲(?:わ|撃)|おそわ|何者か|誰かに(?:殺|襲|押|突|閉じ込|やられ|され|盛|狙)|第三者)/u;
const INTENT_G = new RegExp(INTENT.source, 'gu');
/** Scores within this distance of the best keyword fact are "tied". */
const TIE = 0.02;

interface Routed {
  fact: ScoredFact;
  route: 'keyword' | 'causal' | 'blame' | 'intent' | 'crime';
  /** The question denies the blame it names (「悪くないですか」): answer the opposite. */
  denies?: boolean;
}

/** A synthetic candidate for a fact reached by rule (no keyword hit in the question). */
function ruleCandidate(entry: IndexedFact, strength = 0.6): ScoredFact {
  return { id: entry.fact.id, score: strength, keywordStrength: strength, hits: [], entry };
}

/** The case's "nobody is to blame" fact, preferring one that names the person. */
function blameFact(index: CaseIndex, person: string): IndexedFact | undefined {
  let best: IndexedFact | undefined;
  let bestScore = 0;
  for (const e of index.facts) {
    if (e.fact.ifAsked === 'yes' || e.fact.spoilerLevel >= 4) continue;
    const n = e.keywords.filter((k) => BLAME_KEYWORD.test(k)).length;
    if (n === 0) continue;
    const score = n + (person && e.keywords.some((k) => k.includes(person)) ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** The case's "no crime / no intent" fact (most crime keywords, ruled out). */
function crimeFact(index: CaseIndex): IndexedFact | undefined {
  let best: IndexedFact | undefined;
  let bestN = 0;
  for (const e of index.facts) {
    if (e.fact.ifAsked === 'yes' || e.fact.spoilerLevel >= 4) continue;
    const n = e.keywords.filter((k) => CRIME_KEYWORD.test(k)).length;
    if (n > bestN) {
      bestN = n;
      best = e;
    }
  }
  return bestN >= 2 ? best : undefined;
}

/** The person named right before a causal marker (「弟さんのせい」 → 弟), if any. */
function blamedPerson(norm: string, markerAt: number): string | undefined {
  const before = norm.slice(Math.max(0, markerAt - 10), markerAt).replace(HONORIFIC_TAIL, '');
  const m = PERSON_TAIL.exec(before);
  return m ? m[0] : undefined;
}

/** True when some occurrence of `hit` in `norm` overlaps one of the spans. */
function overlapsAny(norm: string, hit: string, spans: readonly (readonly [number, number])[]): boolean {
  for (let at = norm.indexOf(hit); at >= 0; at = norm.indexOf(hit, at + 1)) {
    const end = at + hit.length;
    if (spans.some(([a, b]) => at < b && end > a)) return true;
  }
  return false;
}

/** The fact with the longest keyword hit that satisfies `pred`. */
function longestHit(facts: ScoredFact[], pred: (hit: string) => boolean): ScoredFact | undefined {
  let best: ScoredFact | undefined;
  let bestLen = 0;
  for (const f of facts) {
    for (const h of f.hits) {
      if (!pred(h)) continue;
      const len = [...h].length;
      if (len > bestLen) {
        bestLen = len;
        best = f;
      }
    }
  }
  return best;
}

const longest = (hs: string[]) => hs.reduce((n, h) => Math.max(n, [...h].length), 0);

/**
 * Which fact a keyword question is about.
 *   1. causal questions (「Xのせい／Xが原因／Xのため／Xによって」):
 *      a keyword that already states the causal proposition (「弟のせい」) wins;
 *      a person X routes to the case's "nobody is to blame" fact, else its "no crime" fact;
 *      otherwise the fact named right before the marker.
 *   2. intent / agent words (わざと・故意・誰かが・殺され・犯人・事件) outrank plain topic facts:
 *      the fact whose keyword carries the intent word, else the case's "no crime" fact.
 *   3. otherwise the best-scoring keyword fact; among tied scores a fact that can be compared
 *      with the question's state (same axis) and then a locked fact beat a visible-from-start one.
 */
function pickKeywordFact(q: AnalyzedQuestion, facts: ScoredFact[], index: CaseIndex): Routed {
  const m = CAUSE_MARKER.exec(q.norm);
  const bm = m ? undefined : BLAME_MARKER.exec(q.norm);
  const denies = !!bm && BLAME_NEGATED.test(q.norm);
  if (bm) {
    // 「弟さんは悪くないですか」「友人が悪いのですか」
    const causal = longestHit(facts, (h) => CAUSAL_KEYWORD.test(h));
    if (causal) return { fact: causal, route: 'causal', denies };
    const person = blamedPerson(q.norm, bm.index);
    if (person) {
      const e = blameFact(index, person) ?? crimeFact(index);
      if (e) return { fact: facts.find((f) => f.id === e.fact.id) ?? ruleCandidate(e), route: 'blame', denies };
    }
  }
  if (m) {
    // 1a. a keyword that is itself the causal proposition
    let causal: ScoredFact | undefined;
    let causalLen = 0;
    for (const f of facts) {
      for (const h of f.hits) {
        if (!CAUSAL_KEYWORD.test(h)) continue;
        const len = [...h].length;
        if (len > causalLen) {
          causalLen = len;
          causal = f;
        }
      }
    }
    if (causal) return { fact: causal, route: 'causal' };
    // 1b. blaming a person
    const person = blamedPerson(q.norm, m.index);
    if (person) {
      const e = blameFact(index, person) ?? crimeFact(index);
      if (e) return { fact: facts.find((f) => f.id === e.fact.id) ?? ruleCandidate(e), route: 'blame' };
    }
    // 1c. the fact named right before the marker
    let best: ScoredFact | undefined;
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
    if (best) return { fact: best, route: 'keyword' };
  }

  const spans = [...q.norm.matchAll(INTENT_G)].map((x) => [x.index ?? 0, (x.index ?? 0) + x[0].length] as const);
  if (spans.length > 0) {
    // the fact whose keyword covers the intent word (「わざとこぼ」「誰かがバルブ」「犯人」「狙」)
    let intent: ScoredFact | undefined;
    let intentLen = 0;
    for (const f of facts) {
      for (const h of f.hits) {
        if (!overlapsAny(q.norm, h, spans)) continue;
        const len = [...h].length;
        if (len > intentLen || (len === intentLen && intent && f.score > intent.score)) {
          intentLen = len;
          intent = f;
        }
      }
    }
    if (intent) return { fact: intent, route: 'intent' };
    if (AGENT.test(q.norm)) {
      const e = crimeFact(index);
      if (e) return { fact: facts.find((f) => f.id === e.fact.id) ?? ruleCandidate(e), route: 'crime' };
    }
  }

  // 3. best score; ties → comparable on the question's axis → locked before visible-from-start
  const top = facts[0];
  const tied = facts.filter((f, i) => i < 3 && top.score - f.score <= TIE);
  if (tied.length > 1) {
    const rank = (f: ScoredFact) =>
      (q.prop.determinate && f.entry.fact.ifAsked !== 'partial' && factPolarityFor(f.entry, f.hits, q.prop.family) ? 4 : 0) +
      (f.entry.fact.visibleFromStart ? 0 : 2) +
      (f.keywordStrength >= top.keywordStrength ? 1 : 0);
    const best = [...tied].sort((a, b) => rank(b) - rank(a) || longest(b.hits) - longest(a.hits))[0];
    return { fact: best, route: 'keyword' };
  }
  return { fact: top, route: 'keyword' };
}

/** No keyword fact at all: an agent / blame question can still reach the "no crime" fact. */
function routeWithoutKeywords(q: AnalyzedQuestion, index: CaseIndex): Routed | undefined {
  const m = CAUSE_MARKER.exec(q.norm) ?? BLAME_MARKER.exec(q.norm);
  const person = m ? blamedPerson(q.norm, m.index) : undefined;
  if (person) {
    const e = blameFact(index, person) ?? crimeFact(index);
    if (e) return { fact: ruleCandidate(e), route: 'blame', denies: BLAME_NEGATED.test(q.norm) && !CAUSE_MARKER.test(q.norm) };
  }
  if (AGENT.test(q.norm)) {
    const e = crimeFact(index);
    if (e) return { fact: ruleCandidate(e), route: 'crime' };
  }
  return undefined;
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
