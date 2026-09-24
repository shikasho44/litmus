/**
 * Builds the judge / renderer / checker components for a pipeline mode from env.
 *
 *   PIPELINE_MODE      rules | jev | jev+llm | jev+llm+check | llm   (default: jev when an
 *                      OpenRouter key is present, else rules)
 *   DECISION_PROVIDER  jev | rules      (rules → no model judge whatever the mode)
 *   LLM_PROVIDER       openrouter | codex | none
 *   LLM_MODEL          OpenRouter chat model (default providers/openrouter-llm DEFAULT_LLM_MODEL)
 *   JEV_MODEL          default 'typesafe/jev-1.13'
 *   JEV_CANDIDATES     topk | all | all+prior   (JevJudge candidate strategy, default topk)
 *
 * Every component that cannot be built (missing key, not a Node server for codex …) is left
 * out with a warning and the mode is degraded component by component — the game always runs
 * (a missing judge → rules decisions, a missing renderer → canned lines).
 *
 * Providers are cached per configuration signature, so `componentsFor(mode)` (admin
 * ask-debug overrides) and repeated createComponents() calls share one Codex child process /
 * one HTTP client instead of spawning new ones. Signatures are compared in memory only.
 * Server-only: the embedded browser client never imports this file.
 */
import type { PipelineMode } from '../../shared/api.js';
import type { EnvLike } from './env.js';
import { isDev, PIPELINE_MODES, readConfig } from './env.js';
import type { Judge, PipelineComponents, PostChecker, Renderer, VerdictJudge } from './judge-types.js';
import type { DecisionProvider, LlmProvider } from './providers/types.js';
import { createJevProvider } from './providers/jev.js';
import { createOpenRouterLlm } from './providers/openrouter-llm.js';
import { createCodexLlm } from './providers/codex.js';
import { CANDIDATE_STRATEGIES, DEFAULT_STRATEGY, JevJudge, JevPostChecker, JevVerdictJudge, type CandidateStrategy } from './ai/jev-judge.js';
import { LlmRenderer } from './ai/llm-renderer.js';
import { LlmJudge } from './ai/llm-judge.js';

function attempt<T>(what: string, warnings: string[], build: () => T): T | undefined {
  try {
    return build();
  } catch (e) {
    warnings.push(`${what}: ${e instanceof Error ? e.message : String(e)} — falling back`);
    return undefined;
  }
}

export interface ComponentOverrides {
  decisionProvider?: DecisionProvider;
  llm?: LlmProvider;
  strategy?: CandidateStrategy;
}

/* ------------------------------------------------------------------ */
/* Provider cache                                                      */
/* ------------------------------------------------------------------ */

const DECISION_KEYS = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY', 'JEV_MODEL'];
const LLM_KEYS = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_REASONING', 'LLM_PROVIDER_SORT', 'LLM_TIMEOUT_MS', 'OPENROUTER_API_KEY', 'CODEX_TRANSPORT', 'CODEX_BIN', 'CODEX_MODEL', 'CODEX_EFFORT', 'CODEX_TIMEOUT_MS', 'VERCEL'];
const providerCache = new Map<string, DecisionProvider | LlmProvider>();

function sig(env: EnvLike, keys: string[]): string {
  return keys.map((k) => `${k}=${env[k] ?? ''}`).join('\u0000');
}

function cached<T extends DecisionProvider | LlmProvider>(kind: string, key: string, build: () => T): T {
  const k = `${kind}\u0001${key}`;
  const hit = providerCache.get(k);
  if (hit) return hit as T;
  const p = build();
  if (providerCache.size > 32) providerCache.clear();
  providerCache.set(k, p);
  return p;
}

/** Test hook: forget cached providers. */
export function clearProviderCache(): void {
  providerCache.clear();
}

