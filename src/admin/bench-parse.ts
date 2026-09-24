/**
 * Tolerant reader for bench reports (bench/reports/*.json written by `npm run bench`,
 * see scripts/bench/report.ts → BenchReport). The admin page must not break when the report
 * format evolves, so this accepts several shapes and extracts "runs" with flat numeric
 * metrics:
 *
 *   { label, mode, effectiveMode, metrics: {…, latency:{p95…}}, byKind, byCase, confusion,
 *     failures[], spend, options, warnings[] }                     ← scripts/bench (v1): one run per file
 *   { modes | runs | results | byMode: [ {mode, metrics:{…}} … ] }  ← several runs in one file
 *   { modes | runs | results | byMode: { rules: {…}, jev: {…} } }
 *
 * Metrics are numeric leaves up to two levels deep (e.g. `answerAccuracy`, `latency.p95`);
 * arrays are ignored. Top-level scalars become report metadata.
 */
import type { BenchReportInfo } from './types';
import { fmtMs, fmtNum, fmtPct, fmtUsd } from './format';

export type Scalar = string | number | boolean;

export interface BenchRun {
  /** Unique across all reports: `${file}::${label}` */
  key: string;
  file: string;
  mode: string;
  /** Report label (e.g. `jev[wide]-exp20`), falls back to the mode. */
  label: string;
  dryRun: boolean;
  metrics: Record<string, number>;
}

export interface BenchFailure {
  c: string;
  q: string;
  kind: string;
  expected: string;
  got: string;
  facts: string[];
  gotFacts: string[];
  line: string;
  judge?: unknown;
}

export interface ParsedReport {
  file: string;
  modified?: string;
  size?: number;
  error?: string;
  label: string;
  dryRun: boolean;
  meta: Record<string, Scalar>;
  runs: BenchRun[];
  byKind?: Record<string, Record<string, number>>;
  byCase?: Record<string, Record<string, number>>;
  confusion?: Record<string, Record<string, number>>;
  failures?: BenchFailure[];
  warnings: string[];
  spend?: unknown;
  options?: Record<string, unknown>;
  models?: Record<string, unknown>;
  /** Path of the sibling HTML report, relative to the site root (URL-encoded file name). */
  html?: string;
  raw: unknown;
}

const CONTAINERS = ['modes', 'runs', 'results', 'byMode', 'perMode'];
/** Keys never treated as metric groups (per-row data). Numbers under these names are kept. */
const SKIP_KEYS = new Set(['items', 'rows', 'questions', 'details', 'samples', 'failures', 'mismatches', 'errors', 'cases', 'byCase', 'byKind', 'perCase', 'probes', 'traces', 'confusion', 'options', 'models', 'spend']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function flattenMetrics(o: unknown, prefix = '', depth = 0, out: Record<string, number> = {}): Record<string, number> {
  if (!isObj(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (isObj(v) && depth < 1 && !SKIP_KEYS.has(k)) flattenMetrics(v, key, depth + 1, out);
  }
  return out;
}

/** Drops rates whose sample size is 0 (the bench writes 0, which would read as "0%"). */
function normalizeMetrics(m: Record<string, number>): Record<string, number> {
  if (m.factMatchN === 0) delete m.factMatch;
  if (m.safetyN === 0) {
    delete m.safetyPass;
    delete m.safetyCannot;
  }
  return m;
}

function scalars(o: Record<string, unknown>, exclude: Set<string> = new Set()): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(o)) {
    if (exclude.has(k)) continue;
    if (typeof v === 'string' && v.length <= 240) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function metricGroups(v: unknown): Record<string, Record<string, number>> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [k, x] of Object.entries(v)) if (isObj(x)) out[k] = normalizeMetrics(flattenMetrics(x));
  return Object.keys(out).length ? out : undefined;
}

