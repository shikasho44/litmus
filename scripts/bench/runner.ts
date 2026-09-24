/**
 * Runs authored probes through the real GameService / pipeline and records what happened.
 *
 * Methodology (docs/ai.md §4):
 *   - fresh game state per probe (no token → initial state; nothing unlocked but the
 *     visibleFromStart facts), so every probe is judged the same way in every mode;
 *   - leave-one-out (default): the probe under test (and exact duplicates) is removed from the
 *     case's probe bank first. Otherwise the rules judge would find the probe itself (similarity
 *     1.0) and the pipeline would skip the model entirely — the bench measures generalisation,
 *     not recall of authored answers. `--no-loo` measures the authored-bank behaviour instead.
 *   - components come from server/engine/factory.ts with METERED providers (call / cost caps),
 *     and are wrapped per probe so every model call, error, render reject and post-check is
 *     attributed to its probe.
 */
import type { AnswerClass, Case, Probe } from '../../shared/case-schema.js';
import type { AskResponse, PipelineMode } from '../../shared/api.js';
import type { EnvLike } from '../../server/engine/env.js';
import { createComponents } from '../../server/engine/factory.js';
import { GameService } from '../../server/engine/game.js';
import type { Judge, JudgeDecision, PipelineComponents, PostChecker, Renderer } from '../../server/engine/judge-types.js';
import { ContentRegistry, type LoadedCase } from '../../server/engine/registry.js';
import type { LineBank } from '../../server/engine/lines.js';
import { normalize } from '../../server/engine/normalize.js';
import type { EngineTrace } from '../../server/engine/trace.js';
import { createJevProvider } from '../../server/engine/providers/jev.js';
import { createOpenRouterLlm } from '../../server/engine/providers/openrouter-llm.js';
import { createCodexLlm } from '../../server/engine/providers/codex.js';
import { ProviderError, type DecisionProvider, type DecisionQuestion, type DecisionResult, type LlmProvider, type LlmRequest, type LlmResult } from '../../server/engine/providers/types.js';
import type { CandidateStrategy } from '../../server/engine/ai/jev-judge.js';
import { foreignFactMentions, leaksIn } from '../../server/engine/ai/guards.js';
import { expectedQtype, type ProbeRecord, type QType, type RunRecord } from './metrics.js';

/* ------------------------------------------------------------------ */
/* Metered providers                                                   */
/* ------------------------------------------------------------------ */

export interface Meter {
  calls: number;
  errors: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  requestChars: number;
  errorKinds: Record<string, number>;
}

const newMeter = (): Meter => ({ calls: 0, errors: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, requestChars: 0, errorKinds: {} });

