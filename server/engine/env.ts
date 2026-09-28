/**
 * Environment → engine configuration. `env` is always passed explicitly (process.env on
 * Node/Vercel, loadEnv() in the Vite plugin, a literal in tests / the embedded client);
 * nothing here touches process directly, so it runs in the browser too.
 */
import type { PipelineMode } from '../../shared/api.js';

export type EnvLike = Record<string, string | undefined>;

export const PIPELINE_MODES: readonly PipelineMode[] = ['rules', 'jev', 'jev+llm', 'jev+llm+check', 'llm'];
/** Development / tests only. Production never signs with it (see `misconfigured`). */
export const DEV_SESSION_SECRET = 'janedoe-dev-secret-NOT-FOR-PRODUCTION';
/** Fixed key for the embedded (static) build. Tokens there are NOT secure — by design. */
export const EMBEDDED_SESSION_SECRET = 'janedoe-embedded-insecure-key';
/** The .env.example value — treated as "not set". */
export const PLACEHOLDER_SESSION_SECRET = 'change-me-to-a-long-random-string';
/** Production minimums (characters). Shorter values are refused, never "accepted with a warning". */
export const MIN_SESSION_SECRET_CHARS = 32;
export const MIN_ADMIN_TOKEN_CHARS = 32;

/**
 * Per-process random key used in production when SESSION_SECRET is unusable. The token routes
 * answer 503 in that state anyway (handler.ts); this only makes sure that nothing could ever be
 * signed or verified with a key an attacker knows (the public DEV_SESSION_SECRET).
 * Made on first use, not at import: Cloudflare Workers refuse random values in the global scope.
 */
let ephemeralSecret: string | undefined;
function getEphemeralSecret(): string {
  if (ephemeralSecret) return ephemeralSecret;
  const bytes = new Uint8Array(32);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return (ephemeralSecret = `ephemeral-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`);
}

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
  /** SESSION_SECRET is empty or the .env.example placeholder. */
  secretIsDefault: boolean;
  /** SESSION_SECRET is set but shorter than MIN_SESSION_SECRET_CHARS. */
  secretTooShort: boolean;
  /**
   * Production without a usable SESSION_SECRET (missing, placeholder or too short): FAIL CLOSED.
   * Every route that signs or verifies a progress token answers 503 (handler.ts) and
   * `sessionSecret` is a random per-process key. Undefined when the server is usable.
   */
  misconfigured?: string;
  /** Admin token, only when usable (production: ≥ MIN_ADMIN_TOKEN_CHARS). */
  adminToken?: string;
  /** ADMIN_TOKEN was set but refused (production, shorter than MIN_ADMIN_TOKEN_CHARS). */
  adminTokenRejected: boolean;
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
  const dev = isDev(env);
  const secret = (env.SESSION_SECRET ?? '').trim();
  const secretIsDefault = secret.length === 0 || secret === PLACEHOLDER_SESSION_SECRET;
  const secretTooShort = !secretIsDefault && [...secret].length < MIN_SESSION_SECRET_CHARS;
  const misconfigured = dev
    ? undefined
    : secretIsDefault
      ? 'SESSION_SECRET is not set'
      : secretTooShort
        ? `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_CHARS} characters`
        : undefined;
  const admin = (env.ADMIN_TOKEN ?? '').trim();
  const adminTokenRejected = !dev && admin.length > 0 && [...admin].length < MIN_ADMIN_TOKEN_CHARS;
  return {
    dev,
    mode,
    decisionProvider,
    llmProvider,
    llmModel: env.LLM_MODEL?.trim() || undefined,
    jevModel: env.JEV_MODEL?.trim() || 'typesafe/jev-1.13',
    dailyCostLimitUsd: num(env.DAILY_COST_LIMIT_USD, 1),
    // Dev: the public dev key is fine (and a short secret is the developer's choice).
    // Production: never the public key — misconfigured → random key + 503 on token routes.
    sessionSecret: misconfigured ? getEphemeralSecret() : secretIsDefault ? DEV_SESSION_SECRET : secret,
    secretIsDefault,
    secretTooShort,
    misconfigured,
    adminToken: admin.length > 0 && !adminTokenRejected ? admin : undefined,
    adminTokenRejected,
    hasOpenRouterKey: hasKey,
    questionCap: Math.max(1, Math.floor(num(env.QUESTION_CAP, 400))),
  };
}
