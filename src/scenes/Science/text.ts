/** Pure text helpers for the science page (placement of diagrams, pull-quotes, paragraphs). */
import type { Case } from '../../../shared/case-schema';

type Science = Case['science'];
type Diagram = Science['diagrams'][number];

export const paragraphs = (s: string) =>
  s
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

function bigrams(s: string): Set<string> {
  const t = s.normalize('NFKC').replace(/[\s、。，．「」『』（）()・：:—\-―〜~／/!！?？"'%]/g, '');
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

function diagramText(d: Diagram): string {
  switch (d.kind) {
    case 'levels':
      return `${d.title} ${d.unit} ${d.levels.map((l) => `${l.label} ${l.detail}`).join(' ')} ${d.marker?.label ?? ''}`;
    case 'ecg':
      return `${d.title} ${d.windowLabel} ${d.windowDetail}`;
    case 'ratio':
      return `${d.title} ${d.from.value} ${d.from.label} ${d.to.value} ${d.to.label} ${d.detail}`;
  }
}

/**
 * Place each diagram after the mechanism section it talks about most (bigram overlap of the
 * diagram's title/labels with the section heading ×3 + text). Returns, for each mechanism
 * index, the diagram indices to render after it; unmatched diagrams go after the last one.
 */
export function placeDiagrams(science: Pick<Science, 'mechanism' | 'diagrams'>): number[][] {
  const mech = science.mechanism;
  const slots: number[][] = mech.map(() => []);
  if (!mech.length) return slots;
  const mb = mech.map((m) => ({ head: bigrams(m.heading), body: bigrams(m.text) }));
  science.diagrams.forEach((d, di) => {
    const db = bigrams(diagramText(d));
    const title = bigrams(d.title);
    let best = -1;
    let bestScore = 0;
    mb.forEach((m, mi) => {
      let s = 0;
      for (const g of db) {
        if (m.head.has(g)) s += 3;
        if (m.body.has(g)) s += 1;
      }
      for (const g of title) if (m.head.has(g)) s += 4;
      const norm = s / Math.sqrt(Math.max(1, m.body.size));
      if (norm > bestScore) {
        bestScore = norm;
        best = mi;
      }
    });
    slots[best >= 0 ? best : mech.length - 1].push(di);
  });
  return slots;
}

export function sentences(s: string): string[] {
  return (s.match(/[^。！？\n]+[。！？]?/g) ?? []).map((x) => x.trim()).filter(Boolean);
}

/** A short, quotable sentence for the pull-quote (magazine style: it repeats the text). */
export function pullQuote(science: Pick<Science, 'body' | 'whyHere' | 'takeaways'>): string {
  const cands = [...sentences(science.body), ...sentences(science.whyHere)];
  let best = '';
  let bestScore = -Infinity;
  for (const c of cands) {
    const len = [...c].length;
    if (len < 16 || len > 64) continue;
    let s = -Math.abs(len - 34) / 14;
    if (/ではなく|ではない|——|だけだ|だけで/.test(c)) s += 3;
    if (/「[^」]+」/.test(c)) s += 1;
    if (/^(じつは|けれど|だから|つまり)/.test(c)) s += 0.5;
    if (/[0-9０-９]/.test(c)) s -= 0.5;
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best || science.takeaways[0] || '';
}

/* ------------------------------------------------------------------ */
/* Reading time                                                        */
/* ------------------------------------------------------------------ */

/** Japanese reading speed for explanatory text (characters per minute). */
export const READ_CPM = 500;

const len = (...xs: (string | undefined)[]) => xs.reduce((n, x) => n + (x ? [...x.replace(/\s+/g, '')].length : 0), 0);

/**
 * Characters per science section (ids match the page's SECTIONS). A figure counts as ~40 s of
 * reading; the reference list only counts what a reader skims (titles and organisations).
 */
export function sectionChars(sol: {
  science: Science;
  allFacts: { id: string; text: string }[];
  memos: { title: string; text: string }[];
  sources: { title: string; organization: string }[];
}): Record<string, number> {
  const s = sol.science;
  const facts = new Map(sol.allFacts.map((f) => [f.id, f.text]));
  return {
    cause: len(s.causeName, s.lead),
    chain: s.chain.reduce((n, c) => n + len(c.stage, c.title, c.detail), 0),
    body: len(s.body),
    why: len(s.whyHere),
    clues: s.foreshadowing.reduce((n, c) => n + len(facts.get(c.fact), c.meaning), 0),
    mech: s.mechanism.reduce((n, m) => n + len(m.heading, m.text), 0) + s.diagrams.length * Math.round(READ_CPM * 0.66),
    myths: s.misconceptions.reduce((n, m) => n + len(m.myth, m.truth), 0),
    everyday: len(...s.everyday),
    points: len(...s.takeaways),
    safety: len(s.safetyNote),
    memos: sol.memos.reduce((n, m) => n + len(m.title, m.text), 0),
    sources: sol.sources.reduce((n, x) => n + len(x.title, x.organization), 0),
  };
}

/** Whole minutes, at least 1. */
export const readingMinutes = (chars: number) => Math.max(1, Math.round(chars / READ_CPM));