export class MeteredDecision implements DecisionProvider {
  readonly name: string;
  readonly meter = newMeter();
  constructor(private readonly inner: DecisionProvider, private readonly capUsd: number) {
    this.name = inner.name;
  }
  async decide(state: unknown, questions: Record<string, DecisionQuestion>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<DecisionResult> {
    if (this.meter.costUsd >= this.capUsd) throw new ProviderError('jev', 'config', `bench Jev budget cap $${this.capUsd} reached`);
    this.meter.calls++;
    this.meter.requestChars += JSON.stringify({ state, questions }).length;
    try {
      const r = await this.inner.decide(state, questions, opts);
      this.meter.costUsd += r.usage.costUsd;
      this.meter.inputTokens += r.usage.inputTokens;
      this.meter.outputTokens += r.usage.outputTokens;
      return r;
    } catch (e) {
      this.meter.errors++;
      const k = e instanceof ProviderError ? e.kind : 'other';
      this.meter.errorKinds[k] = (this.meter.errorKinds[k] ?? 0) + 1;
      throw e;
    }
  }
}

export class MeteredLlm implements LlmProvider {
  readonly name: string;
  readonly meter = newMeter();
  constructor(private readonly inner: LlmProvider, private readonly maxCalls: number, private readonly capUsd: number) {
    this.name = inner.name;
  }
  async complete(req: LlmRequest): Promise<LlmResult> {
    if (this.meter.calls >= this.maxCalls) throw new ProviderError('llm', 'config', `bench LLM call cap ${this.maxCalls} reached`);
    if (this.meter.costUsd >= this.capUsd) throw new ProviderError('llm', 'config', `bench LLM budget cap $${this.capUsd} reached`);
    this.meter.calls++;
    this.meter.requestChars += req.system.length + req.user.length;
    try {
      const r = await this.inner.complete(req);
      this.meter.costUsd += r.usage.costUsd;
      this.meter.inputTokens += r.usage.inputTokens;
      this.meter.outputTokens += r.usage.outputTokens;
      return r;
    } catch (e) {
      this.meter.errors++;
      const k = e instanceof ProviderError ? e.kind : 'other';
      this.meter.errorKinds[k] = (this.meter.errorKinds[k] ?? 0) + 1;
      throw e;
    }
  }
}

/** Dry-run stand-ins: no network, deterministic, every call counted. */
export function dryDecision(): DecisionProvider {
  return {
    name: 'jev:dry-run',
    async decide(_state, questions) {
      const answers: DecisionResult['answers'] = {};
      for (const [k, q] of Object.entries(questions)) {
        if (q.type === 'noul') answers[k] = { type: 'noul', noul: 0 };
        else if (q.type === 'score') answers[k] = { type: 'score', score: 0, probabilities: { '0': 1 }, confidence: 1 };
        else {
          const first = Object.keys(q.criteria)[0];
          answers[k] = { type: 'choice', choice: first, probabilities: { [first]: 1 }, confidence: 1 };
        }
      }
      return { answers, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 0 };
    },
  };
}

export function dryLlm(): LlmProvider {
  return { name: 'llm:dry-run', async complete() { return { text: '', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 0, model: 'dry-run' }; } };
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export interface BenchSetup {
  mode: PipelineMode;
  env: EnvLike;
  strategy?: CandidateStrategy;
  dryRun: boolean;
  maxJevUsd: number;
  maxLlmCalls: number;
  maxLlmUsd: number;
}

export interface BuiltComponents {
  components: PipelineComponents;
  jev?: MeteredDecision;
  llm?: MeteredLlm;
}

export function buildComponents(s: BenchSetup): BuiltComponents {
  if (s.mode === 'rules') return { components: { mode: 'rules', warnings: [] } };
  const needsJev = s.mode !== 'llm';
  const needsLlm = s.mode !== 'jev';
  let jev: MeteredDecision | undefined;
  let llm: MeteredLlm | undefined;
  if (needsJev) jev = new MeteredDecision(s.dryRun ? dryDecision() : createJevProvider(s.env), s.maxJevUsd);
  if (needsLlm) {
    const kind = (s.env.LLM_PROVIDER ?? 'openrouter').toLowerCase();
    const inner = s.dryRun ? dryLlm() : kind === 'codex' ? createCodexLlm(s.env) : createOpenRouterLlm(s.env);
    llm = new MeteredLlm(inner, s.maxLlmCalls, s.maxLlmUsd);
  }
  const env = { ...s.env, DECISION_PROVIDER: 'jev', LLM_PROVIDER: s.env.LLM_PROVIDER || 'openrouter' };
  const components = createComponents(env, s.mode, { decisionProvider: jev, llm, strategy: s.strategy });
  return { components, jev, llm };
}

/* ------------------------------------------------------------------ */
/* Per-probe capture                                                   */
/* ------------------------------------------------------------------ */

interface Capture {
  judgeCalls: number;
  judgeErrors: number;
  decision?: JudgeDecision;
  renderCalls: number;
  renderErrors: number;
  renderRejects: string[];
  renderFellBack: boolean;
  checkCalls: number;
  checkErrors: number;
}

function wrap(base: PipelineComponents, cap: Capture): PipelineComponents {
  const judge: Judge | undefined = base.judge && {
    name: base.judge.name,
    async judge(input) {
      cap.judgeCalls++;
      try {
        const d = await base.judge!.judge(input);
        cap.decision = d;
        return d;
      } catch (e) {
        cap.judgeErrors++;
        throw e;
      }
    },
  };
  const renderer: Renderer | undefined = base.renderer && {
    name: base.renderer.name,
    canned: base.renderer.canned,
    async render(input) {
      cap.renderCalls++;
      try {
        const r = await base.renderer!.render(input);
        const fb = (r.raw as { fallback?: string[] } | undefined)?.fallback;
        cap.renderFellBack = !!fb;
        if (fb) cap.renderRejects.push(...fb.map((x) => `render:${x}`));
        return r;
      } catch (e) {
        cap.renderErrors++;
        throw e;
      }
    },
  };
  const postChecker: PostChecker | undefined = base.postChecker && {
    name: base.postChecker.name,
    async check(input) {
      cap.checkCalls++;
      try {
        const r = await base.postChecker!.check(input);
        if (!r.pass) cap.renderRejects.push(...r.reasons.map((x) => `check:${x}`));
        return r;
      } catch (e) {
        cap.checkErrors++;
        throw e;
      }
    },
  };
  return { ...base, judge, renderer, postChecker };
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

export interface ProbeTask {
  loaded: LoadedCase;
  probe: Probe;
  index: number;
}

export const isSafetyProbe = (p: Probe): boolean => /^SAFETY/i.test(p.note ?? '');

/** The case with the probe under test (and exact normalised duplicates) removed. */
export function leaveOneOut(loaded: LoadedCase, probe: Probe): LoadedCase {
  const n = normalize(probe.q);
  const data: Case = { ...loaded.data, probes: loaded.data.probes.filter((p) => normalize(p.q) !== n) };
  return { ...loaded, data, index: { ...loaded.index, probes: loaded.index.probes.filter((p) => p.norm !== n) } };
}

interface PartTraceLike {
  factIds?: string[];
  source?: string;
  meta?: string;
  judge?: { raw?: { qtype?: string }; rules?: string; source?: string; note?: string } | unknown;
  rendered?: { text: string; canned: boolean };
  probes?: { q: string; score: number; label: string; flip: boolean }[];
  candidates?: { id: string; score: number }[];
}

export function qtypeOf(part: PartTraceLike | undefined): QType {
  const raw = (part?.judge as { raw?: { qtype?: string } } | undefined)?.raw;
  const q = raw?.qtype;
  if (q === 'yesno' || q === 'open' || q === 'meta' || q === 'unknown') return q;
  if (part?.meta && part.meta !== 'open') return 'meta';
  if (part?.meta === 'open') return 'open';
  if (part?.source === 'fallback') return 'unknown';
  return 'yesno';
}

export async function runOne(task: ProbeTask, base: PipelineComponents, lines: LineBank, loo: boolean): Promise<RunRecord> {
  const loaded = loo ? leaveOneOut(task.loaded, task.probe) : task.loaded;
  const registry = new ContentRegistry([loaded], [], lines, undefined);
  const cap: Capture = { judgeCalls: 0, judgeErrors: 0, renderCalls: 0, renderErrors: 0, renderRejects: [], renderFellBack: false, checkCalls: 0, checkErrors: 0 };
  const svc = new GameService({ content: () => registry, secret: 'bench-secret-0123456789', components: wrap(base, cap), dev: true });
  const t0 = performance.now();
  const res: AskResponse = await svc.ask({ caseId: loaded.data.id, question: task.probe.q }, { admin: true, withTrace: true });
  const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
  const trace = res.trace as EngineTrace | undefined;
  const part = trace?.parts?.[0] as PartTraceLike | undefined;
  const a0 = res.answers[0];
  const c = task.loaded.data;
  const byId = new Map(c.facts.map((f) => [f.id, f]));
  const allowedIds = new Set(res.progress.unlocked);
  const allowedFacts = [...allowedIds].map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
  const renderAttempted = cap.renderCalls > 0 || (base.mode === 'llm' && !!cap.decision?.line);
  const canned = part?.rendered?.canned ?? true;
  const llmLine = !canned && !cap.renderFellBack;
  const line = a0?.line ?? '';
  const unlockedIds = res.answers.flatMap((a) => a.unlocked.map((f) => f.id));
  return {
    answer: (a0?.answerClass ?? 'vague') as AnswerClass,
    factIds: part?.factIds ?? [],
    qtype: qtypeOf(part),
    line,
    notice: (a0 as { notice?: string } | undefined)?.notice,
    unlocked: unlockedIds,
    latencyMs,
    costUsd: trace?.costUsd ?? 0,
    fastPath: trace?.fastPath ?? true,
    degraded: !!trace?.degraded,
    providerErrors: cap.judgeErrors + cap.renderErrors + cap.checkErrors,
    renderFallback: renderAttempted && !llmLine,
    llmLine,
    leaks: leaksIn(line, c.leakTerms, allowedFacts),
    level4Cards: unlockedIds.filter((id) => (byId.get(id)?.spoilerLevel ?? 0) >= 4),
    foreign: llmLine ? foreignFactMentions(line, task.probe.q, c.facts, allowedIds) : [],
    selfHarmFlag: cap.decision?.flags?.selfHarm,
    judge: {
      model: cap.decision ? { answer: cap.decision.answerClass, conf: cap.decision.confidence, facts: cap.decision.factIds, raw: cap.decision.raw } : undefined,
      rules: (part?.judge as { rules?: string } | undefined)?.rules,
      note: (part?.judge as { note?: string } | undefined)?.note,
      probe: part?.probes?.[0],
      candidates: part?.candidates?.length ?? 0,
    },
    renderRejects: cap.renderRejects.length > 0 ? cap.renderRejects : undefined,
  };
}

export interface RunAllOptions {
  tasks: ProbeTask[];
  components: PipelineComponents;
  lines: LineBank;
  loo: boolean;
  repeat: number;
  concurrency: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runAll(o: RunAllOptions): Promise<ProbeRecord[]> {
  const records: ProbeRecord[] = o.tasks.map((t) => ({
    caseId: t.loaded.data.id,
    index: t.index,
    q: t.probe.q,
    kind: t.probe.kind,
    expected: t.probe.answer,
    expectedFacts: t.probe.facts,
    expectedQtype: expectedQtype(t.probe.kind, t.probe.answer),
    safety: isSafetyProbe(t.probe),
    runs: [],
  }));
  const jobs: { t: number; r: number }[] = [];
  for (let r = 0; r < Math.max(1, o.repeat); r++) for (let t = 0; t < o.tasks.length; t++) jobs.push({ t, r });
  let next = 0;
  let done = 0;
  const results: RunRecord[][] = o.tasks.map(() => []);
  const worker = async () => {
    for (;;) {
      const j = next++;
      if (j >= jobs.length) return;
      const { t, r } = jobs[j];
      try {
        results[t][r] = await runOne(o.tasks[t], o.components, o.lines, o.loo);
      } catch (e) {
        // A thrown ask is a bench bug or an engine crash — record it as a degraded vague answer.
        results[t][r] = {
          answer: 'vague', factIds: [], qtype: 'unknown', line: `ERROR: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`, unlocked: [], latencyMs: 0, costUsd: 0,
          fastPath: true, degraded: true, providerErrors: 1, renderFallback: false, llmLine: false, leaks: [], level4Cards: [], foreign: [],
        };
      }
      done++;
      o.onProgress?.(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, jobs.length)) }, worker));
  records.forEach((rec, i) => (rec.runs = results[i].filter(Boolean)));
  return records;
}
