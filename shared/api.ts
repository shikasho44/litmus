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
  portrait: string;       // shown only through the shard mask until solved (case-schema victim.shardPortrait when the case sets one)
  /** Shard mask until solved: 'bust' (default) · 'none' · an SVG path in the 300×400 box (case-schema victim.silhouette). */
  silhouette?: string;
  contentWarning?: string;
  /** Exact question budgets per play difficulty when the case overrides the default (shared/budget.ts). */
  questionBudget?: Partial<Record<Difficulty, number>>;
  /** PROTOTYPE I-005: 矛盾の一文 (case-schema intro.hook). Shown only with `?proto=i005`. */
  hook?: string;
  /**
   * A prototype case's switch (case-schema `proto`, shared/proto.ts): the case is listed only to a
   * caller with that switch on. The UI marks it 「試作」 and keeps it out of online versus.
   */
  proto?: string;
  /** The 事件ファイル shelf (shared/shelf.ts caseShelf: case-schema `shelf`, or the default from `proto`). */
  shelf?: 'kurare' | 'original' | 'lab';
  /** case-schema reviewStatus: the くられ先生監修 shelf says 監修中 until 'human-reviewed'. */
  reviewStatus?: 'draft-ai' | 'ai-reviewed' | 'human-reviewed';
}

export interface PublicFact {
  id: string;
  text: string;
  category: FactCategory;
  importance: number;     // UI uses ≥2 to decide "所見カード" treatment
  cardTitle?: string;
  icon?: string;
  /** PROTOTYPE I-005: the case's サイエンスヒント (case-schema fact.scienceHint). Marked only with `?proto=i005`. */
  science?: true;
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
  /** Case-authored free nudges (Holma's 「ひとりごと」, shared/budget.ts). Absent = fall back to holmaLines.idle / starters. */
  nudges?: string[];
  /**
   * The 「質問の例」 card pool (2026-09-29, src/features/examples): the starter questions (starter:
   * true) and then the case's extra examples. `facts` = the finding ids the question is about (ids
   * only, from its probe), so a card whose findings the player already holds is never dealt.
   * Absent (an older server) = the starters alone.
   */
  examples?: ExampleQuestion[];
}

export interface ExampleQuestion {
  q: string;
  starter?: boolean;
  facts?: string[];
}

/* ------------------------------------------------------------------ */
/* Progress token                                                      */
/* ------------------------------------------------------------------ */

/** Opaque to the browser. Signed by the server (HMAC). */
export type ProgressToken = string;

export interface ProgressSnapshot {
  unlocked: string[];          // fact ids
  memos: string[];             // science memo ids
  asked: number;               // question count (every answered part except empty / over-long input)
  /**
   * Questions counted against the question budget (shared/budget.ts: parts answered yes / no /
   * partial / irrelevant that are not small talk). ≤ asked. Optional: saves from before
   * 2026-09-28 lack it → read it as `asked`.
   */
  spent?: number;
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

export interface AskRequest {
  caseId: string;
  question: string;
  token?: ProgressToken;
  /**
   * The hard question budget the client plays under (教授). The server then answers only as many
   * counted parts as are left under it (later parts of a multi-question message are dropped) and
   * refuses once it is used up. A room-bound versus run uses its room's budget whatever is sent.
   */
  limit?: number;
}

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
  /** This part did not count against the question budget (「具体的に」, small talk, hint requests…). */
  free?: boolean;
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
/**
 * Difficulty (chosen by the player per case, stored in the browser save):
 *   easy = 見習い TRAINEE (choice verdict, 10 lives, game over → restart from the inquest)
 *   normal = 審問官 CORONER (cloze verdict, 3 lives, game over → restart the case)
 *   hard = 教授 PROFESSOR (free-text verdict, 3 lives, game over → restart the case)
 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export type VerdictMode = 'choice' | 'cloze' | 'free';
export const VERDICT_MODE_BY_DIFFICULTY: Record<Difficulty, VerdictMode> = { easy: 'choice', normal: 'cloze', hard: 'free' };
export const LIVES_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 10, normal: 3, hard: 3 };

export interface VerdictRequest {
  caseId: string; token: ProgressToken;
  /** Defaults to 'free'. */
  mode?: VerdictMode;
  /** free */
  text?: string;
  /** choice: the picked option id */
  choice?: string;
  /** cloze: blank id → index into that blank's options (as displayed) */
  blanks?: Record<string, number>;
}

/** What the verdict screen needs for the chosen mode, with the debate assists already applied. */
export interface VerdictSetupRequest { caseId: string; token: ProgressToken; mode: VerdictMode }
export interface VerdictSetupResponse {
  mode: VerdictMode;
  /** choice: options in display order; removed = struck out by a debate assist */
  choice?: { prompt: string; options: { id: string; text: string; removed: boolean }[] };
  /** cloze: template with {{id}} blanks; filled = option index pre-filled by a debate assist */
  cloze?: { prompt: string; template: string; blanks: { id: string; label: string; options: string[]; filled?: number }[] };
  /** free: element labels (for the checklist) and ids revealed by assists */
  free?: { labels: Record<string, string>; revealed: string[] };
  /** How many assists the cleared debate rounds earned (for the UI) */
  assistsEarned: number;
  assistsTotal: number;
  /** false when the case has no verdictModes yet → UI falls back to free text */
  available: boolean;
}
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
  /** PROTOTYPE I-005: how close the judged verdict came (server/engine/closeness.ts). Absent on a support reply / re-declaration. */
  closeness?: VerdictCloseness;
  token: ProgressToken;
  progress: ProgressSnapshot;
  trace?: TurnTrace;
}

/**
 * PROTOTYPE I-005 (2026-10-03): the 近い・遠い of a verdict, drawn as the red-cabbage band with
 * `?proto=i005`. Derived only from what the judge already decided (server/engine/closeness.ts):
 *   far      not accepted, under half of what the format measures, or it states a known false story
 *   near     not accepted, at least half of it and no false story
 *   correct  accepted
 *   perfect  accepted with everything the format can express (free text: the optional elements too;
 *            cloze: every blank — the full truth sentence). A picked option can only be correct.
 * `ratio` (0..1): the share that matched — required answer elements (free text, and the picked
 * option's text for a wrong choice) or blanks (cloze). It never names what is missing.
 */
export interface VerdictCloseness {
  level: 'far' | 'near' | 'correct' | 'perfect';
  ratio: number;
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
  victim: {
    codename: string;
    name: string;
    nameKana: string;
    age: number;
    occupation: string;
    portrait: string;
    farewell: string[];
    /** Rows under the restored name instead of 年齢／職業 (object souls). */
    profile?: { label: string; value: string }[];
  };
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
  verdictSetup(req: VerdictSetupRequest): Promise<VerdictSetupResponse>;
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