export function strategyFrom(env: EnvLike): CandidateStrategy {
  const s = (env.JEV_CANDIDATES ?? '').trim().toLowerCase() as CandidateStrategy;
  return CANDIDATE_STRATEGIES.includes(s) ? s : DEFAULT_STRATEGY;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

const warned = new Set<string>();
function logOnce(env: EnvLike, warnings: string[]): void {
  // runtime.ts prints component warnings in dev; production gets one line per distinct warning.
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (isDev(env) || p?.env?.VITEST) return;
  for (const w of warnings) {
    if (warned.has(w)) continue;
    warned.add(w);
    console.warn(`[janedoe] ${w}`);
  }
}

/** Assemble components for `mode` (defaults to PIPELINE_MODE). Never throws. */
export function createComponents(env: EnvLike, mode?: PipelineMode, overrides: ComponentOverrides = {}): PipelineComponents {
  const cfg = readConfig(env);
  const requested = mode ?? cfg.mode;
  const warnings: string[] = [];
  if (requested === 'rules') return { mode: 'rules', warnings };

  const wantJev = requested !== 'llm' && cfg.decisionProvider === 'jev';
  const needsLlm = requested === 'llm' || requested === 'jev+llm' || requested === 'jev+llm+check';
  if (requested !== 'llm' && cfg.decisionProvider === 'rules') warnings.push('DECISION_PROVIDER=rules — decisions come from the rules judge');

  let decision: DecisionProvider | undefined = overrides.decisionProvider;
  if (!decision && wantJev) {
    if (!cfg.hasOpenRouterKey && !env.TYPESAFE_API_KEY?.trim()) warnings.push('OPENROUTER_API_KEY is not set');
    decision = attempt('jev provider', warnings, () => cached('jev', sig(env, DECISION_KEYS), () => createJevProvider(env)));
  }

  let llm: LlmProvider | undefined = overrides.llm;
  if (!llm && needsLlm) {
    if (cfg.llmProvider === 'none') warnings.push(`mode ${requested} needs LLM_PROVIDER (openrouter | codex)`);
    else if (cfg.llmProvider === 'openrouter') llm = attempt('openrouter llm', warnings, () => cached('llm', sig(env, LLM_KEYS), () => createOpenRouterLlm(env)));
    else llm = attempt('codex llm', warnings, () => cached('llm', sig(env, LLM_KEYS), () => createCodexLlm(env)));
  }

  let judge: Judge | undefined;
  let renderer: Renderer | undefined;
  let postChecker: PostChecker | undefined;
  let verdictJudge: VerdictJudge | undefined;
  const strategy = overrides.strategy ?? strategyFrom(env);

  if (requested === 'llm') {
    if (llm) judge = attempt('LlmJudge', warnings, () => new LlmJudge({ llm: llm! }));
  } else {
    if (decision && wantJev) {
      judge = attempt('JevJudge', warnings, () => new JevJudge({ provider: decision!, model: cfg.jevModel, strategy }));
      verdictJudge = attempt('JevVerdictJudge', warnings, () => new JevVerdictJudge({ provider: decision!, model: cfg.jevModel }));
    }
    if (needsLlm && llm) renderer = attempt('LlmRenderer', warnings, () => new LlmRenderer({ llm: llm! }));
    if (requested === 'jev+llm+check') {
      // The checker needs Jev even when DECISION_PROVIDER=rules.
      let checkerProvider = decision;
      if (!checkerProvider) checkerProvider = attempt('jev provider (post-check)', warnings, () => cached('jev', sig(env, DECISION_KEYS), () => createJevProvider(env)));
      if (checkerProvider) postChecker = attempt('JevPostChecker', warnings, () => new JevPostChecker({ provider: checkerProvider!, model: cfg.jevModel }));
    }
  }

  // Effective mode = what actually got built.
  let effective: PipelineMode;
  if (requested === 'llm') effective = judge ? 'llm' : 'rules';
  else if (!judge && !renderer) effective = 'rules';
  else if (!renderer) effective = 'jev';
  else if (!postChecker) effective = 'jev+llm';
  else effective = 'jev+llm+check';
  if (!judge && renderer && requested !== 'llm') warnings.push('no decision judge — rules decisions with LLM phrasing');
  if (effective !== requested) warnings.push(`pipeline mode degraded: ${requested} → ${effective}`);
  logOnce(env, warnings);

  return { mode: effective, judge, renderer, postChecker, verdictJudge, warnings };
}

/**
 * Per-mode component sets for admin overrides (POST /api/admin/ask-debug {mode}). Built lazily
 * once per mode and reused; providers are shared through the provider cache.
 * Wire as `componentsFor: componentsFor(env)` in the runtime.
 */
export function componentsFor(env: EnvLike, overrides: ComponentOverrides = {}): (mode: PipelineMode) => PipelineComponents {
  const byMode = new Map<PipelineMode, PipelineComponents>();
  return (mode: PipelineMode) => {
    const m = PIPELINE_MODES.includes(mode) ? mode : readConfig(env).mode;
    let c = byMode.get(m);
    if (!c) {
      c = createComponents(env, m, overrides);
      byMode.set(m, c);
    }
    return c;
  };
}
