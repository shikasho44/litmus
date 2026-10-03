/**
 * AI case test — design bible §41「公開前にAI自身にCaseをプレイさせる」.
 *
 * A cheap OpenRouter chat model role-plays a player persona and plays a case through the REAL
 * GameService in jev mode (Jev judge + canned lines, the production default): it sees only what a
 * player sees (intro, its own Q&A log, the cards it holds, hints it asked for, the inquest screen),
 * asks one message per turn (≤ 40), may ask for a hint, decides when to open the inquest, plays
 * the noise-break rounds with the shot / grant API and writes the verdict in its own words.
 *
 *   npx tsx scripts/playtest.ts                                  5 personas × 3 cases
 *   npx tsx scripts/playtest.ts --case c01 --persona sharp       one run
 *   npx tsx scripts/playtest.ts --dry-run                        no network: rules judge + scripted player
 *   npx tsx scripts/playtest.ts --analyze bench/reports/playtest/<dir>   re-analyse saved runs (free)
 *
 * Flags
 *   --case <id|prefix|all>       default all
 *   --persona <id[,id…]|all>     beginner | science | clumsy | sharp | adversarial   (default all)
 *   --max-usd X                  HARD cap for the whole invocation, from usage.cost (default 0.30)
 *   --concurrency N              parallel runs (default 5)
 *   --model m                    player model (default LLM_MODEL or docs/ai.md's choice)
 *   --strategy s                 Jev candidate strategy (default JEV_CANDIDATES or the engine default)
 *   --judge jev|rules            the game's judge (default jev, the production default). rules = the free
 *                                offline judge of the static build: only the player model costs money
 *                                (2026-10-04, the I-001 ツクール samples must also play without AI)
 *   --out dir                    default bench/reports/playtest (under vite's watch-ignore)
 *   --quiet                      no per-turn log lines
 *
 * Output: <out>/<ISO>/runs/<case>-<persona>.json (full transcript + engine trace bits),
 * summary.json (metrics, contradictions, label disagreements, leaks) and summary.md.
 * The key comes from OPENROUTER_API_KEY and is never printed.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EnvLike } from '../server/engine/env.js';
import { loadRegistry, resolveContentRoot } from '../server/node/content-fs.js';
import { createComponents } from '../server/engine/factory.js';
import { GameService } from '../server/engine/game.js';
import { createJevProvider } from '../server/engine/providers/jev.js';
import { createOpenRouterLlm, DEFAULT_LLM_MODEL } from '../server/engine/providers/openrouter-llm.js';
import type { DecisionProvider, LlmProvider, LlmRequest, LlmResult } from '../server/engine/providers/types.js';
import { CANDIDATE_STRATEGIES, type CandidateStrategy } from '../server/engine/ai/jev-judge.js';
import { strategyFrom } from '../server/engine/factory.js';
import type { ContentRegistry } from '../server/engine/registry.js';
import { PERSONAS, AGE_PERSONAS, personaById, type Persona } from './playtest/personas.js';
import { BudgetedDecision, BudgetedLlm, newRunSpend, SharedBudget } from './playtest/budget.js';
import { playCase } from './playtest/session.js';
import { findContradictions, labelDisagreements, runMetrics, type PooledAsk } from './playtest/analysis.js';
import { summaryMarkdown, type PlaytestSummary } from './playtest/report.js';
import type { RunLog } from './playtest/types.js';

interface Args {
  cases: string;
  personas: Persona[];
  maxUsd: number;
  concurrency: number;
  model?: string;
  strategy?: CandidateStrategy;
  out: string;
  dryRun: boolean;
  quiet: boolean;
  judge: 'jev' | 'rules';
  analyze?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cases: 'all', personas: [...PERSONAS], maxUsd: 0.3, concurrency: 5, out: 'bench/reports/playtest', dryRun: false, quiet: false, judge: 'jev' };
  const val = (i: number) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    switch (f) {
      case '--case': case '--cases': a.cases = val(i++); break;
      case '--persona': case '--personas': {
        const v = val(i++);
        if (v === 'ages') a.personas = [...AGE_PERSONAS];   // 年齢・立場の9人（2026-09-28）
        else if (v !== 'all') {
          a.personas = v.split(',').map((id) => {
            const p = personaById(id.trim());
            if (!p) throw new Error(`unknown persona ${id}`);
            return p;
          });
        }
        break;
      }
      case '--max-usd': a.maxUsd = Number(val(i++)); break;
      case '--concurrency': a.concurrency = Math.max(1, Number(val(i++)) || 1); break;
      case '--model': a.model = val(i++); break;
      case '--strategy': {
        const s = val(i++) as CandidateStrategy;
        if (!CANDIDATE_STRATEGIES.includes(s)) throw new Error(`unknown strategy ${s}`);
        a.strategy = s;
        break;
      }
      case '--out': a.out = val(i++); break;
      case '--judge': {
        const j = val(i++);
        if (j !== 'jev' && j !== 'rules') throw new Error(`unknown judge ${j} (jev | rules)`);
        a.judge = j;
        break;
      }
      case '--dry-run': a.dryRun = true; break;
      case '--quiet': a.quiet = true; break;
      case '--analyze': a.analyze = val(i++); break;
      case '--help': case '-h':
        console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag ${f}`);
    }
  }
  if (!Number.isFinite(a.maxUsd) || a.maxUsd <= 0) throw new Error('--max-usd must be > 0');
  return a;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');

/* ------------------------------------------------------------------ */
/* Dry run: a scripted player (no network)                              */
/* ------------------------------------------------------------------ */

