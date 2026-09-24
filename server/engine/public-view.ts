/**
 * The ONLY place where case data is turned into browser-facing DTOs. Secret fields
 * (truth, probes, answer elements, judge notes, victim identity, leak terms …) never
 * pass through here unless the token proves the case is solved (solutionView).
 */
import type { Case, Fact } from '../../shared/case-schema.js';
import type { CasePublic, CaseSummary, PublicFact, ReconstructionView, ScienceMemoView, SolutionResponse, InquestRoundView } from '../../shared/api.js';
import { shardWeights } from './state.js';
import { hashString } from './lines.js';

export function publicFact(f: Fact): PublicFact {
  const out: PublicFact = { id: f.id, text: f.text, category: f.category, importance: f.importance };
  if (f.cardTitle) out.cardTitle = f.cardTitle;
  if (f.icon) out.icon = f.icon;
  return out;
}

export function memoView(c: Case, memoId: string): ScienceMemoView | undefined {
  const m = c.scienceMemos.find((x) => x.id === memoId);
  if (m) return { id: m.id, title: m.title, text: m.text };
  // Inline memo text on the fact (fact.scienceMemo is not an id).
  if (memoId.endsWith('-memo')) {
    const f = c.facts.find((x) => `${x.id}-memo` === memoId);
    if (f?.scienceMemo) return { id: memoId, title: f.cardTitle ? `${f.cardTitle}の科学` : '科学メモ', text: f.scienceMemo };
  }
  return undefined;
}

export function toSummary(c: Case): CaseSummary {
  const s: CaseSummary = {
    id: c.id,
    number: c.number,
    title: c.title,
    titleEn: c.titleEn,
    difficulty: c.difficulty,
    categories: [...c.categories],
    estimatedMinutes: c.estimatedMinutes,
    summary: c.intro.summary,
    codename: c.victim.codename,
    background: c.assets.background,
    accent: c.assets.accent,
    portrait: c.victim.portrait,
  };
  if (c.contentWarning) s.contentWarning = c.contentWarning;
  return s;
}

export function toPublic(c: Case): CasePublic {
  return {
    ...toSummary(c),
    location: c.intro.location,
    time: c.intro.time,
    narration: [...c.intro.narration],
    janeIntro: [...c.intro.jane],
    holmaIntro: [...c.intro.holma],
    starterQuestions: [...c.intro.starterQuestions],
    startingFacts: c.facts.filter((f) => f.visibleFromStart && f.spoilerLevel < 4).map(publicFact),
    totalFacts: c.facts.filter((f) => f.spoilerLevel < 4).length,
    shardWeights: shardWeights(c),
    hintCount: c.hints.length,
    holmaLines: { idle: [...c.holmaLines.idle], nearCore: [...c.holmaLines.nearCore] },
  };
}

/** Parses `きっと[[毒]]を盛られた` into segments. Unbalanced brackets stay plain text. */
export function parseSegments(text: string): { text: string; noise: boolean }[] {
  const out: { text: string; noise: boolean }[] = [];
  const re = /\[\[([^\]]+?)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), noise: false });
    out.push({ text: m[1], noise: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), noise: false });
  return out.filter((s) => s.text.length > 0);
}

export function roundViews(c: Case): InquestRoundView[] {
  return c.debate.map((r) => ({
    id: r.id,
    title: r.title,
    intro: [...r.intro],
    statements: r.statements.map((s) => ({ id: s.id, speaker: s.speaker, segments: parseSegments(s.text) })),
  }));
}

/**
 * Stable per-panel option order so the correct piece is not always first. `order[i]` is the
 * index in the authored options of the option shown at position i.
 */
export function optionOrder(caseId: string, panelId: string, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let h = hashString(`${caseId}:${panelId}`);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/**
 * Reconstruction strip. Blank (choice) panels hide their caption, scene and image — those
 * would tell which option is right. Once the strip is solved (`full`), everything is shown.
 */
export function reconstructionView(c: Case, full = false): ReconstructionView {
  return {
    intro: c.reconstruction.intro,
    panels: c.reconstruction.panels.map((p) => {
      const blank = !!p.choice && !full;
      const v: ReconstructionView['panels'][number] = { id: p.id, scene: blank ? '' : p.scene, caption: blank ? '' : p.caption };
      if (p.image && !blank) v.image = p.image;
      if (p.choice) {
        const order = optionOrder(c.id, p.id, p.choice.options.length);
        v.choice = { prompt: p.choice.prompt, options: order.map((i) => p.choice!.options[i].text) };
      }
      return v;
    }),
  };
}

export function solutionView(c: Case, unlocked: ReadonlySet<string>): SolutionResponse {
  return {
    victim: {
      codename: c.victim.codename,
      name: c.victim.name,
      nameKana: c.victim.nameKana,
      age: c.victim.age,
      occupation: c.victim.occupation,
      portrait: c.victim.portrait,
      farewell: [...c.victim.farewell],
    },
    truth: {
      summary: c.truth.summary,
      causeOfDeath: c.truth.causeOfDeath,
      mechanism: c.truth.mechanism,
      timeline: c.truth.timeline.map((t) => ({ ...t })),
    },
    allFacts: c.facts.map((f) => ({ ...publicFact(f), unlocked: unlocked.has(f.id) })),
    science: c.science,
    memos: c.scienceMemos.map((m) => ({ id: m.id, title: m.title, text: m.text })),
    quiz: c.quiz,
    sources: c.sources,
    holmaSolved: [...c.holmaLines.solved],
    reviewStatus: c.reviewStatus,
  };
}
