/**
 * API contract between the browser and the game server.
 *
 * The browser never holds secret case data. Every judgement (questions, hints, debate
 * shots, verdict, reconstruction) happens server-side and is recorded in a signed
 * progress token that the browser stores and sends back. The same `GameApi` interface
 * is implemented twice:
 *   - src/api/http.ts      → fetch('/api/...')          (dev server, Vercel)
 *   - src/api/embedded.ts  → calls server/engine directly (static build, QA)
 */
import type { AnswerClass, FactCategory } from './case-schema';

/* ------------------------------------------------------------------ */
/* Public views                                                        */
/* ------------------------------------------------------------------ */

export interface CaseSummary {
  id: string;
  number: number;
  title: string;
  titleEn: string;
  difficulty: number;
  categories: string[];
  estimatedMinutes: number;
  summary: string;
  codename: string;
  background: string;
  accent: string;
  portrait: string;       // shown only through the shard mask until solved
  contentWarning?: string;
}

export interface PublicFact {
  id: string;
  text: string;
  category: FactCategory;
  importance: number;     // UI uses ≥2 to decide "所見カード" treatment
  cardTitle?: string;
  icon?: string;
}

export interface ScienceMemoView { id: string; title: string; text: string }

export interface CasePublic extends CaseSummary {
  location: string;
  time: string;
  narration: string[];
  janeIntro: string[];
  holmaIntro: string[];
  starterQuestions: string[];
  startingFacts: PublicFact[];
  totalFacts: number;          // for the progress display
  shardWeights: Record<string, number>; // fact id → shard count (only ids, no text)
  hintCount: number;
  /** Case-specific Holma flavour lines the investigation UI may use (idle nudges, nearCore detection). No case facts. */
  holmaLines?: { idle: string[]; nearCore: string[] };
}

/* ------------------------------------------------------------------ */
/* Progress token                                                      */
/* ------------------------------------------------------------------ */

/** Opaque to the browser. Signed by the server (HMAC). */
export type ProgressToken = string;

export interface ProgressSnapshot {
  unlocked: string[];          // fact ids
  memos: string[];             // science memo ids
  asked: number;               // question count
  hintsUsed: number;
  debateCleared: string[];     // round ids
  debateMisses: number;
  verdictAttempts: number;
  solved: boolean;             // verdict accepted
  reconstructed: boolean;
  progress: number;            // 0..1, drives the Jane Doe shard portrait
  nearCore: boolean;
}

/* ------------------------------------------------------------------ */
/* Ask                                                                 */
/* ------------------------------------------------------------------ */

export interface AskRequest { caseId: string; question: string; token?: ProgressToken }

export type HolmaMood = 'normal' | 'laugh' | 'surprised' | 'serious';

export interface AskAnswer {
  /** The atomic sub-question this part answers (after splitting multi-questions). */
  question: string;
  answerClass: AnswerClass;
  /** Holma's spoken line (canned or model-phrased, always validated). */
  line: string;
  mood: HolmaMood;
  unlocked: PublicFact[];
  memos: ScienceMemoView[];
  /**
   * Optional notice the UI must surface next to this answer:
   *  - 'support'  the question touched self-harm / harming others. The line is a calm, serious
   *               refusal (not Holma joking). The UI shows a gentle support card with a link to
   *               the MHLW consultation portal (https://www.mhlw.go.jp/mamorouyokokoro/).
   *  - 'degraded' answered by the offline rules judge because the AI provider failed.
   */
  notice?: 'support' | 'degraded';
  /** True when this answer shows the player is circling the core truth (drives Holma's reaction). */
  nearCore?: boolean;
}

export interface AskResponse {
  answers: AskAnswer[];
  token: ProgressToken;
  progress: ProgressSnapshot;
  /** Dev/admin only. Omitted in production responses. */
  trace?: TurnTrace;
}

/* ------------------------------------------------------------------ */
/* Hints                                                               */
/* ------------------------------------------------------------------ */

export interface HintRequest { caseId: string; token: ProgressToken }
export interface HintResponse { level: number; text: string; token: ProgressToken; progress: ProgressSnapshot }

/* ------------------------------------------------------------------ */
/* Inquest                                                             */
/* ------------------------------------------------------------------ */

export interface InquestStatementView {
  id: string;
  speaker: 'jane' | 'holma';
  /** Segments: plain text and noise spans (targets). */
  segments: { text: string; noise: boolean }[];
}
export interface InquestRoundView {
  id: string;
  title: string;
  intro: string[];
  statements: InquestStatementView[];
}
export interface InquestStartRequest { caseId: string; token: ProgressToken }
export interface InquestStartResponse {
  rounds: InquestRoundView[];
  /** Evidence the player can fire: all unlocked facts with importance ≥ 1. */
  evidence: PublicFact[];
  token: ProgressToken;
  progress: ProgressSnapshot;
}

