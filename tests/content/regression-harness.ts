/**
 * Content regression harness (shared by tests/content/regression.test.ts and ad-hoc scripts).
 *
 * The validator only re-asks the authored probes verbatim. A regression set asks realistic
 * player phrasings — the question sets written during each case's review — through the REAL
 * offline pipeline (`runAsk` in rules mode: split → analyse → retrieve → rules judge → policy →
 * canned line), and runs free-text verdicts through `evaluateVerdict`.
 *
 * Set file: tests/content/regression/<case-id>.json
 *
 *   questions[]  q          the player's text (only the first split part is scored)
 *                expect     accepted answer classes (any of)
 *                fact       the judged or unlocked fact must include this id (topic check)
 *                forbid     fact ids that must NOT unlock — from the start state and from `richState`
 *                noNearCore the answer must not switch nearCore on (from the start state)
 *                safety     self-harm / method / harming-others question: must be `cannot`, unlock
 *                           nothing, leave nearCore off. The `notice: 'support'` card is checked as a
 *                           pending target ('safety-filter') until the engine filter lands.
 *                critical   must always pass (the rest only counts toward `minRate`)
 *                pending    names an engine fix that is being built concurrently. Pending items never
 *                           fail the suite: they are asserted when they already pass and reported as
 *                           `it.todo` when they do not. Set STRICT_PENDING=1 to assert them all.
 *                           'safety-filter'   rules-level self-harm / method filter (+ notice 'support')
 *                           'clause-negation' verdict.ts: negation scoped to the clause, so
 *                                             「酸素がなくなって」 no longer hides a false claim
 *                           'cause-routing'   「Xのせい」 about a person routes to the no-blame fact
 *                note       why the expectation is what it is
 *   verdicts[]   text, expect (correct | almost | missing | wrong, any of), pending?, note?
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerClass } from '../../shared/case-schema';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import type { ContentRegistry, LoadedCase } from '../../server/engine/registry';
import { runAsk } from '../../server/engine/pipeline';
import { initialState, type GameState } from '../../server/engine/state';
import { evaluateVerdict } from '../../server/engine/verdict';

export type PendingFix = 'safety-filter' | 'clause-negation' | 'cause-routing';
export const PENDING_FIXES: readonly PendingFix[] = ['safety-filter', 'clause-negation', 'cause-routing'];

export interface QuestionCase {
  q: string;
  expect: AnswerClass[];
  fact?: string;
  forbid?: string[];
  noNearCore?: boolean;
  safety?: boolean;
  critical?: boolean;
  pending?: PendingFix;
  group?: string;
  note?: string;
}

export interface VerdictCase {
  text: string;
  expect: string[];
  pending?: PendingFix;
  note?: string;
}

export interface RegressionSet {
  caseId: string;
  /** Extra state (fact ids already held) for the `forbid` check. */
  richState?: string[];
  /** Share of non-pending questions that must fully pass. */
  minRate?: number;
  questions: QuestionCase[];
  verdicts: VerdictCase[];
}

export interface AskResult {
  answer: string;
  /** Facts the decision was about (judged), start state. */
  facts: string[];
  /** Facts unlocked from the start state. */
  unlocked: string[];
  /** Facts unlocked from the start state or the rich state. */
  unlockedAny: Set<string>;
  nearCore: boolean;
  notice?: string;
  meta?: string;
}

export interface QuestionResult {
  x: QuestionCase;
  r: AskResult;
  /** Human-readable reasons it failed (empty = pass). */
  problems: string[];
  /** Problems that belong to a pending fix (reported, never fatal). */
  pendingProblems: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
export const SET_DIR = resolve(here, 'regression');

let registryCache: ContentRegistry | undefined;
export function contentRegistry(): ContentRegistry {
  registryCache ??= loadRegistry(resolveContentRoot({}));
  return registryCache;
}

export function loadSets(): RegressionSet[] {
  return readdirSync(SET_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SET_DIR, f), 'utf8')) as RegressionSet);
}

export function loadedCase(caseId: string): LoadedCase {
  const loaded = contentRegistry().get(caseId, true);
  if (!loaded) throw new Error(`case ${caseId} is not loaded (see npm run validate)`);
  return loaded;
}

async function askOnce(loaded: LoadedCase, q: string, state: GameState) {
  const out = await runAsk({
    loaded,
    lines: contentRegistry().lines,
    question: q,
    state,
    components: { mode: 'rules', warnings: [] },
  });
  const a = out.answers[0];
  const part = out.trace.parts?.[0];
  return {
    answer: a.answerClass as string,
    facts: part?.factIds ?? [],
    unlocked: a.unlocked.map((f) => f.id),
    nearCore: out.state.nearCore,
    notice: a.notice,
    meta: part?.meta,
  };
}

export async function ask(set: RegressionSet, q: string): Promise<AskResult> {
  const loaded = loadedCase(set.caseId);
  const s0 = initialState(loaded.data, 0);
  const fresh = await askOnce(loaded, q, s0);
  const unlockedAny = new Set(fresh.unlocked);
  if (set.richState?.length) {
    const rich: GameState = { ...s0, unlocked: [...new Set([...s0.unlocked, ...set.richState])] };
    for (const id of (await askOnce(loaded, q, rich)).unlocked) unlockedAny.add(id);
  }
  return { ...fresh, unlockedAny };
}

/** Scores one question. Problems tied to a pending fix go to `pendingProblems`. */
export function score(x: QuestionCase, r: AskResult): QuestionResult {
  const problems: string[] = [];
  const pendingProblems: string[] = [];
  if (!x.expect.includes(r.answer as AnswerClass)) problems.push(`answer ${r.answer} (expected ${x.expect.join('|')})`);
  if (x.fact && !r.facts.includes(x.fact) && !r.unlocked.includes(x.fact)) problems.push(`about ${r.facts.join(',') || '-'} (expected ${x.fact})`);
  const leaked = (x.forbid ?? []).filter((id) => r.unlockedAny.has(id));
  if (leaked.length > 0) problems.push(`unlocked forbidden ${leaked.join(',')}`);
  if ((x.noNearCore || x.safety) && r.nearCore) problems.push('switched nearCore on');
  if (x.safety) {
    if (r.unlockedAny.size > 0) problems.push(`safety question unlocked ${[...r.unlockedAny].join(',')}`);
    if (r.notice !== 'support') pendingProblems.push(`notice ${r.notice ?? '-'} (target: support)`);
  }
  // A pending item's own problems are all pending.
  if (x.pending) return { x, r, problems: [], pendingProblems: [...problems, ...pendingProblems] };
  return { x, r, problems, pendingProblems };
}

export async function runQuestions(set: RegressionSet): Promise<QuestionResult[]> {
  const out: QuestionResult[] = [];
  for (const x of set.questions) out.push(score(x, await ask(set, x.q)));
  return out;
}

export interface VerdictResultRow {
  v: VerdictCase;
  got: string;
  ok: boolean;
}

export function runVerdicts(set: RegressionSet): VerdictResultRow[] {
  const c = loadedCase(set.caseId).data;
  return set.verdicts.map((v) => {
    const got = evaluateVerdict(c, v.text).result as string;
    return { v, got, ok: v.expect.includes(got) };
  });
}

export function describeQuestion(res: QuestionResult): string {
  const all = [...res.problems, ...res.pendingProblems];
  return `${res.x.q} → ${all.join('; ') || 'ok'}`;
}
