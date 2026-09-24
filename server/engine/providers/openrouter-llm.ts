/**
 * STUB — to be implemented by the AI builder.
 *
 * Chat LLM via OpenRouter (POST https://openrouter.ai/api/v1/chat/completions) with
 * model env.LLM_MODEL. Implements LlmProvider.complete(): system + user messages,
 * maxTokens, temperature, optional JSON response, usage (tokens + cost) and latency.
 * Error mapping as in ./jev.ts. Key: env.OPENROUTER_API_KEY (server only, never logged).
 *
 * Until implemented, construction throws ProviderError('config').
 */
import type { EnvLike } from '../env.js';
import { ProviderError, type LlmProvider } from './types.js';

export function createOpenRouterLlm(env: EnvLike): LlmProvider {
  void env;
  throw new ProviderError('openrouter', 'config', 'OpenRouter LLM provider not implemented yet (stub)');
}
