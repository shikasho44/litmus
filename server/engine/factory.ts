/**
 * Builds the judge / renderer / checker components for a pipeline mode from env.
 *
 *   PIPELINE_MODE      rules | jev | jev+llm | jev+llm+check | llm   (default: jev when an
 *                      OpenRouter key is present, else rules)
 *   DECISION_PROVIDER  jev | rules      (rules → no model judge whatever the mode)
 *   LLM_PROVIDER       openrouter | codex | none
 *   LLM_MODEL, JEV_MODEL
 *
 * Every component that cannot be built (missing key, stub not implemented yet …) is left
 * out with a warning and the mode is degraded accordingly — the game always runs.
 * Server-only: the embedded browser client never imports this file.
 */
import type { PipelineMode } from '../../shared/api.js';
import type { EnvLike } from './env.js';
import { readConfig } from './env.js';
import type { Judge, PipelineComponents, PostChecker, Renderer, VerdictJudge } from './judge-types.js';
import type { DecisionProvider, LlmProvider } from './providers/types.js';
import { createJevProvider } from './providers/jev.js';
import { createOpenRouterLlm } from './providers/openrouter-llm.js';
import { createCodexLlm } from './providers/codex.js';
import { JevJudge, JevPostChecker, JevVerdictJudge } from './ai/jev-judge.js';
import { LlmRenderer } from './ai/llm-renderer.js';
import { LlmJudge } from './ai/llm-judge.js';

function attempt<T>(what: string, warnings: string[], build: () => T): T | undefined {
  try {
    return build();
  } catch (e) {
    warnings.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

export interface ComponentOverrides {
  decisionProvider?: DecisionProvider;
  llm?: LlmProvider;
}

/** Assemble components for `mode` (defaults to PIPELINE_MODE). Never throws. */
export function createComponents(env: EnvLike, mode?: PipelineMode, overrides: ComponentOverrides = {}): PipelineComponents {
  const cfg = readConfig(env);
  const requested = mode ?? cfg.mode;
  const warnings: string[] = [];
  if (requested === 'rules') return { mode: 'rules', warnings };

  const needsJev = requested !== 'llm' && cfg.decisionProvider === 'jev';
  const needsLlm = requested === 'llm' || requested === 'jev+llm' || requested === 'jev+llm+check';

  let decision: DecisionProvider | undefined = overrides.decisionProvider;
  if (!decision && (needsJev || requested === 'jev+llm+check')) {
    if (!cfg.hasOpenRouterKey && cfg.decisionProvider === 'jev') warnings.push('OPENROUTER_API_KEY is not set');
    decision = attempt('jev provider', warnings, () => createJevProvider(env));
  }

  let llm: LlmProvider | undefined = overrides.llm;
  if (!llm && needsLlm) {
    if (cfg.llmProvider === 'none') warnings.push(`mode ${requested} needs LLM_PROVIDER (openrouter | codex)`);
    else if (cfg.llmProvider === 'openrouter') llm = attempt('openrouter llm', warnings, () => createOpenRouterLlm(env));
    else llm = attempt('codex llm', warnings, () => createCodexLlm(env));
  }

  let judge: Judge | undefined;
  let renderer: Renderer | undefined;
  let postChecker: PostChecker | undefined;
  let verdictJudge: VerdictJudge | undefined;

  if (requested === 'llm') {
    if (llm) judge = attempt('LlmJudge', warnings, () => new LlmJudge({ llm: llm! }));
  } else {
    if (decision && cfg.decisionProvider === 'jev') {
      judge = attempt('JevJudge', warnings, () => new JevJudge({ provider: decision!, model: cfg.jevModel }));
      verdictJudge = attempt('JevVerdictJudge', warnings, () => new JevVerdictJudge({ provider: decision!, model: cfg.jevModel }));
    }
    if (needsLlm && llm) renderer = attempt('LlmRenderer', warnings, () => new LlmRenderer({ llm: llm! }));
    if (requested === 'jev+llm+check' && decision) postChecker = attempt('JevPostChecker', warnings, () => new JevPostChecker({ provider: decision!, model: cfg.jevModel }));
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

  return { mode: effective, judge, renderer, postChecker, verdictJudge, warnings };
}
