/**
 * The ask pipeline (design bible §5-2):
 *
 *   question → normalise/split → retrieve → judge (rules | model) → policy (code rules)
 *            → reply (canned FAST PATH | model phrasing) → post-check → unlock + token + trace
 *
 * Safety first: before anything else (probes, judges, models) the message and each part go
 * through safety.ts. A hit — or a model judge flagging selfHarm ≥ 0.5 — answers the whole turn
 * with one calm, serious fixed line, answerClass 'cannot', notice 'support', no unlocks, no
 * model phrasing; the trace records only the rule (the text is redacted).
 *
 * Failure policy: a model call is retried once on a retryable ProviderError, then that
 * part of the turn degrades to the rules judge (marked degraded, notice 'degraded'; the canned
 * error.degraded line is prefixed). A per-turn deadline keeps the whole turn under the
 * HTTP client's timeout. Player state is only ever advanced by policy.ts — never lost.
 */
import type { AskAnswer, HolmaMood, PipelineMode } from '../../shared/api.js';
import type { Fact } from '../../shared/case-schema.js';
import { ANSWER_CLASSES } from '../../shared/case-schema.js';
import { ProviderError, type Usage } from './providers/types.js';
import type { JudgeDecision, PipelineComponents } from './judge-types.js';
import { analyze, MAX_QUESTION_CHARS, normalize, splitQuestions, whKindOf, type AnalyzedQuestion } from './normalize.js';
import { retrieve, type Candidates } from './retrieve.js';
import { judgeRules } from './rules-judge.js';
import { applyPolicy, withPolicy, type PolicyResult } from './policy.js';
import { composeLine, type LineBank } from './lines.js';
import { memoView, publicFact } from './public-view.js';
import type { LoadedCase } from './registry.js';
import type { GameState } from './state.js';
import type { BudgetGuard } from './budget.js';
import { StageTimer, type EngineTrace, type PartTrace } from './trace.js';
import { detectSafety, flaggedByModel, safetyLine, type SafetyHit } from './safety.js';
import { isCharged } from '../../shared/budget.js';

export const TURN_DEADLINE_MS = 9000;
export const STAGE_TIMEOUT_MS = { judge: 4500, render: 4000, check: 3000 } as const;
/** Rules probe matches this close are authored answers: the model is not consulted. */
export const PROBE_SHORTCUT = 0.97;
const MIN_CALL_MS = 1200;
const MAX_LINE_CHARS = 160;

export interface AskContext {
  loaded: LoadedCase;
  lines: LineBank;
  question: string;
  state: GameState;
  components: PipelineComponents;
  budget?: BudgetGuard;
  deadlineMs?: number;
  /**
   * Hard question budget (shared/budget.ts): at most `limit − state.spent` counted parts are
   * answered; later parts of the message are dropped (trace `budget-dropped:n`). The caller
   * refuses a turn with nothing left (game.ts), so at least the first counted part fits.
   */
  limit?: number;
}

export interface AskOutcome {
  answers: AskAnswer[];
  state: GameState;
  trace: EngineTrace;
  degraded: boolean;
  /** Set when the turn was answered by the safety filter (the caller must not log the text). */
  safety?: SafetyHit;
}

/** Placeholder written to traces instead of a question the safety filter answered. */
export const REDACTED = '[safety]';

/** Does this judged part count against the question budget? (shared/budget.ts) */
export function chargedDecision(d: Pick<JudgeDecision, 'answerClass' | 'meta'>): boolean {
  return isCharged(d.answerClass, d.meta);
}

/**
 * The whole turn answered by the safety filter: one serious fixed line, 'cannot', notice
 * 'support', nothing unlocked. Counts as one question (never against the budget). The question
 * text is not traced.
 */
