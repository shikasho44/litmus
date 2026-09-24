/**
 * Environment → engine configuration. `env` is always passed explicitly (process.env on
 * Node/Vercel, loadEnv() in the Vite plugin, a literal in tests / the embedded client);
 * nothing here touches process directly, so it runs in the browser too.
 */
import type { PipelineMode } from '../../shared/api.js';

export type EnvLike = Record<string, string | undefined>;

export const PIPELINE_MODES: readonly PipelineMode[] = ['rules', 'jev', 'jev+llm', 'jev+llm+check', 'llm'];
export const DEV_SESSION_SECRET = 'janedoe-dev-secret-NOT-FOR-PRODUCTION';
/** Fixed key for the embedded (static) build. Tokens there are NOT secure — by design. */
export const EMBEDDED_SESSION_SECRET = 'janedoe-embedded-insecure-key';

export interface EngineConfig {
  dev: boolean;
  /** Requested pipeline mode (the factory may degrade it, see factory.ts). */
  mode: PipelineMode;
  decisionProvider: 'jev' | 'rules';
  llmProvider: 'openrouter' | 'codex' | 'none';
  llmModel?: string;
  jevModel: string;
  dailyCostLimitUsd: number;
  sessionSecret: string;
  secretIsDefault: boolean;
  adminToken?: string;
  hasOpenRouterKey: boolean;
  /** Per-token question cap. */
  questionCap: number;
}

export function isDev(env: EnvLike): boolean {
  const app = (env.APP_ENV ?? '').toLowerCase();
  if (app === 'development' || app === 'dev') return true;
  if (app === 'production' || app === 'prod') return false;
  return (env.NODE_ENV ?? '').toLowerCase() === 'development';
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function readConfig(env: EnvLike): EngineConfig {
  const hasKey = !!(env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.trim());
  const decisionProvider = (env.DECISION_PROVIDER ?? '').trim().toLowerCase() === 'rules' ? 'rules' : 'jev';
  const llmRaw = (env.LLM_PROVIDER ?? 'none').trim().toLowerCase();
  const llmProvider = llmRaw === 'openrouter' || llmRaw === 'codex' ? llmRaw : 'none';
  const modeRaw = (env.PIPELINE_MODE ?? '').trim().toLowerCase() as PipelineMode;
  const mode: PipelineMode = PIPELINE_MODES.includes(modeRaw) ? modeRaw : hasKey && decisionProvider === 'jev' ? 'jev' : 'rules';
  const secret = (env.SESSION_SECRET ?? '').trim();
  const secretIsDefault = secret.length === 0 || secret === 'change-me-to-a-long-random-string';
  return {
    dev: isDev(env),
    mode,
    decisionProvider,
    llmProvider,
    llmModel: env.LLM_MODEL?.trim() || undefined,
    jevModel: env.JEV_MODEL?.trim() || 'typesafe/jev-1.13',
    dailyCostLimitUsd: num(env.DAILY_COST_LIMIT_USD, 1),
    sessionSecret: secretIsDefault ? DEV_SESSION_SECRET : secret,
    secretIsDefault,
    adminToken: env.ADMIN_TOKEN?.trim() || undefined,
    hasOpenRouterKey: hasKey,
    questionCap: Math.max(1, Math.floor(num(env.QUESTION_CAP, 400))),
  };
}
