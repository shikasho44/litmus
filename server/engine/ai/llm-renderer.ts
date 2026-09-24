/**
 * STUB — to be implemented by the AI builder. Contract: server/engine/judge-types.ts (Renderer).
 *
 * LlmRenderer (implements Renderer, canned = false)
 *   new LlmRenderer({ llm: LlmProvider })
 *   render(input: RenderInput): Promise<RenderOutput>
 *     - Rephrase Holma's reply in character (丁寧語・「〜ですねェ」「クックック」, 1–2 short
 *       sentences, ≤ 120 chars) for the ALREADY DECIDED input.answerClass.
 *     - May only reference input.allowedFacts; must keep the polarity (はい/いいえ/…);
 *       use input.cannedLine as the style anchor. Return `prompt` for traces.
 *     - The pipeline leak-checks every output against case.leakTerms and falls back to
 *       the canned line on any problem, so never "fix" things silently here.
 *
 * Until implemented, construction throws ProviderError('config') → canned lines are used.
 */
import type { Renderer, RenderInput, RenderOutput } from '../judge-types.js';
import { ProviderError, type LlmProvider } from '../providers/types.js';

export interface LlmRendererOptions {
  llm: LlmProvider;
}

export class LlmRenderer implements Renderer {
  readonly name = 'llm-renderer';
  readonly canned = false;
  constructor(opts: LlmRendererOptions) {
    void opts;
    throw new ProviderError('llm', 'config', 'LlmRenderer not implemented yet (stub)');
  }
  async render(input: RenderInput): Promise<RenderOutput> {
    void input;
    throw new ProviderError('llm', 'config', 'LlmRenderer.render not implemented yet (stub)');
  }
}