function scriptedPlayer(registry: ContentRegistry): LlmProvider {
  let n = 0;
  return {
    name: 'player:scripted',
    async complete(req: LlmRequest): Promise<LlmResult> {
      n++;
      const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      const title = /【事件】(.+?)（/.exec(req.user)?.[1];
      const c = registry.cases.find((x) => x.data.title === title)?.data;
      let out: Record<string, unknown>;
      if (req.user.includes('【審問 反証】')) {
        const st = /発言(\d+)（[^）]+）「[^《]*《([^》]+)》/.exec(req.user);
        const fact = /\n(F\d+): /.exec(req.user)?.[1];
        out = st && fact ? { think: 'とりあえず当てる', statement: Number(st[1]), span: st[2], fact } : { action: 'grant' };
      } else if (req.user.includes('【死因宣告】')) {
        out = { think: '宣告', action: 'verdict', verdict: c ? c.truth.summary.slice(0, 180) : '事故だった' };
      } else {
        const asked = (req.user.match(/^Q\d+ /gm) ?? []).length;
        const qs = c ? [...c.intro.starterQuestions, ...c.probes.filter((p) => p.kind === 'yes' || p.kind === 'core').map((p) => p.q)] : ['事故ですか'];
        const hints = (req.user.match(/・囁き\d/g) ?? []).length;
        out = asked >= 12 ? { think: '十分', action: 'inquest' } : asked === 5 && hints === 0 ? { think: '詰まった', action: 'hint' } : { think: '質問', action: 'ask', question: qs[asked % qs.length] };
      }
      return { text: JSON.stringify(out), usage, latencyMs: 0, model: `scripted#${n}` };
    },
  };
}

/* ------------------------------------------------------------------ */

function analyzeRuns(logs: RunLog[], registry: ContentRegistry, meta: PlaytestSummary['meta']): PlaytestSummary {
  const contradictions: PlaytestSummary['contradictions'] = [];
  const disagreements: PlaytestSummary['disagreements'] = [];
  const perRunContra = new Map<string, number>();
  for (const loaded of registry.cases) {
    const runs = logs.filter((l) => l.caseId === loaded.data.id);
    if (runs.length === 0) continue;
    const pool: PooledAsk[] = runs.flatMap((l) => l.asks.map((part) => ({ run: l.id, part })));
    const found = findContradictions(loaded.data.id, pool, loaded.index);
    contradictions.push(...found);
    for (const c of found) for (const r of new Set(c.items.map((i) => i.run))) perRunContra.set(r, (perRunContra.get(r) ?? 0) + 1);
    disagreements.push(...labelDisagreements(pool, loaded.index));
  }
  const metrics = logs.map((l) => {
    const loaded = registry.cases.find((c) => c.data.id === l.caseId)!;
    return runMetrics(l, loaded.data, loaded.index, perRunContra.get(l.id) ?? 0);
  });
  return { meta, metrics, contradictions, disagreements };
}

