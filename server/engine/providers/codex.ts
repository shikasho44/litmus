/**
 * EXPERIMENTAL, DEVELOPMENT ONLY — LlmProvider backed by the local Codex CLI (ChatGPT sign-in
 * quota, so no per-token charge: usage.costUsd is always 0).
 *
 *   LLM_PROVIDER=codex        select it (factory.ts)
 *   CODEX_TRANSPORT           'app-server' (default: one persistent `codex app-server` child
 *                             speaking JSON-RPC over stdio) | 'exec' (`codex exec` per call)
 *   CODEX_BIN                 command to run (default 'codex')
 *   CODEX_MODEL               model override (default: the user's ~/.codex/config.toml model)
 *   CODEX_EFFORT              reasoning effort (default 'low')
 *   CODEX_TIMEOUT_MS          per-call timeout when the caller passes none (default 60000)
 *
 * Node-only. This module has NO static Node imports: the child-process code lives in
 * ./codex-node.ts and is loaded with a dynamic import on the first call, so the embedded
 * browser build (which never imports the factory anyway) and the Vercel function never load
 * it unless LLM_PROVIDER=codex. Construction refuses to run outside a Node server or on Vercel.
 *
 * Codex turns take seconds (≈3–15 s), longer than the pipeline's 4 s render stage, so in the
 * live game most turns will time out and fall back to canned lines. It is meant for local
 * experiments (bench with a single probe, admin ask-debug), not for play.
 */
import type { EnvLike } from '../env.js';
import { ProviderError, type LlmProvider, type LlmRequest, type LlmResult } from './types.js';

export interface CodexOptions {
  transport: 'app-server' | 'exec';
  bin: string;
  model?: string;
  effort: string;
  timeoutMs: number;
}

export function codexOptions(env: EnvLike): CodexOptions {
  const t = (env.CODEX_TRANSPORT ?? '').trim().toLowerCase();
  const timeout = Number(env.CODEX_TIMEOUT_MS);
  return {
    transport: t === 'exec' ? 'exec' : 'app-server',
    bin: env.CODEX_BIN?.trim() || 'codex',
    model: env.CODEX_MODEL?.trim() || undefined,
    effort: env.CODEX_EFFORT?.trim() || 'low',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60000,
  };
}

function isNodeServer(): boolean {
  const p = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return !!p?.versions?.node && typeof (globalThis as { window?: unknown }).window === 'undefined';
}

export function createCodexLlm(env: EnvLike): LlmProvider {
  if (!isNodeServer()) throw new ProviderError('codex', 'config', 'the Codex provider needs a Node server (child process)');
  if (env.VERCEL) throw new ProviderError('codex', 'config', 'the Codex provider is development-only and disabled on Vercel');
  const o = codexOptions(env);
  if (!/^[\w./:\\ -]+$/.test(o.bin)) throw new ProviderError('codex', 'config', 'CODEX_BIN contains unsupported characters');
  return {
    name: `codex:${o.transport}${o.model ? `:${o.model}` : ''}`,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const mod = await import('./codex-node.js');
      return mod.codexComplete(o, req);
    },
  };
}
