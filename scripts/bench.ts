/**
 * npm run bench — runs the authored probes (人が付けた正解ラベル) through the real pipeline in
 * one or more modes and writes bench/reports/<ISO>-<label>.json + .html (+ a comparison page
 * when several modes run). Methodology and results: docs/ai.md.
 *
 *   npm run bench -- --case all --mode rules                  offline, free
 *   npm run bench -- --case c01 --mode jev --limit 40         40 stratified probes of case 1
 *   npm run bench -- --mode jev --strategy all+prior          JevJudge candidate strategy
 *   npm run bench -- --mode jev+llm,llm --limit 5             LLM modes (5 probes per case)
 *   npm run bench -- --mode all --limit 5 --dry-run           no network: counts + size estimate
 *   npm run bench -- --compare                                comparison of the latest report per label
 *
 * Flags
 *   --case <id|prefix|all>      default all
 *   --mode <m[,m…]|all>         rules | jev | jev+llm | jev+llm+check | llm   (default rules)
 *   --limit N                   probes per case (stratified over kinds; same set in every mode)
 *   --repeat N                  run each probe N times (consistency)             default 1
 *   --concurrency N             parallel probes (default 4, LLM modes 2)
 *   --kinds k1,k2               only these probe kinds
 *   --strategy s                topk | all | all+prior (Jev modes; default JEV_CANDIDATES or topk)
 *   --no-loo                    keep the probe under test in the bank (authored behaviour)
 *   --dry-run                   no API calls (stand-in providers); prints the call plan
 *   --max-jev-usd X             hard cap per mode run (default 0.06)
 *   --max-llm-calls N           hard cap per mode run (default 24)
 *   --max-llm-usd X             hard cap per mode run (default 0.05)
 *   --llm-provider p            openrouter | codex (default LLM_PROVIDER or openrouter)
 *   --llm-model m               override LLM_MODEL
 *   --tag t                     suffix for the report label
 *   --compare [files…]          build a comparison page from existing reports and exit
 *   --out dir                   default bench/reports
 *   --dump file                 also write every per-run record (large; for offline analysis)
 *
 * Keys come from the environment (OPENROUTER_API_KEY) and are never printed.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PipelineMode } from '../shared/api.js';
import { PROBE_KINDS } from '../shared/case-schema.js';
import { PIPELINE_MODES, type EnvLike } from '../server/engine/env.js';
import { loadRegistry, resolveContentRoot } from '../server/node/content-fs.js';
import { CANDIDATE_STRATEGIES, DEFAULT_STRATEGY, type CandidateStrategy } from '../server/engine/ai/jev-judge.js';
import { stratifiedPick } from './bench/metrics.js';
import { buildComponents, runAll, type ProbeTask } from './bench/runner.js';
import { buildReport, comparisonHtml, reportHtml, type BenchReport } from './bench/report.js';

interface Args {
  cases: string;
  modes: PipelineMode[];
  limit: number;
  repeat: number;
  concurrency?: number;
  kinds?: string[];
  strategy?: CandidateStrategy;
  loo: boolean;
  dryRun: boolean;
  maxJevUsd: number;
  maxLlmCalls: number;
  maxLlmUsd: number;
  llmProvider?: string;
  llmModel?: string;
  tag?: string;
  compare?: string[];
  dump?: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cases: 'all', modes: ['rules'], limit: 0, repeat: 1, loo: true, dryRun: false, maxJevUsd: 0.06, maxLlmCalls: 24, maxLlmUsd: 0.05, out: 'bench/reports' };
  const val = (i: number) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    switch (f) {
      case '--case': case '--cases': a.cases = val(i++); break;
      case '--mode': case '--modes': {
        const v = val(i++);
        const list = v === 'all' ? [...PIPELINE_MODES] : v.split(',').map((s) => s.trim());
        for (const m of list) if (!(PIPELINE_MODES as readonly string[]).includes(m)) throw new Error(`unknown mode ${m}`);
        a.modes = list as PipelineMode[];
        break;
      }
      case '--limit': a.limit = Math.max(0, Number(val(i++)) || 0); break;
      case '--repeat': a.repeat = Math.max(1, Number(val(i++)) || 1); break;
      case '--concurrency': a.concurrency = Math.max(1, Number(val(i++)) || 1); break;
      case '--kinds': a.kinds = val(i++).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--strategy': {
        const s = val(i++) as CandidateStrategy;
        if (!CANDIDATE_STRATEGIES.includes(s)) throw new Error(`unknown strategy ${s}`);
        a.strategy = s;
        break;
      }
      case '--no-loo': a.loo = false; break;
      case '--dry-run': a.dryRun = true; break;
      case '--max-jev-usd': a.maxJevUsd = Number(val(i++)); break;
      case '--max-llm-calls': a.maxLlmCalls = Number(val(i++)); break;
      case '--max-llm-usd': a.maxLlmUsd = Number(val(i++)); break;
      case '--llm-provider': a.llmProvider = val(i++); break;
      case '--llm-model': a.llmModel = val(i++); break;
      case '--tag': a.tag = val(i++); break;
      case '--out': a.out = val(i++); break;
      case '--dump': a.dump = val(i++); break;
      case '--compare': {
        a.compare = [];
        while (argv[i + 1] && !argv[i + 1].startsWith('--')) a.compare.push(argv[++i]);
        break;
      }
      case '--help': case '-h':
        console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag ${f}`);
    }
  }
  if (a.kinds) for (const k of a.kinds) if (!(PROBE_KINDS as readonly string[]).includes(k)) throw new Error(`unknown kind ${k}`);
  return a;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
const safe = (s: string) => s.replace(/[^\w+.\-[\]]/g, '_');

function latestReports(dir: string): BenchReport[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const byLabel = new Map<string, BenchReport>();
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as BenchReport;
      if (r?.version && r.label && !r.dryRun) byLabel.set(r.label, r); // later files win
    } catch {
      /* skip */
    }
  }
  return [...byLabel.values()];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });

  if (args.compare) {
    const reports = args.compare.length > 0 ? args.compare.map((f) => JSON.parse(readFileSync(f, 'utf8')) as BenchReport) : latestReports(outDir);
    if (reports.length === 0) throw new Error('no reports to compare');
    const file = join(outDir, `${stamp()}-compare.html`);
    writeFileSync(file, comparisonHtml(reports));
    console.log(`comparison of ${reports.length} reports → ${file}`);
    return;
  }

  const env: EnvLike = { ...(process.env as EnvLike) };
  if (args.llmProvider) env.LLM_PROVIDER = args.llmProvider;
  if (args.llmModel) env.LLM_MODEL = args.llmModel;
  if (!env.LLM_PROVIDER || env.LLM_PROVIDER === 'none') env.LLM_PROVIDER = 'openrouter';

  const registry = loadRegistry(resolveContentRoot(env));
  const cases = registry.cases.filter((c) => args.cases === 'all' || c.data.id === args.cases || c.data.id.startsWith(args.cases));
  if (cases.length === 0) throw new Error(`no case matches "${args.cases}"`);

  const tasks: ProbeTask[] = [];
  for (const loaded of cases) {
    const all = loaded.data.probes.map((probe, index) => ({ probe, index, kind: probe.kind })).filter((x) => !args.kinds || args.kinds.includes(x.kind));
    for (const x of stratifiedPick(all, args.limit)) tasks.push({ loaded, probe: x.probe, index: x.index });
  }

  const written: BenchReport[] = [];
  for (const mode of args.modes) {
    const strategy = mode === 'llm' || mode === 'rules' ? undefined : args.strategy ?? (env.JEV_CANDIDATES as CandidateStrategy | undefined) ?? DEFAULT_STRATEGY;
    const label = `${mode}${strategy ? `[${strategy}]` : ''}${args.loo ? '' : '[authored]'}${args.tag ? `-${args.tag}` : ''}`;
    const built = buildComponents({ mode, env, strategy, dryRun: args.dryRun, maxJevUsd: args.maxJevUsd, maxLlmCalls: args.maxLlmCalls, maxLlmUsd: args.maxLlmUsd });
    const concurrency = args.concurrency ?? (mode === 'rules' || mode === 'jev' ? 4 : 2);
    console.log(`\n▶ ${label}: ${tasks.length} probes × ${args.repeat} (${cases.map((c) => c.data.id.slice(0, 3)).join(',')})${args.dryRun ? ' DRY RUN' : ''} — effective mode ${built.components.mode}`);
    for (const w of built.components.warnings) console.log(`  ! ${w}`);
    const t0 = Date.now();
    let lastPrint = 0;
    const records = await runAll({
      tasks,
      components: built.components,
      lines: registry.lines,
      loo: args.loo,
      repeat: args.repeat,
      concurrency,
      onProgress: (done, total) => {
        if (done === total || Date.now() - lastPrint > 5000) {
          lastPrint = Date.now();
          const spend = (built.jev?.meter.costUsd ?? 0) + (built.llm?.meter.costUsd ?? 0);
          process.stdout.write(`  ${done}/${total}  spend $${spend.toFixed(5)}\n`);
        }
      },
    });
    const report = buildReport({
      label,
      mode,
      effectiveMode: built.components.mode,
      strategy,
      dryRun: args.dryRun,
      options: { cases: cases.map((c) => c.data.id), limit: args.limit || 'all', repeat: args.repeat, concurrency, kinds: args.kinds ?? 'all', loo: args.loo, seconds: Math.round((Date.now() - t0) / 1000) },
      models: { jev: built.jev ? `${built.jev.name}` : undefined, llm: built.llm ? `${built.llm.name}` : undefined },
      records,
      jev: built.jev?.meter,
      llm: built.llm?.meter,
      warnings: built.components.warnings,
    });
    const base = join(outDir, `${stamp()}-${safe(label)}${args.dryRun ? '-dry' : ''}`);
    writeFileSync(`${base}.json`, JSON.stringify(report));
    writeFileSync(`${base}.html`, reportHtml(report));
    if (args.dump) writeFileSync(args.dump.replace(/(\.json)?$/, `-${safe(label)}.json`), JSON.stringify(records));
    written.push(report);
    const m = report.metrics;
    console.log(
      `  accuracy ${(m.answerAccuracy * 100).toFixed(1)}%  facts ${(m.factMatch * 100).toFixed(1)}%  qtype ${(m.qtypeAccuracy * 100).toFixed(1)}%  leak ${(m.leakRate * 100).toFixed(1)}%  ` +
        `p50 ${Math.round(m.latency.p50)}ms p95 ${Math.round(m.latency.p95)}ms  $/q ${m.costPerQuestionUsd}  fast ${(m.fastPathRate * 100).toFixed(0)}%  degraded ${(m.degradedRate * 100).toFixed(1)}%` +
        (m.safetyN ? `  safety ${(m.safetyPass * 100).toFixed(0)}% (cannot ${(m.safetyCannot * 100).toFixed(0)}%)` : '') +
        (m.consistency !== null ? `  consistency ${(m.consistency * 100).toFixed(1)}%` : ''),
    );
    if (built.jev) console.log(`  Jev: ${built.jev.meter.calls} calls, $${built.jev.meter.costUsd.toFixed(6)}, ${built.jev.meter.inputTokens} in-tokens, ${built.jev.meter.requestChars} request chars, errors ${built.jev.meter.errors} ${JSON.stringify(built.jev.meter.errorKinds)}`);
    if (built.llm) console.log(`  LLM: ${built.llm.meter.calls} calls, $${built.llm.meter.costUsd.toFixed(6)}, errors ${built.llm.meter.errors} ${JSON.stringify(built.llm.meter.errorKinds)}`);
    console.log(`  → ${base}.json / .html`);
  }
  if (written.length > 1) {
    const file = join(outDir, `${stamp()}-compare.html`);
    writeFileSync(file, comparisonHtml(written));
    console.log(`\ncomparison → ${file}`);
  }
  if (args.modes.some((m) => m.includes('llm')) && (env.LLM_PROVIDER ?? '').toLowerCase() === 'codex') {
    const { shutdownCodex } = await import('../server/engine/providers/codex-node.js');
    shutdownCodex();
  }
}

// No process.exit() on success: keep-alive sockets close on their own (an abrupt exit while
// undici handles are closing trips a libuv assertion on Windows).
main().then(
  () => {
    process.exitCode = 0;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
