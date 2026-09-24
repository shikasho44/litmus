/**
 * STUB — to be implemented by the AI builder. See server/engine/judge-types.ts for the
 * full contract and docs/engine.md §AI for the design.
 *
 * JevJudge (implements Judge)
 *   new JevJudge({ provider: DecisionProvider, model?: string })
 *   judge(input: JudgeInput): Promise<JudgeDecision>
 *     - Build a Jev `state` from: the question (input.question.raw / norm, negated flag),
 *       the candidate facts (input.candidates.facts → id, text, judgeNote, ifAsked) and the
 *       top probes (as labelled examples). NEVER include facts outside the candidates.
 *     - Ask e.g. { answer: choice yes/no/partial/irrelevant/cannot/vague, fact: choice among
 *       candidate ids + 'none', closeness: score 0..3, specific: noul }.
 *     - Return answerClass, factIds, confidence (choice confidence), closeness,
 *       factStrength (probability of the chosen fact), qtype, source:'model', usage,
 *       latencyMs, raw (the DecisionResult).
 *
 * JevVerdictJudge (implements VerdictJudge)
 *   new JevVerdictJudge({ provider: DecisionProvider })
 *   one choice/noul question per answer element (judgeClaim) and per wrong claim.
 *
 * JevPostChecker (implements PostChecker)
 *   new JevPostChecker({ provider: DecisionProvider })
 *   checks a rendered line for: leaks beyond allowedFacts, wrong polarity vs answerClass,
 *   new facts, tone. pass=false with machine-readable reasons.
 *
 * Until implemented, construction throws ProviderError('config') → the factory uses rules.
 */
import type {
  Judge, JudgeDecision, JudgeInput, PostChecker, PostCheckInput, PostCheckOutput,
  VerdictJudge, VerdictJudgeInput, VerdictJudgeOutput,
} from '../judge-types.js';
import { ProviderError, type DecisionProvider } from '../providers/types.js';

export interface JevJudgeOptions {
  provider: DecisionProvider;
  model?: string;
}

const notYet = (what: string) => new ProviderError('jev', 'config', `${what} not implemented yet (stub)`);

export class JevJudge implements Judge {
  readonly name = 'jev';
  constructor(opts: JevJudgeOptions) {
    void opts;
    throw notYet('JevJudge');
  }
  async judge(input: JudgeInput): Promise<JudgeDecision> {
    void input;
    throw notYet('JevJudge.judge');
  }
}

export class JevVerdictJudge implements VerdictJudge {
  readonly name = 'jev-verdict';
  constructor(opts: JevJudgeOptions) {
    void opts;
    throw notYet('JevVerdictJudge');
  }
  async judge(input: VerdictJudgeInput): Promise<VerdictJudgeOutput> {
    void input;
    throw notYet('JevVerdictJudge.judge');
  }
}

export class JevPostChecker implements PostChecker {
  readonly name = 'jev-check';
  constructor(opts: JevJudgeOptions) {
    void opts;
    throw notYet('JevPostChecker');
  }
  async check(input: PostCheckInput): Promise<PostCheckOutput> {
    void input;
    throw notYet('JevPostChecker.check');
  }
}
