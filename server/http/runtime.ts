/**
 * Server runtime assembly (pure): config + pipeline components + GameService + limiter +
 * traces. The content source and Node-only sinks are injected (server/node/handler.ts).
 */
import type { PipelineMode } from '../../shared/api.js';
import { MIN_ADMIN_TOKEN_CHARS, MIN_SESSION_SECRET_CHARS, readConfig, type EngineConfig, type EnvLike } from '../engine/env.js';
import { componentsFor, createComponents } from '../engine/factory.js';
import { GameService } from '../engine/game.js';
import { BudgetGuard } from '../engine/budget.js';
import type { PipelineComponents } from '../engine/judge-types.js';
import type { ContentRegistry } from '../engine/registry.js';
import { consoleJsonSink, TraceHub, TraceRing, type TraceSink } from '../engine/trace.js';
import { RateLimiter, DEFAULT_RATE_RULES, type RateRule } from './rate-limit.js';
import { VersusService } from '../versus/service.js';
import { sharedMemoryStore, type RoomStore } from '../versus/store.js';
import { UpstashRoomStore, upstashConfig } from '../versus/upstash.js';

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
  /** public/<path> exists (Node hosts) — lets the admin case check warn about missing images. */
  assetExists?: (publicPath: string) => boolean;
  startedAt: number;
  warnings: string[];
  /** Online versus (docs/versus.md); undefined = disabled (see `versusInfo.reason`). */
  versus?: VersusService;
  versusInfo: { enabled: boolean; store?: RoomStore['kind']; reason?: string };
}

/**
 * The room store for online versus:
 *   Upstash Redis REST (UPSTASH_REDIS_REST_URL/_TOKEN or Vercel's KV_REST_API_URL/_TOKEN) wherever set;
 *   else the in-process memory store on the dev server (or with VERSUS_STORE=memory on a
 *   single long-lived process such as `vite preview`); else disabled — serverless instances do
 *   not share memory, so production never falls back to it. VERSUS_ENABLED=false switches it off.
 */
export function versusStoreFor(env: EnvLike, dev: boolean): { store?: RoomStore; reason?: string } {
  if (/^(0|false|off|no)$/i.test((env.VERSUS_ENABLED ?? '').trim())) return { reason: 'VERSUS_ENABLED is off' };
  const up = upstashConfig(env);
  if (up) return { store: new UpstashRoomStore(up) };
  const wantMemory = (env.VERSUS_STORE ?? '').trim().toLowerCase() === 'memory';
  if (dev || (wantMemory && !env.VERCEL)) return { store: sharedMemoryStore() };
  return { reason: 'no room store configured (set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)' };
}

export interface RuntimeOptions {
  env: EnvLike;
  content: () => ContentRegistry | Promise<ContentRegistry>;
  /** Extra trace sinks (e.g. the dev JSONL file sink). */
  sinks?: TraceSink[];
  listBenchReports?: () => Promise<BenchReportInfo[]>;
  assetExists?: (publicPath: string) => boolean;
  rateRules?: Record<string, RateRule[]>;
  clock?: () => number;
  /** Test hook: pre-built components instead of the env factory. */
  components?: PipelineComponents;
  componentsFor?: (mode: PipelineMode) => PipelineComponents;
  /** Test hook: the versus room store (null = versus disabled). Default: versusStoreFor(env). */
  roomStore?: RoomStore | null;
}

const warnedOnce = new Set<string>();
function warnOnce(level: 'warn' | 'error', msg: string): void {
  if (warnedOnce.has(msg)) return;
  warnedOnce.add(msg);
  (level === 'warn' ? console.warn : console.error)(`[janedoe] ${msg}`);
}

export function createRuntime(o: RuntimeOptions): ApiRuntime {
  const config = readConfig(o.env);
  const components = o.components ?? createComponents(o.env);
  const warnings = [...components.warnings];
  if (config.misconfigured) {
    // Fail closed (handler.ts): token routes answer 503 until a real secret is configured.
    const msg = `${config.misconfigured} in PRODUCTION — every progress-token route answers 503 (server misconfigured). Set SESSION_SECRET to a random string of at least ${MIN_SESSION_SECRET_CHARS} characters.`;
    warnings.push(msg);
    warnOnce('error', msg);
  } else if (config.secretIsDefault) {
    const msg = 'SESSION_SECRET is not set — using the development default (development only).';
    warnings.push(msg);
    warnOnce('warn', msg);
  }
  if (config.adminTokenRejected) {
    const msg = `ADMIN_TOKEN is shorter than ${MIN_ADMIN_TOKEN_CHARS} characters — the admin API stays disabled in production.`;
    warnings.push(msg);
    warnOnce('error', msg);
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
    // Built once per mode and reused (admin ask-debug overrides); providers are shared anyway.
    componentsFor: o.componentsFor ?? componentsFor(o.env),
    dev: config.dev,
    budget,
    traces: new TraceHub(sinks),
    questionCap: config.questionCap,
    clock: o.clock,
  });
  const vs = o.roomStore !== undefined ? { store: o.roomStore ?? undefined, reason: o.roomStore ? undefined : 'disabled' } : versusStoreFor(o.env, config.dev);
  const versus =
    vs.store && !config.misconfigured
      ? new VersusService({ store: vs.store, secret: config.sessionSecret, content: o.content, dev: config.dev, clock: o.clock })
      : undefined;
  if (!versus && config.dev && vs.reason) console.warn(`[janedoe] versus disabled: ${vs.reason}`);
  return {
    config,
    service,
    components,
    versus,
    versusInfo: { enabled: !!versus, store: versus?.store.kind, reason: versus ? undefined : (vs.reason ?? 'server misconfigured') },
    limiter: new RateLimiter(o.rateRules ?? DEFAULT_RATE_RULES, o.clock),
    traces,
    budget,
    content: o.content,
    listBenchReports: o.listBenchReports,
    assetExists: o.assetExists,
    startedAt: (o.clock ?? Date.now)(),
    warnings,
  };
}
