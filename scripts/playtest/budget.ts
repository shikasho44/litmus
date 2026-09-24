/**
 * One spend budget shared by every provider of a playtest invocation (Jev judge + verdict judge +
 * the player LLM), measured from each response's usage.cost. When the cap is reached, further
 * calls throw ProviderError('config'): the game degrades to the rules judge (notice 'degraded')
 * and the player loop stops the run with outcome 'budget'.
 */
import { ProviderError, type DecisionProvider, type DecisionQuestion, type DecisionResult, type LlmProvider, type LlmRequest, type LlmResult } from '../../server/engine/providers/types.js';

export class SharedBudget {
  jevUsd = 0;
  llmUsd = 0;
  jevCalls = 0;
  llmCalls = 0;
  errors: Record<string, number> = {};
  constructor(readonly capUsd: number) {}
  get spent(): number {
    return this.jevUsd + this.llmUsd;
  }
  get exhausted(): boolean {
    return this.spent >= this.capUsd;
  }
  error(kind: string): void {
    this.errors[kind] = (this.errors[kind] ?? 0) + 1;
  }
}

/** Per-run attribution on top of the shared budget. */
export interface RunSpend { jevUsd: number; llmUsd: number; jevCalls: number; llmCalls: number }
export const newRunSpend = (): RunSpend => ({ jevUsd: 0, llmUsd: 0, jevCalls: 0, llmCalls: 0 });

export class BudgetedDecision implements DecisionProvider {
  readonly name: string;
  constructor(private readonly inner: DecisionProvider, private readonly budget: SharedBudget, private readonly run: RunSpend) {
    this.name = inner.name;
  }
  async decide(state: unknown, questions: Record<string, DecisionQuestion>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<DecisionResult> {
    if (this.budget.exhausted) throw new ProviderError('jev', 'config', `playtest budget $${this.budget.capUsd} reached`);
    this.budget.jevCalls++;
    this.run.jevCalls++;
    try {
      const r = await this.inner.decide(state, questions, opts);
      this.budget.jevUsd += r.usage.costUsd;
      this.run.jevUsd += r.usage.costUsd;
      return r;
    } catch (e) {
      this.budget.error(`jev:${e instanceof ProviderError ? e.kind : 'other'}`);
      throw e;
    }
  }
}

export class BudgetedLlm implements LlmProvider {
  readonly name: string;
  constructor(private readonly inner: LlmProvider, private readonly budget: SharedBudget, private readonly run: RunSpend) {
    this.name = inner.name;
  }
  async complete(req: LlmRequest): Promise<LlmResult> {
    if (this.budget.exhausted) throw new ProviderError('llm', 'config', `playtest budget $${this.budget.capUsd} reached`);
    this.budget.llmCalls++;
    this.run.llmCalls++;
    try {
      const r = await this.inner.complete(req);
      this.budget.llmUsd += r.usage.costUsd;
      this.run.llmUsd += r.usage.costUsd;
      return r;
    } catch (e) {
      this.budget.error(`llm:${e instanceof ProviderError ? e.kind : 'other'}`);
      throw e;
    }
  }
}
