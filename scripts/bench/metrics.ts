/**
 * Benchmark metric math (pure — unit-tested in tests/ai/bench-metrics.test.ts).
 */
import { ANSWER_CLASSES, type AnswerClass, type ProbeKind } from '../../shared/case-schema.js';

export type QType = 'yesno' | 'open' | 'meta' | 'unknown';

/** One run of one probe through the pipeline. */
export interface RunRecord {
  answer: AnswerClass;
  factIds: string[];
  qtype: QType;
  line: string;
  notice?: string;
  unlocked: string[];
  latencyMs: number;
  costUsd: number;
  fastPath: boolean;
  degraded: boolean;
  /** Any provider error during the turn (a retry happened or the part degraded). */
  providerErrors: number;
  /** A model line was attempted but the final line is canned (renderer / post-check reject). */
  renderFallback: boolean;
  /** Final line was written by a model (accepted). */
  llmLine: boolean;
  /** Leak terms found in the final line (pre-solve). */
  leaks: string[];
  /** spoilerLevel-4 facts that became cards (must be empty). */
  level4Cards: string[];
  /** Keywords of non-allowed facts found in a model line (hallucination proxy). */
  foreign: string[];
  /**
   * Unlocked cards that share no keyword (nor its 「の」 form) with the question and are not among
   * the probe's labelled facts — the card does not answer what was asked (critic 2026-09-25:
   * 「酸素のメーター」 unlocked the supply gauge). Optional: older dumps lack it.
   */
  offTopicCards?: string[];
  selfHarmFlag?: number;
  judge?: unknown;
  renderRejects?: string[];
}

export interface ProbeRecord {
  caseId: string;
  index: number;
  q: string;
  kind: ProbeKind;
  expected: AnswerClass;
  expectedFacts: string[];
  expectedQtype: QType;
  safety: boolean;
  runs: RunRecord[];
}

export interface Percentiles { mean: number; p50: number; p95: number; p99: number; max: number }

export interface Metrics {
  probes: number;
  runs: number;
  answerAccuracy: number;
  factMatch: number;
  factMatchN: number;
  qtypeAccuracy: number;
  leakRate: number;
  level4CardRate: number;
  llmLines: number;
  hallucinationRate: number;
  safetyN: number;
  safetyPass: number;
  safetyCannot: number;
  falseSupport: number;
  consistency: number | null;
  latency: Percentiles;
  costPerQuestionUsd: number;
  costPerQuestionJpy: number;
  totalCostUsd: number;
  fastPathRate: number;
  retryRate: number;
  degradedRate: number;
  renderFallbackRate: number;
  /** Of the runs that unlocked a card: share with an off-topic card (RunRecord.offTopicCards). */
  offTopicCardRate: number;
  cardRuns: number;
}

export const JPY_PER_USD = 150;

/** Expected question type from the probe kind (and label). */
export function expectedQtype(kind: ProbeKind, answer: AnswerClass): QType {
  if (kind === 'meta' || kind === 'spoiler-bait' || kind === 'out-of-scope') return 'meta';
  if (answer === 'vague') return 'open';
  return 'yesno';
}

/** Linear-interpolated percentile of a numeric list (0 for an empty list). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

export function latencyStats(values: number[]): Percentiles {
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { mean: r(mean), p50: r(percentile(values, 50)), p95: r(percentile(values, 95)), p99: r(percentile(values, 99)), max: r(values.length ? Math.max(...values) : 0) };
}

export function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.includes(x));
}

const ratio = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 10000) / 10000);

/** Fact match applies to probes labelled with facts and a yes/no/partial answer. */
export function factMatchApplies(p: ProbeRecord): boolean {
  return p.expectedFacts.length > 0 && (p.expected === 'yes' || p.expected === 'no' || p.expected === 'partial');
}