function safetyOutcome(ctx: AskContext, hit: SafetyHit, timer: StageTimer, usage: Usage, mode: PipelineMode, budgetExceeded: boolean): AskOutcome {
  const line = safetyLine(hit);
  const answer: AskAnswer = {
    question: ctx.question.trim(),
    answerClass: 'cannot',
    line,
    mood: 'serious',
    unlocked: [],
    memos: [],
    notice: 'support',
    free: true,
  };
  const judge = { source: 'safety', kind: hit.kind, rule: hit.rule };
  const part: PartTrace = {
    question: REDACTED,
    normalized: REDACTED,
    negated: false,
    open: false,
    answerClass: 'cannot',
    source: 'meta',
    meta: 'safety',
    confidence: 1,
    closeness: 0,
    factIds: [],
    unlocked: [],
    blocked: [],
    candidates: [],
    probes: [],
    judge,
    rendered: { text: line, canned: true },
  };
  ctx.budget?.add(usage.costUsd);
  const trace: EngineTrace = {
    mode: budgetExceeded ? 'rules' : mode,
    requestedMode: ctx.components.mode,
    normalized: [REDACTED],
    candidates: [],
    judge,
    confidence: 1,
    fastPath: true,
    fallback: [budgetExceeded ? 'budget' : undefined, `safety:${hit.kind}:${hit.rule}`].filter(Boolean).join(' '),
    timings: timer.timings(),
    tokens: { input: usage.inputTokens, output: usage.outputTokens },
    costUsd: Math.round(usage.costUsd * 1e8) / 1e8,
    parts: [part],
    degraded: false,
  };
  return { answers: [answer], state: { ...ctx.state, asked: ctx.state.asked + 1 }, trace, degraded: false, safety: hit };
}

interface CallResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  attempts: number;
}

function addUsage(acc: Usage, u?: Usage): void {
  if (!u) return;
  acc.inputTokens += u.inputTokens || 0;
  acc.outputTokens += u.outputTokens || 0;
  acc.costUsd += u.costUsd || 0;
}

