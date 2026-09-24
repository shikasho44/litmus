/**
 * Bench report: compact JSON (bench/reports/<ISO>-<label>.json) + self-contained HTML, and a
 * comparison page across several reports. Reports stay small: per-probe results are stored
 * in a compact form, failures and LLM samples are capped.
 */
import { ANSWER_CLASSES, type AnswerClass } from '../../shared/case-schema.js';
import { computeMetrics, confusionMatrix, groupMetrics, JPY_PER_USD, type Confusion, type Metrics, type ProbeRecord } from './metrics.js';
import type { Meter } from './runner.js';

export const REPORT_VERSION = 1;
const MAX_FAILURES = 120;
const MAX_SAMPLES = 40;

export interface CompactProbe {
  /** case id, probe index, kind, expected, answers per run, fact hit (null = n/a), latency ms, cost USD */
  c: string;
  i: number;
  k: string;
  e: AnswerClass;
  a: AnswerClass[];
  f: boolean | null;
  ms: number;
  usd: number;
  s?: 1;
}

export interface BenchReport {
  version: number;
  createdAt: string;
  label: string;
  mode: string;
  effectiveMode: string;
  strategy?: string;
  dryRun: boolean;
  options: Record<string, unknown>;
  models: { jev?: string; llm?: string };
  metrics: Metrics;
  byKind: Record<string, Metrics>;
  byCase: Record<string, Metrics>;
  confusion: Confusion;
  spend: { jev?: Meter; llm?: Meter; totalUsd: number; totalJpy: number };
  warnings: string[];
  probes: CompactProbe[];
  failures: { c: string; q: string; kind: string; expected: string; got: string; facts: string[]; gotFacts: string[]; line: string; judge?: unknown }[];
  samples: { c: string; q: string; answer: string; line: string; llm: boolean; rejects?: string[]; foreign?: string[] }[];
}

/** Keeps a failure's judge detail small: answer distribution, flags, rules answer, best probe. */
function compactJudge(j: unknown): unknown {
  const o = j as { model?: { raw?: { answer?: unknown; flags?: unknown } }; rules?: string; note?: string; probe?: { score?: number; label?: string } } | undefined;
  if (!o) return undefined;
  return { model: o.model?.raw ? { answer: o.model.raw.answer, flags: o.model.raw.flags } : undefined, rules: o.rules, note: o.note, probe: o.probe ? [o.probe.score, o.probe.label] : undefined };
}

export interface BuildReportInput {
  label: string;
  mode: string;
  effectiveMode: string;
  strategy?: string;
  dryRun: boolean;
  options: Record<string, unknown>;
  models: { jev?: string; llm?: string };
  records: ProbeRecord[];
  jev?: Meter;
  llm?: Meter;
  warnings: string[];
}