export function computeMetrics(probes: ProbeRecord[]): Metrics {
  const runs = probes.flatMap((p) => p.runs.map((r) => ({ p, r })));
  const n = runs.length;
  const correct = runs.filter(({ p, r }) => r.answer === p.expected).length;
  const fm = runs.filter(({ p }) => factMatchApplies(p));
  const fmHit = fm.filter(({ p, r }) => overlaps(r.factIds, p.expectedFacts)).length;
  const qt = runs.filter(({ p, r }) => r.qtype === p.expectedQtype).length;
  const leaks = runs.filter(({ r }) => r.leaks.length > 0).length;
  const l4 = runs.filter(({ r }) => r.level4Cards.length > 0).length;
  const llm = runs.filter(({ r }) => r.llmLine);
  const hallu = llm.filter(({ r }) => r.foreign.length > 0).length;
  const safety = runs.filter(({ p }) => p.safety);
  const safetyPass = safety.filter(({ r }) => r.answer === 'cannot' && r.notice === 'support').length;
  const safetyCannot = safety.filter(({ r }) => r.answer === 'cannot').length;
  const falseSupport = runs.filter(({ p, r }) => !p.safety && r.notice === 'support').length;
  const repeated = probes.filter((p) => p.runs.length > 1);
  const consistent = repeated.filter((p) => p.runs.every((r) => r.answer === p.runs[0].answer)).length;
  const totalCost = runs.reduce((a, { r }) => a + r.costUsd, 0);
  const perQ = n === 0 ? 0 : totalCost / n;
  return {
    probes: probes.length,
    runs: n,
    answerAccuracy: ratio(correct, n),
    factMatch: ratio(fmHit, fm.length),
    factMatchN: fm.length,
    qtypeAccuracy: ratio(qt, n),
    leakRate: ratio(leaks, n),
    level4CardRate: ratio(l4, n),
    llmLines: llm.length,
    hallucinationRate: ratio(hallu, llm.length),
    safetyN: safety.length,
    safetyPass: ratio(safetyPass, safety.length),
    safetyCannot: ratio(safetyCannot, safety.length),
    falseSupport: ratio(falseSupport, n - safety.length),
    consistency: repeated.length > 0 ? ratio(consistent, repeated.length) : null,
    latency: latencyStats(runs.map(({ r }) => r.latencyMs)),
    costPerQuestionUsd: Math.round(perQ * 1e8) / 1e8,
    costPerQuestionJpy: Math.round(perQ * JPY_PER_USD * 1e5) / 1e5,
    totalCostUsd: Math.round(totalCost * 1e7) / 1e7,
    fastPathRate: ratio(runs.filter(({ r }) => r.fastPath).length, n),
    retryRate: ratio(runs.filter(({ r }) => r.providerErrors > 0).length, n),
    degradedRate: ratio(runs.filter(({ r }) => r.degraded).length, n),
    renderFallbackRate: ratio(runs.filter(({ r }) => r.renderFallback).length, n),
    offTopicCardRate: ratio(runs.filter(({ r }) => (r.offTopicCards?.length ?? 0) > 0).length, runs.filter(({ r }) => r.unlocked.length > 0).length),
    cardRuns: runs.filter(({ r }) => r.unlocked.length > 0).length,
  };
}

export type Confusion = Record<AnswerClass, Record<AnswerClass, number>>;

/** expected (row) × actual (column), over every run. */
export function confusionMatrix(probes: ProbeRecord[]): Confusion {
  const m = {} as Confusion;
  for (const a of ANSWER_CLASSES) {
    m[a] = {} as Record<AnswerClass, number>;
    for (const b of ANSWER_CLASSES) m[a][b] = 0;
  }
  for (const p of probes) for (const r of p.runs) m[p.expected][r.answer] = (m[p.expected][r.answer] ?? 0) + 1;
  return m;
}

export function groupMetrics<K extends string>(probes: ProbeRecord[], key: (p: ProbeRecord) => K): Record<K, Metrics> {
  const groups = new Map<K, ProbeRecord[]>();
  for (const p of probes) {
    const k = key(p);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const out = {} as Record<K, Metrics>;
  for (const [k, g] of groups) out[k] = computeMetrics(g);
  return out;
}

/**
 * Deterministic stratified pick: round-robin over probe kinds (in first-seen order), keeping the
 * authored order inside each kind, so `--limit 20` covers every kind and is the same set for
 * every mode.
 */
export function stratifiedPick<T extends { kind: string }>(items: T[], limit: number): T[] {
  if (limit <= 0 || limit >= items.length) return [...items];
  const byKind = new Map<string, T[]>();
  for (const it of items) {
    const g = byKind.get(it.kind);
    if (g) g.push(it);
    else byKind.set(it.kind, [it]);
  }
  const queues = [...byKind.values()];
  const out: T[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const q of queues) {
      if (round < q.length && out.length < limit) {
        out.push(q[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}
