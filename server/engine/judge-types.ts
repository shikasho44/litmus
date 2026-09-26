/**
 * Pluggable judgement interfaces for the ask / verdict pipeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS if you implement the AI side (server/engine/ai/*, providers/*).
 * ─────────────────────────────────────────────────────────────────────────────
 * The pipeline (pipeline.ts) owns the RULES. Implementations here only JUDGE or PHRASE:
 *
 *   Judge          question → answer class + which facts it is about + confidence.
 *                  Never decides what unlocks: policy.ts does that from your output
 *                  (answer ∈ yes/no/partial, confidence, spoilerLevel, requires …).
 *   VerdictJudge   free-text verdict → probability per answer element / wrong claim.
 *                  The rules keyword match is always computed too; verdict.ts merges.
 *   Renderer       phrases Holma's line for an ALREADY DECIDED answer class, using only
 *                  `allowedFacts`. Must keep the answer class and never add facts.
 *   PostChecker    validates a rendered line (leak / contradiction / wrong polarity).
 *
 * Contract for all implementations:
 *   - Throw `ProviderError` (server/engine/providers/types.ts) on transport problems.
 *     kind 'timeout' | 'rate_limited' | 'server' | 'network' are retried once by the
 *     pipeline and then degraded to the rules judge; 'config' | 'bad_request' degrade
 *     immediately. Never swallow errors into a fake answer.
 *   - Respect `signal` / `timeoutMs` (the pipeline keeps a per-turn deadline ≈ 9 s).
 *   - Return `usage` ({inputTokens, outputTokens, costUsd}) — the budget guard sums it.
 *   - Put the provider's raw decision in `raw` (shown in admin traces / bench, never to players).
 *   - Constructors may throw ProviderError('config') when a key/model is missing; the
 *     factory then falls back to rules for that component and logs a warning.
 *
 * The rules decision for the same question is always passed in (`input.rules`) — use it as
 * a prior, a tie-breaker, or ignore it. Candidate facts/probes come pre-ranked from
 * retrieve.ts; a model judge should normally choose `factIds` among `input.candidates.facts`.
 */
import type { AnswerClass, Case, Fact } from '../../shared/case-schema.js';
import type { HolmaMood, PipelineMode } from '../../shared/api.js';
import type { AnalyzedQuestion, MetaKind } from './normalize.js';
import type { Candidates } from './retrieve.js';
import type { CaseIndex } from './case-index.js';
import type { Usage } from './providers/types.js';

export type { Usage };

/** How the question is shaped. */
export type QuestionType = 'yesno' | 'open' | 'meta' | 'unknown';

/** Where a decision came from (for traces / policy strength). */
export type DecisionSource = 'probe' | 'keyword' | 'meta' | 'open' | 'fallback' | 'model';

export interface JudgeDecision {
  answerClass: AnswerClass;
  /** Facts the question is about, most relevant first. Only ids that exist in the case. */
  factIds: string[];
  /** 0..1 — how sure the judge is about answerClass AND factIds. */
  confidence: number;
  /**
   * 0..3 — how close the question is to the core truth.
   * 0 unrelated/atmosphere · 1 supporting · 2 important · 3 core / the answer itself.
   */
  closeness: 0 | 1 | 2 | 3;
  qtype: QuestionType;
  source: DecisionSource;
  meta?: MetaKind | 'open';
  /**
   * Per-fact match strength 0..1 (probe similarity or keyword strength). Policy requires
   * ≥ 0.7 to unlock spoilerLevel-3 facts. Model judges: put the probability that the
   * question specifically targets that fact.
   */
  factStrength?: Record<string, number>;
  /**
   * A deterministic guard decided this part (rules judge): no model is consulted.
   * 'secretName' = the question names the victim (identity is secret until solved).
   * 'manner' = murder / accident / suicide / culprit / intent — decided in the inquest (manner.ts).
   */
  guard?: 'secretName' | 'manner';
  /**
   * Rules: a qualifier of the question (「毒」 in 「毒ガスが出ていた？」) that a ruled-out fact
   * denies, so a はい was lowered to 一部そう (rules-judge.ts). Model judges keep a はい from
   * confirming it too (jev-judge.ts).
   */
  qualifier?: string;
  /** Best authored probe match (rules), for traces. */
  probe?: { q: string; score: number; kind: string; flipped: boolean };
  /**
   * Optional risk flags from a model judge (probabilities 0..1). `selfHarm` ≥ 0.5 makes the
   * pipeline treat the turn exactly like the rules safety filter (serious refusal, notice
   * 'support', nothing unlocks, no LLM phrasing). `directAnswer` = asks to be told the answer.
   */
  flags?: { selfHarm?: number; directAnswer?: number; offtopic?: number };
  /** Full-LLM mode only: a line already phrased by the judging model (still leak-checked). */
  line?: string;
  mood?: HolmaMood;
  usage?: Usage;
  latencyMs?: number;
  /** Provider-specific raw decision (admin/bench only). */
  raw?: unknown;
}

