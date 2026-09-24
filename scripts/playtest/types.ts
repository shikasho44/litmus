/**
 * Records written by the AI playtest (scripts/playtest.ts). Plain data — the JSON log in
 * bench/reports/playtest/ has exactly this shape.
 */
import type { AnswerClass } from '../../shared/case-schema.js';
import type { VerdictResult } from '../../shared/api.js';

export type PersonaId = 'beginner' | 'science' | 'clumsy' | 'sharp' | 'adversarial';

/** One answered part of a question (a message may be split into up to 3 parts). */
export interface AskPart {
  /** 1-based question turn (one player message). */
  turn: number;
  /** The whole message the player typed. */
  message: string;
  /** The atomic part the engine answered. */
  question: string;
  answer: AnswerClass;
  line: string;
  unlocked: { id: string; title: string; level: number }[];
  notice?: 'support' | 'degraded';
  nearCore?: boolean;
  /** Engine trace bits (never shown to the player model). */
  source?: string;
  factIds?: string[];
  closeness?: number;
  latencyMs: number;
  costUsd: number;
}

export interface HintEvent { turn: number; level: number; text: string }

export interface ShotEvent {
  round: string;
  statement: string;
  span: string;
  fact: string;
  correct: boolean;
  lines: string[];
  speaker?: 'jane' | 'holma';
  hint?: string;
  granted?: string;
  kind: 'shot' | 'grant' | 'invalid';
  error?: string;
}

export interface VerdictEvent {
  /** Questions asked when this verdict was submitted. */
  asked: number;
  text: string;
  result: VerdictResult;
  matched: string[];
  lines: string[];
  notice?: string;
}

export interface StuckStreak { from: number; to: number; length: number; questions: string[]; answers: AnswerClass[] }

export interface Contradiction {
  kind: 'same-question' | 'similar-question' | 'same-probe';
  caseId: string;
  /** Shared key: normalised core form, or the authored probe text. */
  key: string;
  items: { run: string; turn: number; question: string; answer: AnswerClass; effective: AnswerClass; line: string }[];
}

export interface LabelDisagreement {
  run: string;
  turn: number;
  question: string;
  answer: AnswerClass;
  probe: string;
  probeScore: number;
  expected: AnswerClass;
  flipped: boolean;
}

export interface LeakHit {
  run: string;
  where: 'answer' | 'hint' | 'verdict' | 'debate' | 'card';
  turn: number;
  text: string;
  terms: string[];
}

export interface RunLog {
  id: string;
  caseId: string;
  persona: PersonaId;
  personaLabel: string;
  model: string;
  startedAt: string;
  seconds: number;
  asks: AskPart[];
  /** Player messages that were not sent (invalid output, repeats) and why. */
  playerIssues: { turn: number; issue: string; raw?: string }[];
  thoughts: { turn: number; phase: string; think: string }[];
  hints: HintEvent[];
  inquestOpenedAt: number[];
  shots: ShotEvent[];
  verdicts: VerdictEvent[];
  outcome: 'solved' | 'failed' | 'budget' | 'error' | 'cap';
  error?: string;
  final: { asked: number; hintsUsed: number; unlocked: number; totalFacts: number; progress: number; nearCore: boolean; solved: boolean; debateCleared: string[]; debateMisses: number };
  spend: { jevUsd: number; llmUsd: number; jevCalls: number; llmCalls: number };
}

export interface RunMetrics {
  id: string;
  caseId: string;
  persona: PersonaId;
  questions: number;
  questionsToVerdict: number | null;
  hintsUsed: number;
  unlocked: number;
  totalFacts: number;
  stuck: StuckStreak[];
  contradictions: number;
  leaks: LeakHit[];
  level4Shown: string[];
  safetyNotices: number;
  degraded: number;
  debateMisses: number;
  grants: number;
  verdictAttempts: number;
  verdict: VerdictResult | 'none';
  outcome: RunLog['outcome'];
  answerMix: Record<AnswerClass, number>;
  costUsd: number;
}
