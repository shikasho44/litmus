/**
 * Chat LLM via OpenRouter (POST https://openrouter.ai/api/v1/chat/completions).
 *
 *   LLM_MODEL          model slug (default DEFAULT_LLM_MODEL — see docs/ai.md for why)
 *   LLM_REASONING      'off' (default: reasoning disabled — lines are 1 sentence, speed matters)
 *                      | minimal | low | medium | high
 *   LLM_PROVIDER_SORT  'latency' (default) | 'throughput' | 'price' — OpenRouter provider routing.
 *                      Price-first routing can land on a "flex" endpoint with a 30 s p50.
 *   LLM_TIMEOUT_MS     per-call timeout when the caller passes none (default 8000)
 *
 * Usage accounting is requested (`usage: {include: true}`) so `costUsd` is the real charge.
 * JSON mode (`json: true`) sends response_format {type:'json_object'}.
 * Errors map to ProviderError kinds exactly like ./jev.ts (see ./http.ts).
 * Key: OPENROUTER_API_KEY (server only — never logged, never in errors).
 */
import type { EnvLike } from '../env.js';
import { postJson, type FetchLike } from './http.js';
import { mapUsage } from './jev.js';
import { ProviderError, type LlmProvider, type LlmRequest, type LlmResult } from './types.js';

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
/**
 * Default: DeepSeek V4 Flash 0731 — chosen 2026-09-24 from the live OpenRouter catalog
 * (cheap: ≈$0.03–0.14/M in, $0.18–0.55/M out depending on the routed provider; many fast
 * providers, p50 0.4–1 s; good Japanese; reasoning can be switched off). Measured in docs/ai.md.
 */
export const DEFAULT_LLM_MODEL = 'deepseek/deepseek-v4-flash-0731';
export const DEFAULT_LLM_TIMEOUT_MS = 8000;

export interface OpenRouterLlmOptions {
  fetchImpl?: FetchLike;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : typeof c?.text === 'string' ? c.text : '')).join('');
  return '';
}

export function createOpenRouterLlm(env: EnvLike, opts: OpenRouterLlmOptions = {}): LlmProvider {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new ProviderError('openrouter', 'config', 'OPENROUTER_API_KEY is not set');
  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  const reasoningRaw = (env.LLM_REASONING ?? 'off').trim().toLowerCase();
  const reasoning = reasoningRaw === '' || reasoningRaw === 'off' || reasoningRaw === 'none' || reasoningRaw === 'false' ? { enabled: false } : { effort: reasoningRaw };
  const sortRaw = (env.LLM_PROVIDER_SORT ?? 'latency').trim().toLowerCase();
  const sort = sortRaw === 'price' || sortRaw === 'throughput' || sortRaw === 'latency' ? sortRaw : 'latency';
  const defaultTimeout = Number(env.LLM_TIMEOUT_MS) > 0 ? Number(env.LLM_TIMEOUT_MS) : DEFAULT_LLM_TIMEOUT_MS;
  const headers = { authorization: `Bearer ${key}`, 'x-title': 'janedoe' };

  return {
    name: `openrouter:${model}`,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens ?? 200,
        temperature: req.temperature ?? 0.7,
        usage: { include: true },
        reasoning,
        provider: { sort },
      };
      if (req.json) body.response_format = { type: 'json_object' };
      const { data, latencyMs } = await postJson('openrouter', OPENROUTER_CHAT_URL, body, headers, {
        signal: req.signal,
        timeoutMs: req.timeoutMs ?? defaultTimeout,
        fetchImpl: opts.fetchImpl,
      });
      const choice = data?.choices?.[0];
      if (!choice) throw new ProviderError('openrouter', 'server', 'response has no choices');
      return {
        text: textOf(choice.message?.content).trim(),
        usage: mapUsage(data?.usage),
        latencyMs,
        model: typeof data?.model === 'string' ? data.model : model,
      };
    },
  };
}