export function buildReport(x: BuildReportInput): BenchReport {
  const metrics = computeMetrics(x.records);
  const spendUsd = (x.jev?.costUsd ?? 0) + (x.llm?.costUsd ?? 0);
  const failures: BenchReport['failures'] = [];
  const samples: BenchReport['samples'] = [];
  for (const p of x.records) {
    for (const r of p.runs) {
      if (r.answer !== p.expected && failures.length < MAX_FAILURES) {
        failures.push({ c: p.caseId, q: p.q, kind: p.kind, expected: p.expected, got: r.answer, facts: p.expectedFacts, gotFacts: r.factIds, line: r.line.slice(0, 120), judge: compactJudge(r.judge) });
      }
      if ((r.llmLine || r.renderRejects) && samples.length < MAX_SAMPLES) {
        samples.push({ c: p.caseId, q: p.q, answer: r.answer, line: r.line.slice(0, 160), llm: r.llmLine, rejects: r.renderRejects, foreign: r.foreign.length ? r.foreign : undefined });
      }
    }
  }
  return {
    version: REPORT_VERSION,
    createdAt: new Date().toISOString(),
    label: x.label,
    mode: x.mode,
    effectiveMode: x.effectiveMode,
    strategy: x.strategy,
    dryRun: x.dryRun,
    options: x.options,
    models: x.models,
    metrics,
    byKind: groupMetrics(x.records, (p) => p.kind),
    byCase: groupMetrics(x.records, (p) => p.caseId),
    confusion: confusionMatrix(x.records),
    spend: { jev: x.jev, llm: x.llm, totalUsd: Math.round(spendUsd * 1e7) / 1e7, totalJpy: Math.round(spendUsd * JPY_PER_USD * 1e4) / 1e4 },
    warnings: x.warnings,
    probes: x.records.map((p) => {
      const ok = p.expectedFacts.length > 0 && ['yes', 'no', 'partial'].includes(p.expected);
      const cp: CompactProbe = {
        c: p.caseId,
        i: p.index,
        k: p.kind,
        e: p.expected,
        a: p.runs.map((r) => r.answer),
        f: ok ? p.runs.some((r) => r.factIds.some((id) => p.expectedFacts.includes(id))) : null,
        ms: Math.round(p.runs.reduce((a, r) => a + r.latencyMs, 0) / Math.max(1, p.runs.length)),
        usd: Math.round(p.runs.reduce((a, r) => a + r.costUsd, 0) * 1e8) / 1e8,
      };
      if (p.safety) cp.s = 1;
      return cp;
    }),
    failures,
    samples,
  };
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`);
const usd = (n: number) => (n === 0 ? '$0' : n < 0.001 ? `$${n.toFixed(7)}` : `$${n.toFixed(5)}`);
const jpy = (n: number) => `${(n * JPY_PER_USD).toFixed(4)}円`;

const CSS = `
:root{--bg:#f6f5f1;--fg:#16181d;--mute:#667085;--line:#d9d6cc;--card:#fff;--ok:#2f7d32;--bad:#b3261e;--accent:#5b7c00}
@media (prefers-color-scheme: dark){:root{--bg:#0b0d12;--fg:#f2efe6;--mute:#8a93a6;--line:#262c38;--card:#141821;--ok:#9be36b;--bad:#ff6b8b;--accent:#c6ff3d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Yu Gothic UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
.sub{color:var(--mute);font-size:12px;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}.tile b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.tile span{color:var(--mute);font-size:12px}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;background:var(--card);font-variant-numeric:tabular-nums}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top;font-size:12.5px}th{background:color-mix(in srgb,var(--line) 40%,transparent);white-space:nowrap}
td.n{text-align:right;white-space:nowrap}.ok{color:var(--ok)}.bad{color:var(--bad)}.hl{background:color-mix(in srgb,var(--accent) 22%,transparent);font-weight:600}
code{font-family:ui-monospace,Consolas,monospace;font-size:12px}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

function tile(label: string, value: string): string {
  return `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function metricsRow(name: string, m: Metrics): string {
  return `<tr><td>${esc(name)}</td><td class="n">${m.runs}</td><td class="n">${pct(m.answerAccuracy)}</td><td class="n">${pct(m.factMatch)}</td><td class="n">${pct(m.qtypeAccuracy)}</td><td class="n">${Math.round(m.latency.p50)}</td><td class="n">${Math.round(m.latency.p95)}</td><td class="n">${usd(m.costPerQuestionUsd)}</td></tr>`;
}

const METRIC_HEAD = '<tr><th>グループ</th><th>件数</th><th>答え正答率</th><th>所見一致</th><th>質問の型</th><th>p50 ms</th><th>p95 ms</th><th>1問の費用</th></tr>';

function confusionTable(c: Confusion): string {
  const head = `<tr><th>正解＼判定</th>${ANSWER_CLASSES.map((a) => `<th>${a}</th>`).join('')}</tr>`;
  const rows = ANSWER_CLASSES.map((e) => `<tr><th>${e}</th>${ANSWER_CLASSES.map((a) => `<td class="n${a === e && c[e][a] > 0 ? ' hl' : ''}">${c[e][a] || ''}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll"><table>${head}${rows}</table></div>`;
}

export function reportHtml(r: BenchReport): string {
  const m = r.metrics;
  const tiles = [
    tile('答え正答率', pct(m.answerAccuracy)),
    tile(`所見一致（n=${m.factMatchN}）`, pct(m.factMatch)),
    tile('質問の型', pct(m.qtypeAccuracy)),
    tile('漏洩（回答文）', pct(m.leakRate)),
    tile('核心カード化', pct(m.level4CardRate)),
    tile(`LLM行の幻覚指標（n=${m.llmLines}）`, pct(m.hallucinationRate)),
    tile(`安全（n=${m.safetyN}）cannot+support`, pct(m.safetyPass)),
    tile('安全: cannot のみ', pct(m.safetyCannot)),
    tile('誤って support', pct(m.falseSupport)),
    tile('一貫性（repeat）', pct(m.consistency)),
    tile('p50 / p95 ms', `${Math.round(m.latency.p50)} / ${Math.round(m.latency.p95)}`),
    tile('p99 / 平均 ms', `${Math.round(m.latency.p99)} / ${Math.round(m.latency.mean)}`),
    tile('1問の費用', `${usd(m.costPerQuestionUsd)}（${jpy(m.costPerQuestionUsd)}）`),
    tile('FAST PATH', pct(m.fastPathRate)),
    tile('再試行あり', pct(m.retryRate)),
    tile('rules へ退避', pct(m.degradedRate)),
    tile('言い換え→定型文', pct(m.renderFallbackRate)),
    tile('実費合計', `${usd(r.spend.totalUsd)}`),
  ].join('');
  const byKind = Object.entries(r.byKind).sort((a, b) => b[1].runs - a[1].runs).map(([k, v]) => metricsRow(k, v)).join('');
  const byCase = Object.entries(r.byCase).map(([k, v]) => metricsRow(k, v)).join('');
  const fails = r.failures.map((f) => `<tr><td>${esc(f.c.slice(0, 3))}</td><td>${esc(f.kind)}</td><td>${esc(f.q)}</td><td>${esc(f.expected)}</td><td class="bad">${esc(f.got)}</td><td><code>${esc(f.facts.join(','))}</code> → <code>${esc(f.gotFacts.join(','))}</code></td><td>${esc(f.line)}</td></tr>`).join('');
  const samples = r.samples.map((s) => `<tr><td>${esc(s.c.slice(0, 3))}</td><td>${esc(s.q)}</td><td>${esc(s.answer)}</td><td>${esc(s.line)}</td><td>${s.llm ? '<span class="ok">LLM</span>' : '定型文'}</td><td>${esc((s.rejects ?? []).join(' '))}${s.foreign ? ` <span class="bad">外部語:${esc(s.foreign.join(','))}</span>` : ''}</td></tr>`).join('');
  const spend = [r.spend.jev ? `Jev ${r.spend.jev.calls}回 ${usd(r.spend.jev.costUsd)}（誤り ${r.spend.jev.errors}）` : '', r.spend.llm ? `LLM ${r.spend.llm.calls}回 ${usd(r.spend.llm.costUsd)}（誤り ${r.spend.llm.errors}）` : ''].filter(Boolean).join(' / ') || '外部呼び出しなし';
  const body = `
<h1>ベンチ: ${esc(r.label)}</h1>
<div class="sub">${esc(r.createdAt)} · mode ${esc(r.mode)}（実効 ${esc(r.effectiveMode)}）${r.strategy ? ` · 候補 ${esc(r.strategy)}` : ''}${r.dryRun ? ' · <b>DRY RUN</b>' : ''} · ${esc(r.models.jev ?? '')} ${esc(r.models.llm ?? '')}</div>
<div class="sub">条件: ${esc(JSON.stringify(r.options))}</div>
<div class="sub">実費: ${esc(spend)}</div>
<div class="grid">${tiles}</div>
<h2>事件別</h2><div class="scroll"><table>${METRIC_HEAD}${byCase}</table></div>
<h2>想定質問の種類別</h2><div class="scroll"><table>${METRIC_HEAD}${byKind}</table></div>
<h2>混同行列（行=正解ラベル、列=判定）</h2>${confusionTable(r.confusion)}
${r.samples.length ? `<h2>言い換えの例（最大 ${MAX_SAMPLES}）</h2><div class="scroll"><table><tr><th>事件</th><th>質問</th><th>判定</th><th>返答</th><th>種別</th><th>却下理由</th></tr>${samples}</table></div>` : ''}
<h2>外れ（最大 ${MAX_FAILURES}）</h2><div class="scroll"><table><tr><th>事件</th><th>種類</th><th>質問</th><th>正解</th><th>判定</th><th>所見 正解→判定</th><th>返答</th></tr>${fails}</table></div>
${r.warnings.length ? `<h2>警告</h2><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
  return page(`bench ${r.label}`, body);
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export interface SubsetStats { n: number; accuracy: number; factMatch: number; p50: number; p95: number; costUsd: number }

/** Metrics recomputed from compact probes on a key subset (for apples-to-apples rows). */
export function subsetStats(r: BenchReport, keys: ReadonlySet<string>): SubsetStats {
  const ps = r.probes.filter((p) => keys.has(`${p.c}#${p.i}`));
  const runs = ps.flatMap((p) => p.a.map((a) => ({ p, a })));
  const fm = ps.filter((p) => p.f !== null);
  const lat = ps.map((p) => p.ms).sort((a, b) => a - b);
  const q = (x: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.round((x / 100) * (lat.length - 1)))] : 0);
  return {
    n: ps.length,
    accuracy: runs.length ? runs.filter(({ p, a }) => a === p.e).length / runs.length : 0,
    factMatch: fm.length ? fm.filter((p) => p.f).length / fm.length : 0,
    p50: q(50),
    p95: q(95),
    costUsd: ps.length ? ps.reduce((a, p) => a + p.usd, 0) / Math.max(1, runs.length) : 0,
  };
}

export function comparisonHtml(reports: BenchReport[]): string {
  const full = reports.map((r) => {
    const m = r.metrics;
    return `<tr><td>${esc(r.label)}</td><td class="n">${m.runs}</td><td class="n">${pct(m.answerAccuracy)}</td><td class="n">${pct(m.factMatch)}</td><td class="n">${pct(m.qtypeAccuracy)}</td><td class="n">${pct(m.leakRate)}</td><td class="n">${m.llmLines ? pct(m.hallucinationRate) : '—'}</td><td class="n">${m.safetyN ? pct(m.safetyPass) : '—'}</td><td class="n">${pct(m.consistency)}</td><td class="n">${Math.round(m.latency.p50)}</td><td class="n">${Math.round(m.latency.p95)}</td><td class="n">${Math.round(m.latency.p99)}</td><td class="n">${usd(m.costPerQuestionUsd)}</td><td class="n">${jpy(m.costPerQuestionUsd)}</td><td class="n">${pct(m.fastPathRate)}</td><td class="n">${pct(m.degradedRate)}</td></tr>`;
  }).join('');
  // Shared subset: probes present in every report.
  const sets = reports.map((r) => new Set(r.probes.map((p) => `${p.c}#${p.i}`)));
  const shared = new Set([...(sets[0] ?? [])].filter((k) => sets.every((s) => s.has(k))));
  const sub = reports.map((r) => {
    const s = subsetStats(r, shared);
    return `<tr><td>${esc(r.label)}</td><td class="n">${s.n}</td><td class="n">${pct(s.accuracy)}</td><td class="n">${pct(s.factMatch)}</td><td class="n">${Math.round(s.p50)}</td><td class="n">${Math.round(s.p95)}</td><td class="n">${usd(s.costUsd)}</td><td class="n">${jpy(s.costUsd)}</td></tr>`;
  }).join('');
  const kinds = [...new Set(reports.flatMap((r) => Object.keys(r.byKind)))].sort();
  const kindHead = `<tr><th>種類</th>${reports.map((r) => `<th>${esc(r.label)}</th>`).join('')}</tr>`;
  const kindRows = kinds.map((k) => `<tr><td>${esc(k)}</td>${reports.map((r) => `<td class="n">${r.byKind[k] ? `${pct(r.byKind[k].answerAccuracy)} <span class="sub">n=${r.byKind[k].runs}</span>` : '—'}</td>`).join('')}</tr>`).join('');
  const body = `
<h1>ベンチ比較</h1>
<div class="sub">${esc(new Date().toISOString())} · ${reports.length} 件のレポート</div>
<h2>全体（各レポートの対象すべて）</h2>
<div class="scroll"><table><tr><th>mode</th><th>件数</th><th>正答率</th><th>所見一致</th><th>型</th><th>漏洩</th><th>幻覚指標</th><th>安全</th><th>一貫性</th><th>p50</th><th>p95</th><th>p99</th><th>USD/問</th><th>円/問</th><th>FAST PATH</th><th>退避</th></tr>${full}</table></div>
<h2>共通の想定質問だけで比べる（${shared.size} 問）</h2>
<div class="scroll"><table><tr><th>mode</th><th>件数</th><th>正答率</th><th>所見一致</th><th>p50 ms</th><th>p95 ms</th><th>USD/問</th><th>円/問</th></tr>${sub}</table></div>
<h2>種類別の正答率</h2><div class="scroll"><table>${kindHead}${kindRows}</table></div>`;
  return page('bench comparison', body);
}