function confusionOf(v: unknown): Record<string, Record<string, number>> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [row, cols] of Object.entries(v)) {
    if (!isObj(cols)) continue;
    out[row] = {};
    for (const [col, n] of Object.entries(cols)) if (typeof n === 'number') out[row][col] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseReport(info: BenchReportInfo): ParsedReport {
  const base: ParsedReport = {
    file: info.file,
    modified: info.modified,
    size: info.size,
    error: info.error,
    label: info.file.replace(/\.json$/i, ''),
    dryRun: false,
    meta: {},
    runs: [],
    warnings: [],
    raw: info.report,
  };
  const r = info.report;
  if (!isObj(r)) {
    if (!info.error && r === null) base.error = 'レポートが大きすぎるため本文を読み込んでいません（2 MB 超）';
    return withHtml(base, undefined);
  }
  base.dryRun = r.dryRun === true;
  if (typeof r.label === 'string' && r.label) base.label = r.label;
  const used = new Set<string>();
  const push = (mode: string, label: string, src: unknown) =>
    base.runs.push({ key: `${info.file}::${label}`, file: info.file, mode, label, dryRun: base.dryRun, metrics: normalizeMetrics(flattenMetrics(src)) });

  for (const name of CONTAINERS) {
    const c = r[name];
    if (Array.isArray(c) && c.length && c.every(isObj)) {
      c.forEach((el, i) => {
        const e = el as Record<string, unknown>;
        const mode = String(e.mode ?? e.name ?? e.id ?? e.label ?? `run${i + 1}`);
        push(mode, String(e.label ?? mode), isObj(e.metrics) ? e.metrics : isObj(e.summary) ? e.summary : e);
      });
      used.add(name);
      break;
    }
    if (isObj(c)) {
      const entries = Object.entries(c).filter(([, v]) => isObj(v));
      if (entries.length) {
        for (const [mode, v] of entries) {
          const e = v as Record<string, unknown>;
          push(mode, mode, isObj(e.metrics) ? e.metrics : isObj(e.summary) ? e.summary : e);
        }
        used.add(name);
        break;
      }
    }
  }
  if (base.runs.length === 0) {
    const mode = String(r.effectiveMode ?? r.mode ?? 'run');
    const src = isObj(r.metrics) ? r.metrics : isObj(r.summary) ? r.summary : null;
    if (src) push(mode, typeof r.label === 'string' && r.label ? r.label : mode, src);
  }
  // unique keys when a label appears twice
  const seen = new Map<string, number>();
  for (const run of base.runs) {
    const n = (seen.get(run.key) ?? 0) + 1;
    seen.set(run.key, n);
    if (n > 1) run.key = `${run.key}#${n}`;
  }
  base.meta = scalars(r, used);
  base.byKind = metricGroups(r.byKind);
  base.byCase = metricGroups(r.byCase);
  base.confusion = confusionOf(r.confusion);
  if (Array.isArray(r.failures)) base.failures = r.failures.filter(isObj) as unknown as BenchFailure[];
  if (Array.isArray(r.warnings)) base.warnings = r.warnings.map(String);
  if (r.spend !== undefined) base.spend = r.spend;
  if (isObj(r.options)) base.options = r.options;
  if (isObj(r.models)) base.models = r.models;
  const htmlField = ['html', 'htmlFile', 'htmlPath', 'reportHtml'].map((k) => r[k]).find((v): v is string => typeof v === 'string' && v.length > 0);
  return withHtml(base, htmlField);
}

function withHtml(p: ParsedReport, field: string | undefined): ParsedReport {
  const name = (field ?? p.file.replace(/\.json$/i, '.html')).replace(/\\/g, '/').split('/').pop() ?? '';
  if (/^[^/?#]+\.html?$/i.test(name) && !name.startsWith('.')) p.html = `bench/reports/${encodeURIComponent(name)}`;
  return p;
}

/* ------------------------------------------------------------------ */
/* Metric semantics (by name)                                          */
/* ------------------------------------------------------------------ */

const LOWER_RE = /(leak|error|fail|fallback|retry|redo|timeout|degrad|cost|usd|jpy|latency|(^|\.|_)ms$|ms\b|p50|p90|p95|p99|median|mean|avg|max|time|tokens|mismatch|wrong|miss|level4|hallucin|falsesupport)/;
const HIGHER_RE = /(accuracy|acc$|correct|match|precision|recall|f1|consisten|score|pass|agree|hit)/;
/** Counts / sample sizes: no better or worse. */
const COUNT_RE = /(^|\.)(probes|runs|n|count|calls)$|N$|[Ll]ines$/;

/** Whether a larger value is better for this metric (heuristic by name). */
export function metricDirection(key: string): 'higher' | 'lower' | 'neutral' {
  if (COUNT_RE.test(key)) return 'neutral';
  const k = key.toLowerCase();
  if (LOWER_RE.test(k)) return 'lower';
  if (HIGHER_RE.test(k)) return 'higher';
  return 'neutral';
}

const RATIO_RE = /(rate|accuracy|acc$|precision|recall|f1|consisten|match|ratio|pct|share|leak|pass|agree|correct|hit)/;
const COST_USD_RE = /(usd|cost)/;
const COST_JPY_RE = /jpy/;
const TIME_RE = /(latency|ms$|ms\b|p50|p90|p95|p99|median|mean|avg|time)/;
const NOT_TIME_RE = /(rate|accuracy|ratio)/;

/** A 0..1 ratio shown as a percentage (by name, and every known value within 0..1). */
export function isRatioMetric(key: string, values: (number | undefined)[] = []): boolean {
  if (COUNT_RE.test(key)) return false;
  const k = key.toLowerCase();
  if (COST_USD_RE.test(k) || COST_JPY_RE.test(k) || (TIME_RE.test(k) && !NOT_TIME_RE.test(k))) return false;
  return RATIO_RE.test(k) && values.every((v) => v === undefined || (v >= 0 && v <= 1));
}

export function fmtMetric(key: string, v: number | undefined): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  const k = key.toLowerCase();
  if (COST_JPY_RE.test(k)) return `${fmtNum(v, 5)}円`;
  if (COST_USD_RE.test(k)) return fmtUsd(v, 8);
  if (TIME_RE.test(k) && !NOT_TIME_RE.test(k) && !COUNT_RE.test(key)) return fmtMs(v);
  if (isRatioMetric(key, [v])) return fmtPct(v);
  return fmtNum(v);
}

/** Signed difference; ratios in percentage points. */
export function fmtDelta(key: string, d: number, values: (number | undefined)[]): string {
  if (!Number.isFinite(d)) return '—';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  if (isRatioMetric(key, values)) return `${sign}${Math.abs(d * 100).toFixed(1)}pt`;
  return `${sign}${fmtMetric(key, Math.abs(d))}`;
}

/** Human label for well-known metric keys (scripts/bench/metrics.ts). */
export const METRIC_JP: Record<string, string> = {
  probes: '想定質問',
  runs: '実行数',
  answerAccuracy: '正答率',
  accuracy: '正答率',
  factMatch: '所見一致率',
  factMatchN: '所見一致の母数',
  qtypeAccuracy: '質問の型の分類精度',
  classAccuracy: '分類精度',
  leakRate: '漏洩率',
  level4CardRate: '核心カード化率',
  llmLines: 'LLM の言い換え数',
  hallucinationRate: '作り話率',
  safetyN: '安全系の母数',
  safetyPass: '安全対応の正答率',
  safetyCannot: '安全系を「答えられない」',
  falseSupport: '誤った相談窓口表示',
  consistency: '一貫性',
  'latency.mean': '平均時間',
  'latency.p50': '中央値',
  'latency.p95': 'P95',
  'latency.p99': 'P99',
  'latency.max': '最大',
  costPerQuestionUsd: '1問あたり費用',
  costPerQuestionJpy: '1問あたり費用（円）',
  totalCostUsd: '費用合計',
  fastPathRate: 'FAST PATH 率',
  retryRate: 'やり直し率',
  degradedRate: '退避率',
  renderFallbackRate: '言い換え却下率',
};

/** Union of metric keys over runs, in first-seen order. */
export function metricKeys(runs: { metrics: Record<string, number> }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of runs)
    for (const k of Object.keys(r.metrics))
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
  return out;
}

/** Indices of the best run(s) for a metric (ties all count; empty when neutral or all equal). */
export function bestIndices(key: string, runs: { metrics: Record<string, number> }[]): Set<number> {
  const dir = metricDirection(key);
  const out = new Set<number>();
  if (dir === 'neutral' || runs.length < 2) return out;
  const vals = runs.map((r) => r.metrics[key]);
  const known = vals.filter((v): v is number => v !== undefined);
  if (known.length < 2 || known.every((v) => v === known[0])) return out;
  const best = dir === 'higher' ? Math.max(...known) : Math.min(...known);
  vals.forEach((v, i) => v === best && out.add(i));
  return out;
}

/** First metric key present among candidates (e.g. answerAccuracy | accuracy). */
export function pick(metrics: Record<string, number>, ...keys: string[]): { key: string; value: number } | undefined {
  for (const k of keys) if (metrics[k] !== undefined) return { key: k, value: metrics[k] };
  return undefined;
}