export interface JudgeInput {
  caseData: Case;
  index: CaseIndex;
  question: AnalyzedQuestion;
  candidates: Candidates;
  /** The deterministic rules decision for the same question. */
  rules: JudgeDecision;
  /** Fact ids the player already holds. */
  unlocked: ReadonlySet<string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Judge {
  readonly name: string;
  judge(input: JudgeInput): Promise<JudgeDecision>;
  /**
   * Optional: a tiny request that wakes the provider up (GameService calls it, throttled, when a
   * player starts a case — the intro gives it time to finish). Must never throw.
   */
  warm?(signal?: AbortSignal): Promise<Usage | undefined>;
}

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

export interface RulesVerdict {
  /** element id → matched by keyword groups */
  elements: Record<string, boolean>;
  /** wrong-claim id → affirmed by keyword groups */
  wrongClaims: Record<string, boolean>;
}

export interface VerdictJudgeInput {
  caseData: Case;
  /** Player's text as typed (≤ 600 chars). */
  text: string;
  normalized: string;
  rules: RulesVerdict;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface VerdictJudgeOutput {
  /** element id → probability (0..1) that the text expresses answerElement.judgeClaim */
  elements: Record<string, number>;
  /** wrong-claim id → probability (0..1) that the text asserts wrongClaim.judgeClaim */
  wrongClaims: Record<string, number>;
  usage: Usage;
  latencyMs: number;
  raw?: unknown;
}

export interface VerdictJudge {
  readonly name: string;
  judge(input: VerdictJudgeInput): Promise<VerdictJudgeOutput>;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export interface RenderInput {
  caseData: Case;
  /** The atomic question as typed. */
  question: string;
  answerClass: AnswerClass;
  /**
   * The ONLY facts the line may reference: facts the player already holds plus the ones
   * unlocked by this very answer. Everything else is secret.
   */
  allowedFacts: Fact[];
  /** Facts unlocked by this answer (subset of allowedFacts). */
  newlyUnlocked: Fact[];
  /** The canned line the pipeline would use (style reference + fallback). */
  cannedLine: string;
  mood: HolmaMood;
  nearCore: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RenderOutput {
  text: string;
  mood?: HolmaMood;
  usage: Usage;
  latencyMs: number;
  /** The exact prompt sent (for traces: TurnTrace.llmInput). */
  prompt?: string;
  model?: string;
  raw?: unknown;
}

export interface Renderer {
  readonly name: string;
  /** True when rendering is canned (no model call) — sets TurnTrace.fastPath. */
  readonly canned: boolean;
  render(input: RenderInput): Promise<RenderOutput>;
}

/* ------------------------------------------------------------------ */
/* Post-check                                                          */
/* ------------------------------------------------------------------ */

export interface PostCheckInput {
  caseData: Case;
  question: string;
  answerClass: AnswerClass;
  line: string;
  allowedFacts: Fact[];
  /** Case leak terms (normalised) — terms that must not appear before the solution. */
  leakTerms: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PostCheckOutput {
  pass: boolean;
  /** Machine-readable reasons, e.g. ['leak', 'polarity', 'new-fact', 'tone']. */
  reasons: string[];
  usage: Usage;
  latencyMs: number;
  raw?: unknown;
}

export interface PostChecker {
  readonly name: string;
  check(input: PostCheckInput): Promise<PostCheckOutput>;
}

/* ------------------------------------------------------------------ */
/* Assembled pipeline components                                       */
/* ------------------------------------------------------------------ */

export interface PipelineComponents {
  /** Configured mode (what the operator asked for). */
  mode: PipelineMode;
  /** Model judge; undefined → rules only. */
  judge?: Judge;
  /** Model renderer; undefined → canned lines only. */
  renderer?: Renderer;
  /** Post checker; used in 'jev+llm+check'. */
  postChecker?: PostChecker;
  verdictJudge?: VerdictJudge;
  /** Warnings produced while assembling (missing keys, stubs …). */
  warnings: string[];
}

export const ZERO_USAGE: Usage = Object.freeze({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