export interface ShotRequest {
  caseId: string; token: ProgressToken;
  roundId: string; statementId: string; span: string; factId: string;
}
export interface ShotResponse {
  correct: boolean;
  lines: string[];
  /** Who speaks `lines`: success lines are Jane's corrected memory, miss lines are Holma's tease. */
  speaker?: 'jane' | 'holma';
  /** After 2 misses on the same round the server attaches the round hint. */
  hint?: string;
  /** If the needed evidence was never unlocked, the server may grant it (rank penalty). */
  granted?: PublicFact;
  token: ProgressToken;
  progress: ProgressSnapshot;
}
export interface GrantRequest { caseId: string; token: ProgressToken; roundId: string }

export type VerdictResult = 'correct' | 'almost' | 'missing' | 'wrong';
export interface VerdictRequest { caseId: string; token: ProgressToken; text: string }
export interface VerdictResponse {
  result: VerdictResult;
  matched: string[];             // answer element ids matched
  labels: Record<string, string>;// element id → label (直接死因 …) for the checklist UI
  lines: string[];               // Holma feedback (never reveals the answer)
  /**
   * 'support': the text confided self-harm, so it was not judged or counted. `lines` holds the
   * calm serious line; the UI shows no stamp, only the support card (same as AskAnswer.notice).
   */
  notice?: 'support';
  token: ProgressToken;
  progress: ProgressSnapshot;
  trace?: TurnTrace;
}

export interface ReconstructionView {
  intro: string;
  panels: { id: string; image?: string; scene: string; caption: string; choice?: { prompt: string; options: string[] } }[];
}
export interface ReconstructionRequest { caseId: string; token: ProgressToken }
export interface ReconstructionSubmit { caseId: string; token: ProgressToken; picks: Record<string, number> }
export interface ReconstructionResult {
  correct: Record<string, boolean>;
  allCorrect: boolean;
  finale?: string[];
  token: ProgressToken;
  progress: ProgressSnapshot;
}

/* ------------------------------------------------------------------ */
/* Solution & science (only after solved)                              */
/* ------------------------------------------------------------------ */

export interface SolutionResponse {
  victim: { codename: string; name: string; nameKana: string; age: number; occupation: string; portrait: string; farewell: string[] };
  truth: { summary: string; causeOfDeath: string; mechanism: string; timeline: { time: string; event: string }[] };
  allFacts: (PublicFact & { unlocked: boolean })[];
  science: import('./case-schema').Case['science'];
  memos: ScienceMemoView[];
  quiz: import('./case-schema').Case['quiz'];
  sources: import('./case-schema').Case['sources'];
  holmaSolved: string[];
  /** Expert-review state of the science content (UI shows an "AI draft" badge unless human-reviewed). */
  reviewStatus?: 'draft-ai' | 'ai-reviewed' | 'human-reviewed';
}

/* ------------------------------------------------------------------ */
/* Tracing (dev/admin/bench)                                           */
/* ------------------------------------------------------------------ */

export type PipelineMode = 'rules' | 'jev' | 'jev+llm' | 'jev+llm+check' | 'llm';

export interface StageTiming { stage: string; ms: number }
export interface TurnTrace {
  mode: PipelineMode;
  normalized: string[];
  candidates: { id: string; score: number }[];
  probeMatch?: { q: string; score: number };
  judge?: unknown;              // provider-specific raw decision
  confidence?: number;
  fastPath: boolean;
  llmInput?: string;
  llmOutput?: string;
  postCheck?: { pass: boolean; detail: unknown };
  fallback?: string;
  timings: StageTiming[];
  tokens: { input: number; output: number };
  costUsd: number;
}

/* ------------------------------------------------------------------ */
/* Client interface                                                    */
/* ------------------------------------------------------------------ */

export interface GameApi {
  listCases(): Promise<CaseSummary[]>;
  getCase(caseId: string): Promise<CasePublic>;
  newToken(caseId: string): Promise<{ token: ProgressToken; progress: ProgressSnapshot }>;
  ask(req: AskRequest): Promise<AskResponse>;
  hint(req: HintRequest): Promise<HintResponse>;
  inquestStart(req: InquestStartRequest): Promise<InquestStartResponse>;
  shot(req: ShotRequest): Promise<ShotResponse>;
  grant(req: GrantRequest): Promise<ShotResponse>;
  verdict(req: VerdictRequest): Promise<VerdictResponse>;
  reconstruction(req: ReconstructionRequest): Promise<ReconstructionView>;
  submitReconstruction(req: ReconstructionSubmit): Promise<ReconstructionResult>;
  solution(req: { caseId: string; token: ProgressToken }): Promise<SolutionResponse>;
}

export class ApiError extends Error {
  constructor(public code: 'network' | 'timeout' | 'rate_limited' | 'bad_request' | 'bad_token' | 'server', message: string, public retryable = true) {
    super(message);
  }
}
