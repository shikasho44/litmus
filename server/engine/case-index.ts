/**
 * Pre-computed, normalised view of a case used by retrieval and the rules judge.
 * Built once per loaded case (see registry.ts).
 */
import type { Case, Fact, Probe } from '../../shared/case-schema.js';
import { bigrams, coreForm, isNegatedConfirmation, isOpenQuestion, marksPolarity, normalize, polarityMarks, questionProposition, type Polarity, type PolarityFamily, type PolarityMark, type Proposition } from './normalize.js';

export interface IndexedFact {
  fact: Fact;
  norm: string;
  grams: Map<string, number>;
  /** Normalised keywords (deduplicated, empty removed). */
  keywords: string[];
  /** Polarity of the statement (stopped/absent vs working/present), if unanimous. */
  polarity?: Polarity;
  /** Clauses (split on 、。) with their own polarity — used when a keyword sits in one clause. */
  clauses: { norm: string; polarity?: Polarity; marks: PolarityMark[] }[];
  /** Polarity marks of the whole statement. */
  marks: PolarityMark[];
  /** Spoken forms of compound keywords (「酸素メーター」 → 「酸素のメーター」), normalised. */
  variants: { form: string; keyword: string }[];
}

export interface IndexedProbe {
  probe: Probe;
  index: number;
  norm: string;
  core: string;
  grams: Map<string, number>;
  negated: boolean;
  open: boolean;
  /** Case keywords (≥ 2 chars) contained in the probe text. */
  keywords: string[];
  prop: Proposition;
}

export interface CaseIndex {
  facts: IndexedFact[];
  factById: Map<string, IndexedFact>;
  probes: IndexedProbe[];
  memoById: Map<string, Case['scienceMemos'][number]>;
  /** Normalised leak terms. */
  leakTerms: string[];
  /** Every fact keyword with ≥ 2 characters (normalised) — content words of the case. */
  contentWords: string[];
  /**
   * Normalised forms of the victim's real name (secret until solved). A question that contains
   * one is answered 'cannot' without consulting any model: confirming 「白石さんですか？」 would
   * leak the identity (the judge sees the truth summary, which names her).
   */
  secretNames: string[];
}

const HONORIFICS = ['さん', 'ちゃん', 'くん', '氏', '様', 'さま', 'せんせい', '先生'];

/**
 * Name forms that identify the victim: full name (kanji / kana, no space), the kanji surname
 * (≥ 2 chars), and any name part followed by an honorific. Bare kana parts are left out on
 * purpose — しいな is inside おかしいな, はるか is an ordinary word.
 */
export function secretNamesOf(c: Pick<Case, 'victim'>): string[] {
  const out = new Set<string>();
  const kanji = c.victim.name.split(/[\s　・]+/u).filter(Boolean);
  const kana = c.victim.nameKana.split(/[\s　・]+/u).filter(Boolean);
  const add = (s: string) => {
    const n = normalize(s);
    if ([...n].length >= 2) out.add(n);
  };
  add(kanji.join(''));
  add(kana.join(''));
  if (kanji.length > 1 && [...kanji[0]].length >= 2 && /\p{Script=Han}/u.test(kanji[0])) add(kanji[0]);
  for (const part of [...kanji, ...kana]) for (const h of HONORIFICS) add(`${part}${h}`);
  return [...out];
}

/** Secret name forms contained in a normalised question. */
export function secretNamesIn(norm: string, names: readonly string[]): string[] {
  return names.filter((n) => norm.includes(n));
}

/**
 * Polarity of what a fact says about the matched keywords: the clauses that literally contain
 * a hit (unanimous), else the whole statement (unanimous), else undefined. With `family`, only
 * state stems of that axis count (「壊れていた？」 is never answered from 「止まっていた」).
 */
export function factPolarityFor(f: IndexedFact, hits: readonly string[], family?: PolarityFamily, strict = false): Polarity | undefined {
  const cl = f.clauses.filter((c) => hits.some((h) => c.norm.includes(h)));
  if (cl.length > 0) {
    const ps = cl.map((c) => marksPolarity(c.marks, family, strict));
    if (ps.every((p) => p !== undefined && p === ps[0])) return ps[0];
    if (ps.some((p) => p !== undefined)) return undefined;
  }
  return marksPolarity(f.marks, family, strict);
}

/** Content words of the case present in a normalised text. */
export function contentWordsIn(norm: string, words: readonly string[]): string[] {
  return words.filter((w) => norm.includes(w));
}

export function indexProbe(probe: Probe, index: number, contentWords: readonly string[] = []): IndexedProbe {
  const norm = normalize(probe.q);
  const core = coreForm(norm);
  return { probe, index, norm, core, grams: bigrams(core), negated: isNegatedConfirmation(norm), open: isOpenQuestion(norm), keywords: contentWordsIn(norm, contentWords), prop: questionProposition(probe.q) };
}

/** A kanji noun + katakana noun compound (「酸素メーター」「窒素ガス」). */
const HAN_KATA = /^(\p{Script=Han}{2,})([\p{Script=Katakana}ー]{2,})$/u;

/**
 * Players split compound keywords with 「の」: 「酸素のメーター」 for 酸素メーター. Only kanji +
 * katakana compounds get the variant — the boundary is certain there (「酸素濃度計」 is not split).
 */
export function keywordVariants(keywords: readonly string[]): { form: string; keyword: string }[] {
  const out: { form: string; keyword: string }[] = [];
  for (const k of keywords) {
    const m = HAN_KATA.exec(k.normalize('NFKC').trim());
    if (m) out.push({ form: normalize(`${m[1]}の${m[2]}`), keyword: normalize(k) });
  }
  return out;
}

export function buildCaseIndex(c: Case): CaseIndex {
  const facts: IndexedFact[] = c.facts.map((fact) => {
    const norm = normalize(fact.text);
    const kws = [...new Set(fact.keywords.map(normalize).filter((k) => k.length > 0))];
    const clauses = fact.text
      .split(/[、。，．,.！？!?]/u)
      .map(normalize)
      .filter(Boolean)
      .map((c) => {
        const marks = polarityMarks(c);
        return { norm: c, polarity: marksPolarity(marks), marks };
      });
    const marks = polarityMarks(norm);
    return { fact, norm, grams: bigrams(norm), keywords: kws, polarity: marksPolarity(marks), clauses, marks, variants: keywordVariants(fact.keywords) };
  });
  const contentWords = [...new Set(facts.flatMap((f) => f.keywords).filter((k) => [...k].length >= 2))];
  return {
    facts,
    factById: new Map(facts.map((f) => [f.fact.id, f])),
    contentWords,
    probes: c.probes.map((p, i) => indexProbe(p, i, contentWords)),
    memoById: new Map(c.scienceMemos.map((m) => [m.id, m])),
    leakTerms: [...new Set(c.leakTerms.map(normalize).filter((t) => t.length > 0))],
    secretNames: secretNamesOf(c),
  };
}
