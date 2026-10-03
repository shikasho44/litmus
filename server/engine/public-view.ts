/**
 * The ONLY place where case data is turned into browser-facing DTOs. Secret fields
 * (truth, probes, answer elements, judge notes, victim identity, leak terms …) never
 * pass through here unless the token proves the case is solved (solutionView).
 * verdictModes are shown at the verdict (verdictSetupView) without the `correct` flags / answers.
 */
import type { Case, Fact, VerdictModes } from '../../shared/case-schema.js';
import type { CasePublic, CaseSummary, ExampleQuestion, PublicFact, ReconstructionView, ScienceMemoView, SolutionResponse, InquestRoundView, VerdictMode, VerdictSetupResponse } from '../../shared/api.js';
import { shardWeights } from './state.js';
import { hashString } from './lines.js';
import { normalize } from './normalize.js';

export function publicFact(f: Fact): PublicFact {
  const out: PublicFact = { id: f.id, text: f.text, category: f.category, importance: f.importance };
  if (f.cardTitle) out.cardTitle = f.cardTitle;
  if (f.icon) out.icon = f.icon;
  if (f.scienceHint) out.science = true; // PROTOTYPE I-005 (the browser marks it only with ?proto=i005)
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
    // what the shards show before the solve (the solution sends the real portrait)
    portrait: c.victim.shardPortrait ?? c.victim.portrait,
  };
  if (c.victim.silhouette && c.victim.silhouette !== 'bust') s.silhouette = c.victim.silhouette;
  if (c.contentWarning) s.contentWarning = c.contentWarning;
  if (c.questionBudget && Object.keys(c.questionBudget).length > 0) s.questionBudget = { ...c.questionBudget };
  if (c.intro.hook) s.hook = c.intro.hook; // PROTOTYPE I-005 (shown only with ?proto=i005)
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
    totalFacts: c.facts.filter((f) => f.spoilerLevel < 4 && !f.manner).length,
    shardWeights: shardWeights(c),
    hintCount: c.hints.length,
    holmaLines: { idle: [...c.holmaLines.idle], nearCore: [...c.holmaLines.nearCore] },
    ...(c.nudges && c.nudges.length > 0 ? { nudges: [...c.nudges] } : {}),
    examples: exampleView(c),
  };
}

/**
 * The 「質問の例」 pool: starters, then the extra examples (duplicates dropped). Each carries the
 * reachable finding ids its probe lists — ids only, so the browser can skip a card whose findings
 * the player already has without learning anything about them.
 */
export function exampleView(c: Case): ExampleQuestion[] {
  const reachable = new Set(c.facts.filter((f) => f.spoilerLevel < 4 && !f.manner).map((f) => f.id));
  const probes = new Map(c.probes.map((p) => [normalize(p.q), p]));
  const seen = new Set<string>();
  const out: ExampleQuestion[] = [];
  const add = (q: string, starter: boolean) => {
    const n = normalize(q);
    if (!n || seen.has(n)) return;
    seen.add(n);
    const facts = (probes.get(n)?.facts ?? []).filter((id) => reachable.has(id));
    out.push({ q, ...(starter ? { starter: true } : {}), ...(facts.length ? { facts } : {}) });
  };
  c.intro.starterQuestions.forEach((q) => add(q, true));
  (c.intro.exampleQuestions ?? []).forEach((q) => add(q, false));
  return out;
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

/* ------------------------------------------------------------------ */
/* Verdict modes (choice / cloze / free) — shared by the setup view    */
/* and the judge (verdict-modes.ts) so both use the same display order */
/* ------------------------------------------------------------------ */

/** Display order of the choice options (`order[i]` = authored index shown at position i). */
export function verdictChoiceOrder(c: Case, vm: VerdictModes): number[] {
  const order = optionOrder(c.id, 'verdict:choice', vm.choice.options.length);
  // Everyone sees the same order, so never let the correct option sit first or last:
  // rotate until it lands in the middle positions.
  const n = order.length;
  for (let k = 0; k < n; k++) {
    const pos = order.findIndex((i) => vm.choice.options[i]?.correct);
    if (pos > 0 && pos < n - 1) break;
    order.push(order.shift()!);
  }
  return order;
}

/** Display order of one cloze blank's options (`order[i]` = authored index shown at position i). */
export function verdictBlankOrder(c: Case, blank: VerdictModes['cloze']['blanks'][number]): number[] {
  return optionOrder(c.id, `verdict:cloze:${blank.id}`, blank.options.length);
}

/**
 * Debate assists that apply to one verdict mode, as distinct targets (a wrong choice option id,
 * a blank id or an answer element id). Assists pointing at nothing valid for the mode — a
 * correct / unknown option, an unknown blank or element — are ignored (the validator reports
 * them). `earned` holds the targets of rounds the player has cleared.
 */
export function verdictAssists(c: Case, vm: VerdictModes, cleared: readonly string[], mode: VerdictMode): { earned: Set<string>; total: Set<string> } {
  const valid = (t: string | undefined): t is string => {
    if (!t) return false;
    if (mode === 'choice') return vm.choice.options.some((o) => o.id === t && !o.correct);
    if (mode === 'cloze') return vm.cloze.blanks.some((b) => b.id === t);
    return c.answerElements.some((e) => e.id === t);
  };
  const earned = new Set<string>();
  const total = new Set<string>();
  for (const a of vm.assists) {
    const t = mode === 'choice' ? a.removeOption : mode === 'cloze' ? a.fillBlank : a.element;
    if (!valid(t)) continue;
    total.add(t);
    if (cleared.includes(a.round)) earned.add(t);
  }
  return { earned, total };
}

/**
 * What the verdict screen shows for a mode, with the assists earned by the cleared debate rounds
 * applied. Never says which choice option is correct: options are in a fixed per-case shuffled
 * order and only assisted WRONG options are marked removed. A cloze blank's `filled` (the correct
 * answer's display index) is only present when an assist pre-fills it. Cases without
 * verdictModes answer `available: false` with the free-text view (the UI falls back to it).
 */
export function verdictSetupView(c: Case, cleared: readonly string[], mode: VerdictMode): VerdictSetupResponse {
  const vm = c.verdictModes;
  const labels: Record<string, string> = {};
  for (const e of c.answerElements) labels[e.id] = e.label;
  if (!vm) return { mode: 'free', free: { labels, revealed: [] }, assistsEarned: 0, assistsTotal: 0, available: false };
  const { earned, total } = verdictAssists(c, vm, cleared, mode);
  const out: VerdictSetupResponse = { mode, assistsEarned: earned.size, assistsTotal: total.size, available: true };
  if (mode === 'choice') {
    out.choice = {
      prompt: vm.choice.prompt,
      options: verdictChoiceOrder(c, vm).map((i) => {
        const o = vm.choice.options[i];
        return { id: o.id, text: o.text, removed: earned.has(o.id) };
      }),
    };
  } else if (mode === 'cloze') {
    out.cloze = {
      prompt: vm.cloze.prompt,
      template: vm.cloze.template,
      blanks: vm.cloze.blanks.map((b) => {
        const order = verdictBlankOrder(c, b);
        const v: { id: string; label: string; options: string[]; filled?: number } = { id: b.id, label: b.label, options: order.map((i) => b.options[i]) };
        if (earned.has(b.id)) v.filled = order.indexOf(b.answer);
        return v;
      }),
    };
  } else {
    out.free = { labels, revealed: c.answerElements.filter((e) => earned.has(e.id)).map((e) => e.id) };
  }
  return out;
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
      ...(c.victim.profile ? { profile: c.victim.profile.map((r) => ({ ...r })) } : {}),
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
