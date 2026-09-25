/**
 * Client-side save model. Everything the browser remembers between sessions lives in
 * ONE versioned JSON blob under APP_CONFIG.SAVE_KEY (see save.ts).
 *
 * The browser never stores secret case data: facts are only the ones the server already
 * revealed (PublicFact), and the authoritative progress is the signed server token.
 */
import type { AnswerClass } from '../../shared/case-schema';
import type {
  Difficulty,
  HolmaMood,
  PipelineMode,
  ProgressSnapshot,
  ProgressToken,
  PublicFact,
  ScienceMemoView,
  VerdictResult,
} from '../../shared/api';

export const SAVE_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
export type FontScale = 100 | 115 | 130;

export interface Settings {
  bgmVolume: number; // 0..1
  sfxVolume: number; // 0..1
  voiceBlips: boolean; // typewriter voice blips
  muted: boolean;
  textSpeed: TextSpeed;
  fontScale: FontScale;
  reduceMotion: boolean;
  /** Dev only (DEBUG): force a pipeline mode on the server. null = server default. */
  pipelineMode: PipelineMode | null;
}

/* ------------------------------------------------------------------ */
/* Per-case progress                                                   */
/* ------------------------------------------------------------------ */
export type CaseStage =
  | 'new'
  | 'intro'
  | 'investigation'
  | 'inquest'
  | 'resolution'
  | 'science'
  | 'quiz'
  | 'result'
  | 'complete';

/** S+ = S with every noise-break round cleared by the player's own shots (none skipped, no begging). */
export type Rank = 'S+' | 'S' | 'A' | 'B' | 'C';

export interface LogAnswer {
  question: string;
  answerClass: AnswerClass;
  line: string;
  mood: HolmaMood;
  unlocked: string[]; // fact ids unlocked by this answer
  memos: string[]; // science memo ids unlocked by this answer
  /** This answer confirmed a core hypothesis (AskAnswer.nearCore) → ★核心 in the question log. */
  nearCore?: boolean;
}

/**
 * Read-only copy of an attempt that was restarted because the server could not verify the
 * saved token. Shown in the notebook as 「前回の記録」; it grants nothing back.
 */
export interface PreviousAttempt {
  at: number;
  log: LogEntry[];
  facts: Record<string, PublicFact>;
  factOrder: string[];
  hints: { level: number; text: string }[];
}

export type LogEntry =
  | { id: string; at: number; kind: 'question'; text: string }
  | ({ id: string; at: number; kind: 'answer'; degraded?: boolean; notice?: 'support' | 'degraded' } & LogAnswer)
  | { id: string; at: number; kind: 'hint'; level: number; text: string }
  | { id: string; at: number; kind: 'system'; text: string; tone?: 'info' | 'warn' | 'error' };

export type InquestPhase = 'debate' | 'verdict' | 'reconstruction' | 'done';

export interface InquestState {
  phase: InquestPhase;
  roundIndex: number;
  /** 集中力 (bible §3-2): starts at 5, 0 = suspended. */
  composure: number;
  cleared: string[]; // round ids
  misses: number;
  grants: number; // 「ホルマに泣きつく」count
  verdictAttempts: number;
  /** notes: Holma's pointed feedback lines (「ホルマの指摘」); required: element ids the solve needs. */
  lastVerdict?: { result: VerdictResult; matched: string[]; labels: Record<string, string>; text: string; notes?: string[]; required?: string[] };
  verdictDraft?: string;
  reconstructionPicks?: Record<string, number>;
  reconstructionDone?: boolean;
  suspensions: number;
  /** Jane's lights (やり直し): LIVES_BY_DIFFICULTY at the start of the inquest; each non-correct verdict costs one. */
  lives?: number;
  /** The player skipped the rest of the noise break (「議論を飛ばして死因宣告へ」). */
  debateSkipped?: boolean;
  /** Number of noise-break rounds of the case (for S+). */
  rounds?: number;
  /** choice mode: the option picked last (restored on reload). */
  verdictChoice?: string;
  /** choice mode: options already declared and judged wrong (shown crossed out). */
  triedChoices?: string[];
  /** cloze mode: blank id → option index (as displayed). */
  verdictBlanks?: Record<string, number>;
}

export interface CaseResult {
  rank: Rank;
  title: string; // 称号
  at: number;
  elapsedMs: number;
  stats: Record<string, number>;
  /** The difficulty this run was played on (見習い / 審問官 / 教授). */
  playDifficulty?: Difficulty;
  /** Best rank of this case BEFORE this run (set by completeCase; lets the result screen show the change). */
  prevBest?: Rank;
}

/** The victim's restored identity, remembered once the identity ceremony has played (shown on the Files tag after completion). */
export interface RestoredIdentity {
  name: string;
  kana: string;
}

export interface CaseProgress {
  caseId: string;
  stage: CaseStage;
  /** Difficulty chosen when the run started (default 'normal'). Changeable until the inquest opens. */
  difficulty?: Difficulty;
  /** Game overs in this case (all runs). */
  gameOvers?: number;
  startedAt: number;
  updatedAt: number;
  /** Active play time (ms). Advanced by useCaseTimer while the case scene is visible. */
  elapsedMs: number;
  token?: ProgressToken;
  snapshot?: ProgressSnapshot;
  log: LogEntry[];
  /** Unlocked facts, keyed by id, plus unlock order. */
  facts: Record<string, PublicFact>;
  factOrder: string[];
  /** Facts the player has looked at (drives the NEW badge). */
  seenFacts: string[];
  memos: Record<string, ScienceMemoView>;
  hints: { level: number; text: string }[];
  /** Player's own free-text notes (optional feature). */
  notes: string;
  inquest?: InquestState;
  quiz?: { answers: Record<string, number>; correct: string[] };
  /** The identity ceremony (Resolution) has played once this run → a reload shows the record page. */
  resolutionSeen?: boolean;
  /** Backup of the attempt before a bad-token restart (see caseData.restartCaseAfterBadToken). */
  previousAttempt?: PreviousAttempt;
  /** Restored victim name (kept across replays, like bestRank). Only shown after the case was completed. */
  restored?: RestoredIdentity;
  completed: boolean;
  clears: number;
  bestRank?: Rank;
  lastResult?: CaseResult;
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
/**
 * The coach-mark tutorial. 'off' = not started yet (starts on the first play of CASE 01),
 * 'on' = running at `step`, 'done' = finished or skipped. `anyCase`: replayed from the menu,
 * so it runs in whichever case is played next.
 */
export interface TutorialState {
  state: 'off' | 'on' | 'done';
  step: number;
  anyCase?: boolean;
}

export interface SaveMeta {
  prologueSeen: boolean;
  tutorial?: TutorialState;
  firstLaunchAt: number;
  lastCaseId?: string;
  launches: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  settings: Settings;
  meta: SaveMeta;
  cases: Record<string, CaseProgress>;
}

export type CaseStatus = 'new' | 'active' | 'solved' | 'complete';
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  new: '未着手',
  active: '捜査中',
  solved: '解決済',
  complete: 'CASE COMPLETE',
};