function fillLevels(log: RunLog, registry: ContentRegistry): void {
  const c = registry.cases.find((x) => x.data.id === log.caseId)?.data;
  if (!c) return;
  const lv = new Map(c.facts.map((f) => [f.id, f.spoilerLevel]));
  for (const a of log.asks) for (const u of a.unlocked) u.level = lv.get(u.id) ?? -1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env: EnvLike = { ...(process.env as EnvLike) };
  const registry = loadRegistry(resolveContentRoot(env));

  if (args.analyze) {
    const dir = resolve(args.analyze);
    const logs = readdirSync(join(dir, 'runs')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, 'runs', f), 'utf8')) as RunLog);
    const old = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as PlaytestSummary;
    const summary = analyzeRuns(logs, registry, old.meta);
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1));
    writeFileSync(join(dir, 'summary.md'), summaryMarkdown(summary, logs));
    console.log(`re-analysed ${logs.length} runs → ${join(dir, 'summary.md')}`);
    return;
  }

  const cases = registry.cases.filter((c) => args.cases === 'all' || c.data.id === args.cases || c.data.id.startsWith(args.cases));
  if (cases.length === 0) throw new Error(`no case matches "${args.cases}"`);
  const strategy = args.strategy ?? strategyFrom(env);
  const model = args.model ?? env.LLM_MODEL?.trim() ?? DEFAULT_LLM_MODEL;
  const budget = new SharedBudget(args.maxUsd);

  let jevInner: DecisionProvider | undefined;
  let llmInner: LlmProvider;
  if (args.dryRun) {
    llmInner = scriptedPlayer(registry);
  } else {
    if (!env.OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is not set');
    if (args.judge === 'jev') jevInner = createJevProvider(env);
    // The player: no reasoning, latency-first routing (same client as the renderer).
    llmInner = createOpenRouterLlm({ ...env, LLM_MODEL: model });
  }

  const outDir = join(resolve(args.out), stamp() + (args.dryRun ? '-dry' : ''));
  mkdirSync(join(outDir, 'runs'), { recursive: true });
  const jobs = cases.flatMap((c) => args.personas.map((p) => ({ caseId: c.data.id, persona: p })));
  console.log(`▶ playtest: ${jobs.length} runs (${cases.map((c) => c.data.id.slice(0, 3)).join(',')} × ${args.personas.map((p) => p.id).join(',')}), player ${args.dryRun ? 'scripted' : model}, judge ${args.dryRun || args.judge === 'rules' ? 'rules' : `jev[${strategy}]`}, cap $${args.maxUsd}`);

  const logs: RunLog[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const j = next++;
      if (j >= jobs.length) return;
      const { caseId, persona } = jobs[j];
      const id = `${caseId.slice(0, 3)}-${persona.id}`;
      if (budget.exhausted) {
        console.log(`  skip ${id}: budget reached`);
        continue;
      }
      const spend = newRunSpend();
      const decision = jevInner ? new BudgetedDecision(jevInner, budget, spend) : undefined;
      const components = args.dryRun || args.judge === 'rules' ? { mode: 'rules' as const, warnings: [] } : createComponents({ ...env, DECISION_PROVIDER: 'jev', PIPELINE_MODE: 'jev' }, 'jev', { decisionProvider: decision, strategy });
      const svc = new GameService({ content: () => registry, secret: 'playtest-secret-0123456789abcdef', components, dev: true });
      const llm = new BudgetedLlm(llmInner, budget, spend);
      const log = await playCase({ svc, caseId, persona, llm, model: args.dryRun ? 'scripted' : model, budget, spend, id, log: args.quiet ? undefined : (m) => console.log(`  ${m}`) });
      fillLevels(log, registry);
      logs.push(log);
      writeFileSync(join(outDir, 'runs', `${id}.json`), JSON.stringify(log, null, 1));
      console.log(`■ ${id}: ${log.outcome} — ${log.final.asked} questions, ${log.final.hintsUsed} hints, verdicts ${log.verdicts.map((v) => v.result).join('/') || '-'}, $${(spend.jevUsd + spend.llmUsd).toFixed(5)} (total $${budget.spent.toFixed(5)})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, jobs.length) }, worker));

  logs.sort((a, b) => a.id.localeCompare(b.id));
  const summary = analyzeRuns(logs, registry, {
    createdAt: new Date().toISOString(),
    player: args.dryRun ? 'scripted' : model,
    judge: args.dryRun || args.judge === 'rules' ? 'rules' : `jev[${strategy}]`,
    capUsd: args.maxUsd,
    spend: { jevUsd: round6(budget.jevUsd), llmUsd: round6(budget.llmUsd), totalUsd: round6(budget.spent), jevCalls: budget.jevCalls, llmCalls: budget.llmCalls, errors: budget.errors },
    runs: jobs.length,
    completed: logs.length,
  });
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(summary, logs));
  console.log(`\nspend: Jev $${budget.jevUsd.toFixed(5)} (${budget.jevCalls} calls) + player $${budget.llmUsd.toFixed(5)} (${budget.llmCalls} calls) = $${budget.spent.toFixed(5)} (${Math.round(budget.spent * 150 * 100) / 100}円) errors ${JSON.stringify(budget.errors)}`);
  console.log(`→ ${outDir}`);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

main().then(
  () => {
    process.exitCode = 0;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
