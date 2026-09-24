/**
 * STUB — to be implemented by the AI builder.
 *
 * Jev decision provider: POST https://openrouter.ai/api/alpha/decisions
 *   body    { model: env.JEV_MODEL ?? 'typesafe/jev-1.13', state, questions }
 *   headers Authorization: Bearer ${env.OPENROUTER_API_KEY}   (server only, never logged)
 * Map the verified response shape (see ./types.ts header) to DecisionResult, and HTTP /
 * transport failures to ProviderError kinds: 408/timeout → 'timeout', 429 → 'rate_limited',
 * 5xx → 'server', fetch failure → 'network', 400/422 → 'bad_request', missing key → 'config'.
 * Honour opts.signal and opts.timeoutMs.
 *
 * Until implemented, construction throws ProviderError('config') and the factory runs the
 * pipeline in 'rules' mode.
 */
import type { EnvLike } from '../env.js';
import { ProviderError, type DecisionProvider } from './types.js';

export function createJevProvider(env: EnvLike): DecisionProvider {
  void env;
  throw new ProviderError('jev', 'config', 'Jev provider not implemented yet (stub)');
}
