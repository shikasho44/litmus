/**
 * Provider contracts. The pipeline depends only on these interfaces, so providers
 * (Jev via OpenRouter, a chat LLM via OpenRouter, Codex app-server, a fake for tests)
 * can be swapped by configuration.
 *
 * Jev response shape (verified 2026-09-24 against POST https://openrouter.ai/api/alpha/decisions,
 * model "typesafe/jev-1.13", 865 ms, $0.00003):
 *   choice → { type:'choice', choice:'no', probabilities:{yes:0,no:0.99,...}, confidence:0.99 }
 *   score  → { type:'score', score:1.99, legend:{'0':'…',...}, probabilities:{'0':0.12,...}, confidence:0 }
 *   noul   → { type:'noul', noul:0.44 }
 *   usage  → { input_tokens:713, output_tokens:129, cost:0.000029946 }
 * Request: { model, state: <string|object>, questions: { key: {type:'choice', instructions, criteria:{key:desc}} |
 *            {type:'score', instructions, criteria:[low…high]} | {type:'noul', instructions} } }
 */

export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }

export type DecisionQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

export type DecisionAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number };

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  usage: Usage;
  latencyMs: number;
  raw?: unknown;
}

export interface DecisionProvider {
  readonly name: string;
  decide(
    state: unknown,
    questions: Record<string, DecisionQuestion>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<DecisionResult>;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object response (provider-specific support). */
  json?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmResult { text: string; usage: Usage; latencyMs: number; model: string }

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public kind: 'timeout' | 'rate_limited' | 'server' | 'bad_request' | 'network' | 'config',
    message: string,
  ) {
    super(`[${provider}] ${kind}: ${message}`);
  }
  get retryable() { return this.kind === 'timeout' || this.kind === 'rate_limited' || this.kind === 'server' || this.kind === 'network'; }
}
