/**
 * Server runtime assembly (pure): config + pipeline components + GameService + limiter +
 * traces. The content source and Node-only sinks are injected (server/node/handler.ts).
 */
import type { PipelineMode } from '../../shared/api.js';
import { readConfig, type EngineConfig, type EnvLike } from '../engine/env.js';
import { createComponents } from '../engine/factory.js';
import { GameService } from '../engine/game.js';
import { BudgetGuard } from '../engine/budget.js';
import type { PipelineComponents } from '../engine/judge-types.js';
import type { ContentRegistry } from '../engine/registry.js';
import { consoleJsonSink, TraceHub, TraceRing, type TraceSink } from '../engine/trace.js';
import { RateLimiter, DEFAULT_RATE_RULES, type RateRule } from './rate-limit.js';

export interface BenchReportInfo {
  file: string;
  [k: string]: unknown;
}

export interface ApiRuntime {
  config: EngineConfig;
  service: GameService;
  components: PipelineComponents;
  limiter: RateLimiter;
  traces: TraceRing;
  budget: BudgetGuard;
  content: () => ContentRegistry | Promise<ContentRegistry>;
  listBenchReports?: () => Promise<BenchReportInfo[]>;
  startedAt: number;
  warnings: string[];
}

export interface RuntimeOptions {
  env: EnvLike;
  content: () => ContentRegistry | Promise<ContentRegistry>;
  /** Extra trace sinks (e.g. the dev JSONL file sink). */
  sinks?: TraceSink[];
  listBenchReports?: () => Promise<BenchReportInfo[]>;
  rateRules?: Record<string, RateRule[]>;
  clock?: () => number;
  /** Test hook: pre-built components instead of the env factory. */
  components?: PipelineComponents;
  componentsFor?: (mode: PipelineMode) => PipelineComponents;
}

let warnedSecret = false;

export function createRuntime(o: RuntimeOptions): ApiRuntime {
  const config = readConfig(o.env);
  const components = o.components ?? createComponents(o.env);
  const warnings = [...components.warnings];
  if (config.secretIsDefault) {
    const msg = config.dev
      ? 'SESSION_SECRET is not set — using the development default.'
      : 'SESSION_SECRET is not set in PRODUCTION — progress tokens can be forged. Set SESSION_SECRET.';
    warnings.push(msg);
    if (!warnedSecret) {
      warnedSecret = true;
      (config.dev ? console.warn : console.error)(`[janedoe] ${msg}`);
    }
  }
  for (const w of components.warnings) if (config.dev) console.warn(`[janedoe] ${w}`);

  const traces = new TraceRing(300);
  const sinks: TraceSink[] = [traces, ...(o.sinks ?? [])];
  if (!config.dev) sinks.push(consoleJsonSink);
  const budget = new BudgetGuard(config.dailyCostLimitUsd, o.clock);
  const service = new GameService({
    content: o.content,
    secret: config.sessionSecret,
    components,
    componentsFor: o.componentsFor ?? ((mode) => createComponents(o.env, mode)),
    dev: config.dev,
    budget,
    traces: new TraceHub(sinks),
    questionCap: config.questionCap,
    clock: o.clock,
  });
  return {
    config,
    service,
    components,
    limiter: new RateLimiter(o.rateRules ?? DEFAULT_RATE_RULES, o.clock),
    traces,
    budget,
    content: o.content,
    listBenchReports: o.listBenchReports,
    startedAt: (o.clock ?? Date.now)(),
    warnings,
  };
}
