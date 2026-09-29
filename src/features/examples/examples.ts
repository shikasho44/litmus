/**
 * 質問の例 — the example-question cards (design bible §3-1b, docs/decisions.md 2026-09-29).
 *
 * The case's starter questions and its extra examples (CasePublic.examples) are dealt to the
 * player over investigation time, at most `maxVisible` at once. Waiting is the only cost: a used
 * card is an ordinary question (it spends the 質問枠 like any typed one) and nothing is taken off
 * the score; a case solved without using any card earns a small distinction on the result
 * (src/features/rank RUN_DISTINCTIONS).
 *
 *   見習い / 審問官  2 cards at the start, then +1 every 60 s
 *   教授             none at the start, the first after 2 min, then +1 every 90 s
 *   A deal only fills an empty slot: when all slots are full the deal is skipped, so a used card
 *   is replaced on the next deal. Unused cards stay until used; a card whose question the player
 *   has already asked, or whose findings the player already holds, is removed (and never dealt).
 *   Order: shuffled per run (seeded), except that the first `starterLead` come from the starters.
 *
 * EVERY NUMBER TO TUNE LIVES IN `EXAMPLE_TUNING`. Pure (no signals, no DOM): unit-tested. The
 * state lives in the case save (CaseProgress.examples) so a reload neither resets nor reshuffles.
 */
import type { Difficulty, ExampleQuestion } from '../../../shared/api';
import { rng, shuffle } from '../../lib/rng';

export interface ExampleRule {
  /** Cards dealt when the investigation starts. */
  start: number;
  /** Investigation time (ms) of the first deal after the start. */
  firstMs: number;
  /** Investigation time (ms) between later deals. */
  everyMs: number;
}

export const EXAMPLE_TUNING = {
  /** Cards on the table at most. */
  maxVisible: 3,
  /** The first cards dealt come from the case's starter questions (the basic entry questions). */
  starterLead: 2,
  rules: {
    easy: { start: 2, firstMs: 60_000, everyMs: 60_000 },
    normal: { start: 2, firstMs: 60_000, everyMs: 60_000 },
    hard: { start: 0, firstMs: 120_000, everyMs: 90_000 },
  } satisfies Record<Difficulty, ExampleRule>,
  /** The investigation clock is written to the save at least this often (and on hide / leave). */
  saveEveryMs: 5_000,
} as const;

/** Saved per case run (CaseProgress.examples). */
export interface ExampleState {
  /** Shuffle seed of this run. */
  seed: number;
  /** Investigation time on the clock (screen active, tab visible). */
  ms: number;
  /** Deals that have happened (a deal with every slot full is skipped but counted). */
  dealt: number;
  /** Cards on the table (question texts, in the order they came). */
  shown: string[];
  /** Cards the player used (sent as a question). */
  used: string[];
}

