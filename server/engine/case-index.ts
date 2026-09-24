/**
 * Pre-computed, normalised view of a case used by retrieval and the rules judge.
 * Built once per loaded case (see registry.ts).
 */
import type { Case, Fact, Probe } from '../../shared/case-schema.js';
import { bigrams, coreForm, isNegatedConfirmation, isOpenQuestion, normalize, questionProposition, statementPolarity, type Polarity, type Proposition } from './normalize.js';

export interface IndexedFact {
  fact: Fact;
  norm: string;
  grams: Map<string, number>;
  /** Normalised keywords (deduplicated, empty removed). */
  keywords: string[];
  /** Polarity of the statement (stopped/absent vs working/present), if unanimous. */
  polarity?: Polarity;
  /** Clauses (split on 、。) with their own polarity — used when a keyword sits in one clause. */
  clauses: { norm: string; polarity?: Polarity }[];
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
}

/**
 * Polarity of what a fact says about the matched keywords: the clauses that literally contain
 * a hit (unanimous), else the whole statement (unanimous), else undefined.
 */
export function factPolarityFor(f: IndexedFact, hits: readonly string[]): Polarity | undefined {
  const cl = f.clauses.filter((c) => hits.some((h) => c.norm.includes(h)));
  if (cl.length > 0) {
    const ps = cl.map((c) => c.polarity);
    if (ps.every((p) => p !== undefined && p === ps[0])) return ps[0];
    if (ps.some((p) => p !== undefined)) return undefined;
  }
  return f.polarity;
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

export function buildCaseIndex(c: Case): CaseIndex {
  const facts: IndexedFact[] = c.facts.map((fact) => {
    const norm = normalize(fact.text);
    const kws = [...new Set(fact.keywords.map(normalize).filter((k) => k.length > 0))];
    const clauses = fact.text
      .split(/[、。，．,.！？!?]/u)
      .map(normalize)
      .filter(Boolean)
      .map((c) => ({ norm: c, polarity: statementPolarity(c) }));
    return { fact, norm, grams: bigrams(norm), keywords: kws, polarity: statementPolarity(norm), clauses };
  });
  const contentWords = [...new Set(facts.flatMap((f) => f.keywords).filter((k) => [...k].length >= 2))];
  return {
    facts,
    factById: new Map(facts.map((f) => [f.fact.id, f])),
    contentWords,
    probes: c.probes.map((p, i) => indexProbe(p, i, contentWords)),
    memoById: new Map(c.scienceMemos.map((m) => [m.id, m])),
    leakTerms: [...new Set(c.leakTerms.map(normalize).filter((t) => t.length > 0))],
  };
}
