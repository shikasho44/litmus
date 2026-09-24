/**
 * STUB — to be implemented by the AI builder. Contract: server/engine/judge-types.ts (Judge).
 *
 * LlmJudge — MODE A baseline ('llm'): the LLM receives the whole case truth and answers as
 * JSON { answerClass, factIds, confidence, closeness, line }. The returned JudgeDecision
 * may carry `line` (+ `mood`); the pipeline still applies policy.ts (what unlocks) and the
 * code leak check, and falls back to canned lines when the line is rejected.
 *   new LlmJudge({ llm: LlmProvider })
 *
 * Until implemented, construction throws ProviderError('config') → the factory uses rules.
 */
import type { Judge, JudgeDecision, JudgeInput } from '../judge-types.js';
import { ProviderError, type LlmProvider } from '../providers/types.js';

export interface LlmJudgeOptions {
  llm: LlmProvider;
}

export class LlmJudge implements Judge {
  readonly name = 'llm-judge';
  constructor(opts: LlmJudgeOptions) {
    void opts;
    throw new ProviderError('llm', 'config', 'LlmJudge not implemented yet (stub)');
  }
  async judge(input: JudgeInput): Promise<JudgeDecision> {
    void input;
    throw new ProviderError('llm', 'config', 'LlmJudge.judge not implemented yet (stub)');
  }
}