async function withTimeout<T>(fn: (signal: AbortSignal, timeoutMs: number) => Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new ProviderError(provider, 'timeout', `no answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(ac.signal, timeoutMs), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Calls a model once, retries once on a retryable ProviderError, respects the deadline. */
export async function callModel<T>(
  provider: string,
  fn: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
  stageTimeout: number,
  remaining: () => number,
): Promise<CallResult<T>> {
  let attempts = 0;
  let lastError = '';
  while (attempts < 2) {
    const left = remaining() - 300;
    if (left < MIN_CALL_MS) return { ok: false, error: lastError ? `${lastError}; deadline` : 'deadline', attempts };
    attempts++;
    try {
      const value = await withTimeout(fn, Math.min(stageTimeout, left), provider);
      return { ok: true, value, attempts };
    } catch (e) {
      if (e instanceof ProviderError) {
        lastError = `${e.provider}:${e.kind}`;
        if (!e.retryable) break;
      } else {
        lastError = `error:${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`;
        break;
      }
    }
  }
  return { ok: false, error: lastError, attempts };
}

/** Normalised leak terms present in `line` that the player is not yet allowed to know. */
export function findLeaks(line: string, leakTerms: string[], allowedFacts: Fact[]): string[] {
  const n = normalize(line);
  const allowed = normalize(allowedFacts.map((f) => f.text).join(' '));
  return leakTerms.filter((t) => n.includes(t) && !allowed.includes(t));
}

/** Clamps a model decision to the case (unknown fact ids dropped, numbers bounded). */
export function sanitizeDecision(d: JudgeDecision, loaded: LoadedCase, fallback: JudgeDecision): JudgeDecision {
  const answerClass = (ANSWER_CLASSES as readonly string[]).includes(d.answerClass) ? d.answerClass : fallback.answerClass;
  const factIds = [...new Set((d.factIds ?? []).filter((id) => loaded.index.factById.has(id)))];
  const confidence = Number.isFinite(d.confidence) ? Math.min(1, Math.max(0, d.confidence)) : 0;
  const closeness = Math.min(3, Math.max(0, Math.round(Number(d.closeness) || 0))) as 0 | 1 | 2 | 3;
  return { ...d, answerClass, factIds, confidence, closeness, source: d.source ?? 'model' };
}

/**
 * AskAnswer.nearCore: THIS answer shows the player circling the core truth — a spoilerLevel-4
 * topic confirmed, or closeness 3 on an affirming answer (policy.ts) — or the sticky state flag
 * switched on with this answer (e.g. progress crossed 75 %). It is exactly when the canned line
 * carries a nearCore flavour line, so the UI reaction and Holma's words always agree.
 */
export function nearCoreOf(p: PolicyResult): boolean {
  return p.nearCoreHit || p.nearCoreNew;
}

interface PartWork {
  raw: string;
  q: AnalyzedQuestion;
  cand: Candidates;
  rules: JudgeDecision;
  decision: JudgeDecision;
  degraded: boolean;
  fallback?: string;
  judgeNote?: string;
}

export async function runAsk(ctx: AskContext): Promise<AskOutcome> {
  const timer = new StageTimer();
  const deadline = ctx.deadlineMs ?? TURN_DEADLINE_MS;
  const remaining = () => deadline - timer.elapsed();
  const { loaded, lines, components } = ctx;
  const c = loaded.data;
  const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  const budgetExceeded = ctx.budget?.exceeded() ?? false;
  const judge = budgetExceeded ? undefined : components.judge;
  const renderer = budgetExceeded ? undefined : components.renderer;
  const postChecker = budgetExceeded ? undefined : components.postChecker;

  // 1. split + analyse + retrieve + rules (all deterministic, cheap)
  // Over-long messages are not split: the whole thing is answered once as meta 'tooLong'.
  const tooLong = [...ctx.question].length > MAX_QUESTION_CHARS;
  const split = tooLong ? { parts: [ctx.question], dropped: 0 } : timer.timeSync('normalize', () => splitQuestions(ctx.question));
  const rawParts = split.parts.length > 0 ? split.parts : [ctx.question];

  // 0. safety filter — before probes, judges and models; never sent to a model
  const safetyHit = timer.timeSync('safety', () => detectSafety(ctx.question) ?? rawParts.map((p) => detectSafety(p)).find((h): h is SafetyHit => !!h));
  if (safetyHit) return safetyOutcome(ctx, safetyHit, timer, usage, components.mode, budgetExceeded);

  const work: PartWork[] = rawParts.map((raw) => {
    const q = timer.timeSync('normalize', () => analyze(raw));
    const cand = timer.timeSync('retrieve', () => retrieve(q, loaded.index));
    const rules = timer.timeSync('rules', () => judgeRules(q, cand, loaded.index));
    return { raw, q, cand, rules, decision: rules, degraded: false };
  });

  // 2. model judge (parts in parallel)
  if (judge) {
    await timer.time('judge', () =>
      Promise.all(
        work.map(async (w) => {
          const hardMeta = w.rules.meta === 'empty' || w.rules.meta === 'tooLong' || w.rules.meta === 'rude';
          if (hardMeta) return void (w.judgeNote = 'skipped:meta');
          if (w.rules.guard) return void (w.judgeNote = `skipped:${w.rules.guard}`);
          if (w.rules.source === 'probe' && w.rules.confidence >= PROBE_SHORTCUT) return void (w.judgeNote = 'skipped:probe-shortcut');
          const unlocked = new Set(ctx.state.unlocked);
          const r = await callModel(
            judge.name,
            (signal, timeoutMs) => judge.judge({ caseData: c, index: loaded.index, question: w.q, candidates: w.cand, rules: w.rules, unlocked, signal, timeoutMs }),
            STAGE_TIMEOUT_MS.judge,
            remaining,
          );
          if (r.ok && r.value) {
            w.decision = sanitizeDecision(r.value, loaded, w.rules);
            addUsage(usage, r.value.usage);
          } else {
            w.degraded = true;
            w.fallback = `judge:${r.error}`;
          }
        }),
      ),
    );
  }

  // A model judge may flag self-harm / harming others the rules filter missed.
  if (work.some((w) => w.decision !== w.rules && flaggedByModel(w.decision.flags))) {
    return safetyOutcome(ctx, { kind: 'model', rule: 'judge-flag' }, timer, usage, components.mode, budgetExceeded);
  }

  // 2b. hard question budget: keep the parts that fit (free parts always fit until the cut)
  let budgetDropped = 0;
  if (ctx.limit !== undefined) {
    let left = ctx.limit - ctx.state.spent;
    let keep = work.length;
    for (let i = 0; i < work.length; i++) {
      if (!chargedDecision(work[i].decision)) continue;
      if (left <= 0) {
        keep = i;
        break;
      }
      left--;
    }
    if (keep > 0 && keep < work.length) {
      budgetDropped = work.length - keep;
      work.splice(keep);
    }
  }

  // 3. policy + canned line (sequential: a later part sees earlier unlocks)
  let state: GameState = ctx.state;
  const partTraces: PartTrace[] = [];
  const composed: { policy: PolicyResult; text: string; mood: HolmaMood; stateAfter: GameState }[] = [];
  const turnDegraded = work.some((w) => w.degraded);
  work.forEach((w, i) => {
    const policy = timer.timeSync('policy', () => applyPolicy(c, loaded.index, w.decision, state, { negated: w.q.negated }));
    state = withPolicy(state, policy);
    const unlockedCore = policy.unlock.some((id) => (loaded.index.factById.get(id)?.fact.importance ?? 0) >= 3);
    const line = timer.timeSync('render', () =>
      composeLine(lines, {
        answerClass: w.decision.answerClass,
        meta: w.decision.meta,
        unlockedCore,
        unlocked: policy.unlock.length > 0,
        nearCore: nearCoreOf(policy),
        part: i,
        parts: work.length,
        degraded: turnDegraded,
        seed: state.asked + i,
        caseNearCore: c.holmaLines.nearCore,
        whKind: w.decision.meta === 'open' ? whKindOf(w.q.norm) : undefined,
      }),
    );
    composed.push({ policy, text: line.text, mood: line.mood, stateAfter: state });
  });
  // Empty / over-long input does not count as a question; only charged parts count against the budget.
  state = {
    ...state,
    asked: state.asked + work.filter((w) => w.decision.meta !== 'empty' && w.decision.meta !== 'tooLong').length,
    spent: state.spent + work.filter((w) => chargedDecision(w.decision)).length,
  };

  // 4. model phrasing (+ post-check), parts in parallel; canned stays the fallback
  const finalLines = composed.map((x) => ({ text: x.text, mood: x.mood, canned: true }));
  const renderTrace: { prompt?: string; output?: string; postCheck?: { pass: boolean; detail: unknown } }[] = work.map(() => ({}));
  const modelLineAllowed = (w: PartWork) => !w.degraded && !(w.decision.meta && w.decision.meta !== 'open');
  if ((renderer && !renderer.canned) || components.mode === 'llm') {
    await timer.time('render', () =>
      Promise.all(
        work.map(async (w, i) => {
          if (!modelLineAllowed(w)) return;
          const { policy, stateAfter } = composed[i];
          const allowedFacts = stateAfter.unlocked.map((id) => loaded.index.factById.get(id)?.fact).filter((f): f is Fact => !!f);
          const newlyUnlocked = policy.unlock.map((id) => loaded.index.factById.get(id)!.fact);
          const accept = async (text: string | undefined): Promise<boolean> => {
            const t = (text ?? '').trim();
            if (!t || t.length > MAX_LINE_CHARS) {
              renderTrace[i].postCheck = { pass: false, detail: { reason: 'length', chars: t.length } };
              return false;
            }
            const leaks = findLeaks(t, loaded.index.leakTerms, allowedFacts);
            if (leaks.length > 0) {
              renderTrace[i].postCheck = { pass: false, detail: { reason: 'leak', leaks } };
              return false;
            }
            if (!postChecker) return true;
            const r = await timer.time('check', () =>
              callModel(
                postChecker.name,
                (signal, timeoutMs) =>
                  postChecker.check({ caseData: c, question: w.raw, answerClass: w.decision.answerClass, line: t, allowedFacts, leakTerms: loaded.index.leakTerms, signal, timeoutMs }),
                STAGE_TIMEOUT_MS.check,
                remaining,
              ),
            );
            if (!r.ok || !r.value) {
              renderTrace[i].postCheck = { pass: false, detail: { reason: 'checker-failed', error: r.error } };
              return false;
            }
            addUsage(usage, r.value.usage);
            renderTrace[i].postCheck = { pass: r.value.pass, detail: { reasons: r.value.reasons, raw: r.value.raw } };
            return r.value.pass;
          };

          // Full-LLM mode: the judging model already phrased the line.
          if (components.mode === 'llm' && w.decision.line) {
            if (await accept(w.decision.line)) {
              finalLines[i] = { text: w.decision.line.trim(), mood: w.decision.mood ?? composed[i].mood, canned: false };
              renderTrace[i].output = w.decision.line;
              return;
            }
          }
          if (!renderer || renderer.canned) return;
          for (let attempt = 0; attempt < 2; attempt++) {
            const r = await callModel(
              renderer.name,
              (signal, timeoutMs) =>
                renderer.render({
                  caseData: c,
                  question: w.raw,
                  answerClass: w.decision.answerClass,
                  allowedFacts,
                  newlyUnlocked,
                  cannedLine: composed[i].text,
                  mood: composed[i].mood,
                  // The answer's own nearCore moment (not the sticky state): the canned line and the
                  // model phrasing then agree on when Holma shows it.
                  nearCore: nearCoreOf(composed[i].policy),
                  signal,
                  timeoutMs,
                }),
              STAGE_TIMEOUT_MS.render,
              remaining,
            );
            if (!r.ok || !r.value) {
              w.fallback = [w.fallback, `render:${r.error}`].filter(Boolean).join(' ');
              return;
            }
            addUsage(usage, r.value.usage);
            renderTrace[i].prompt = r.value.prompt;
            renderTrace[i].output = r.value.text;
            if (await accept(r.value.text)) {
              finalLines[i] = { text: r.value.text.trim(), mood: r.value.mood ?? composed[i].mood, canned: false };
              return;
            }
            // Post-check NG → re-render once (design bible §5-2), then canned.
          }
          w.fallback = [w.fallback, 'render:rejected'].filter(Boolean).join(' ');
        }),
      ),
    );
  }

  // 5. answers + trace
  const answers: AskAnswer[] = work.map((w, i) => {
    const { policy } = composed[i];
    const a: AskAnswer = {
      question: w.raw,
      answerClass: w.decision.answerClass,
      line: finalLines[i].text,
      mood: finalLines[i].mood,
      unlocked: policy.unlock.map((id) => publicFact(loaded.index.factById.get(id)!.fact)),
      memos: policy.memos.map((m) => memoView(c, m)).filter((m): m is NonNullable<typeof m> => !!m),
    };
    if (w.degraded) a.notice = 'degraded';
    if (nearCoreOf(policy)) a.nearCore = true;
    if (!chargedDecision(w.decision)) a.free = true;
    return a;
  });

  work.forEach((w, i) => {
    const { policy } = composed[i];
    partTraces.push({
      question: w.raw,
      normalized: w.q.norm,
      negated: w.q.negated,
      open: w.q.open,
      answerClass: w.decision.answerClass,
      source: w.decision.source,
      meta: w.decision.meta,
      confidence: w.decision.confidence,
      closeness: w.decision.closeness,
      nearCore: nearCoreOf(policy) || undefined,
      factIds: w.decision.factIds,
      unlocked: policy.unlock,
      blocked: policy.blocked,
      candidates: w.cand.facts.map((f) => ({ id: f.id, score: f.score })),
      probes: w.cand.probes.map((p) => ({ q: p.entry.probe.q, score: p.score, label: p.entry.probe.answer, flip: p.flip })),
      judge: w.decision === w.rules ? { source: 'rules', note: w.judgeNote } : { source: 'model', raw: w.decision.raw, latencyMs: w.decision.latencyMs, rules: w.rules.answerClass },
      rendered: { text: finalLines[i].text, canned: finalLines[i].canned },
      postCheck: renderTrace[i].postCheck,
      fallback: w.fallback,
    });
  });

  ctx.budget?.add(usage.costUsd);
  const effectiveMode: PipelineMode = budgetExceeded ? 'rules' : components.mode;
  const bestProbe = work
    .map((w) => w.cand.probes[0])
    .filter((p) => !!p)
    .sort((a, b) => b.score - a.score)[0];
  const candMap = new Map<string, number>();
  for (const w of work) for (const f of w.cand.facts) candMap.set(f.id, Math.max(candMap.get(f.id) ?? 0, f.score));
  const fallbacks = [
    budgetExceeded ? 'budget' : undefined,
    split.dropped > 0 ? `dropped:${split.dropped}` : undefined,
    budgetDropped > 0 ? `budget-dropped:${budgetDropped}` : undefined,
    ...work.map((w) => w.fallback),
  ].filter(Boolean);
  const firstRendered = renderTrace.find((r) => r.prompt || r.output);
  const trace: EngineTrace = {
    mode: effectiveMode,
    requestedMode: components.mode,
    normalized: work.map((w) => w.q.norm),
    candidates: [...candMap].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, 8),
    probeMatch: bestProbe ? { q: bestProbe.entry.probe.q, score: bestProbe.score } : undefined,
    judge: work.length === 1 ? partTraces[0].judge : partTraces.map((p) => p.judge),
    confidence: Math.min(...work.map((w) => w.decision.confidence)),
    fastPath: finalLines.every((l) => l.canned),
    llmInput: firstRendered?.prompt,
    llmOutput: firstRendered?.output,
    postCheck: renderTrace.find((r) => r.postCheck)?.postCheck,
    fallback: fallbacks.length > 0 ? fallbacks.join(' ') : undefined,
    timings: timer.timings(),
    tokens: { input: usage.inputTokens, output: usage.outputTokens },
    costUsd: Math.round(usage.costUsd * 1e8) / 1e8,
    parts: partTraces,
    degraded: turnDegraded,
  };

  return { answers, state, trace, degraded: turnDegraded };
}
