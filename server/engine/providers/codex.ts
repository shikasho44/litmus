/**
 * STUB — to be implemented by the AI builder.
 *
 * Development-only LlmProvider backed by the Codex app-server (ChatGPT sign-in quota).
 * Node-only: if it needs child_process / sockets, keep that code under server/node/ and
 * import it dynamically from here so the embedded browser build never pulls it in.
 *
 * Until implemented, construction throws ProviderError('config').
 */
import type { EnvLike } from '../env.js';
import { ProviderError, type LlmProvider } from './types.js';

export function createCodexLlm(env: EnvLike): LlmProvider {
  void env;
  throw new ProviderError('codex', 'config', 'Codex LLM provider not implemented yet (stub)');
}