export interface ExampleContext {
  /** Every question the player has sent in this run. */
  asked: string[];
  /** Finding ids the player holds. */
  facts: string[];
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
export const exampleRule = (play: Difficulty | undefined): ExampleRule => EXAMPLE_TUNING.rules[play && DIFFS.includes(play) ? play : 'normal'];

/** Question text reduced for comparisons (spaces and punctuation dropped). */
export const squashQ = (s: string) => s.replace(/[\s　？?。、，,！!「」『』…・]/g, '');

export function newExampleState(seed = Math.floor(Math.random() * 2 ** 31)): ExampleState {
  return { seed: seed >>> 0, ms: 0, dealt: 0, shown: [], used: [] };
}

/** How many deals have happened by investigation time `ms`. */
export function dealsAt(play: Difficulty | undefined, ms: number): number {
  const r = exampleRule(play);
  const t = Math.max(0, Number.isFinite(ms) ? ms : 0);
  return r.start + (t >= r.firstMs ? 1 + Math.floor((t - r.firstMs) / r.everyMs) : 0);
}

/** Investigation time of the next deal after `ms`. */
export function nextDealAt(play: Difficulty | undefined, ms: number): number {
  const r = exampleRule(play);
  const t = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (t < r.firstMs) return r.firstMs;
  return r.firstMs + (Math.floor((t - r.firstMs) / r.everyMs) + 1) * r.everyMs;
}

/** The run's dealing order: `starterLead` starters first, then everything else shuffled. */
export function exampleOrder(pool: readonly ExampleQuestion[], seed: number): ExampleQuestion[] {
  const rand = rng(seed >>> 0);
  const seen = new Set<string>();
  const uniq = pool.filter((e) => {
    const k = squashQ(e.q);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const starters = shuffle(
    uniq.filter((e) => e.starter),
    rand,
  );
  const lead = starters.slice(0, EXAMPLE_TUNING.starterLead);
  const rest = shuffle([...starters.slice(lead.length), ...uniq.filter((e) => !e.starter)], rand);
  return [...lead, ...rest];
}

/** A card the player no longer needs: its question was asked, or all its findings are in hand. */
export function exampleBlocked(e: ExampleQuestion, ctx: ExampleContext): boolean {
  const k = squashQ(e.q);
  if (ctx.asked.some((a) => squashQ(a) === k)) return true;
  const have = new Set(ctx.facts);
  return !!e.facts?.length && e.facts.every((id) => have.has(id));
}

/**
 * Bring the table up to date: drop cards that are no longer needed, then deal every deal that is
 * due by `state.ms` (each fills one free slot, if any, with the next card in the run's order).
 * Returns the same object when nothing changed.
 */
export function advanceExamples(state: ExampleState, play: Difficulty | undefined, pool: readonly ExampleQuestion[], ctx: ExampleContext): ExampleState {
  const byKey = new Map(pool.map((e) => [squashQ(e.q), e]));
  const used = new Set(state.used.map(squashQ));
  const shown = state.shown.filter((q) => {
    const e = byKey.get(squashQ(q));
    return !!e && !used.has(squashQ(q)) && !exampleBlocked(e, ctx);
  });
  const target = dealsAt(play, state.ms);
  let dealt = state.dealt;
  if (dealt < target) {
    const order = exampleOrder(pool, state.seed);
    const isStarter = (q: string) => !!byKey.get(squashQ(q))?.starter;
    while (dealt < target) {
      dealt++;
      if (shown.length >= EXAMPLE_TUNING.maxVisible) continue;
      const on = new Set(shown.map(squashQ));
      const free = (e: ExampleQuestion) => !on.has(squashQ(e.q)) && !used.has(squashQ(e.q)) && !exampleBlocked(e, ctx);
      // the first cards come from the starters even when one of the lead two is already pointless
      const startersOut = [...shown, ...state.used].filter(isStarter).length;
      const next = (startersOut < EXAMPLE_TUNING.starterLead && order.find((e) => e.starter && free(e))) || order.find(free);
      if (next) shown.push(next.q);
    }
  }
  if (dealt === state.dealt && shown.length === state.shown.length) return state;
  return { ...state, dealt, shown };
}

/**
 * The player sent `text`, and the card last put into the input was `picked`: that card is used
 * (even if its words were edited) when it is still on the table. A question typed by hand is never
 * a used card — a card with the same words simply leaves the table (advanceExamples: asked).
 */
export function useExample(state: ExampleState, text: string, picked?: string | null): { state: ExampleState; card: string | null } {
  const card = (picked && text.trim() && state.shown.find((q) => q === picked)) || null;
  if (!card) return { state, card: null };
  return { state: { ...state, shown: state.shown.filter((q) => q !== card), used: [...state.used, card] }, card };
}

/** Saved state read back from storage (anything malformed → undefined: a fresh deal). */
export function sanitizeExamples(v: unknown): ExampleState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 60) : []);
  if (typeof o.seed !== 'number' || !Number.isFinite(o.seed)) return undefined;
  return { seed: o.seed >>> 0, ms: n(o.ms), dealt: Math.floor(n(o.dealt)), shown: list(o.shown).slice(0, EXAMPLE_TUNING.maxVisible), used: list(o.used) };
}

/** The card pool of a case: CasePublic.examples, or the starters of an older server. */
export function examplePool(pub: { examples?: ExampleQuestion[]; starterQuestions?: string[] } | undefined | null): ExampleQuestion[] {
  if (!pub) return [];
  if (pub.examples?.length) return pub.examples;
  return (pub.starterQuestions ?? []).map((q) => ({ q, starter: true }));
}
