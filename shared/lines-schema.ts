/**
 * Contract for Holma's canned line bank (content/holma-lines.json) and scripted scenes
 * (content/prologue.json). Canned lines are the FAST PATH: pre-written, in character,
 * and never contain case facts, so they can never leak or hallucinate.
 */
import { z } from 'zod';

export const MOODS = ['normal', 'laugh', 'surprised', 'serious'] as const;
export type Mood = (typeof MOODS)[number];

/** A line is either plain text or text with an explicit sprite mood. */
export const LineSchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), mood: z.enum(MOODS) }),
]);
export type Line = z.infer<typeof LineSchema>;
const bank = (min: number) => z.array(LineSchema).min(min);

export const HolmaLinesSchema = z.object({
  /** Replies per answer class. Must not mention any case-specific fact. */
  answer: z.object({
    yes: bank(14),
    no: bank(14),
    partial: bank(8),
    irrelevant: bank(10),
    cannot: bank(8),
    vague: bank(8),
  }),
  /** Said when the answer unlocks a 所見 (importance 1–2) / a core 所見 (importance ≥3). */
  unlock: bank(8),
  unlockCore: bank(6),
  /** The player is circling the truth (closeness high). */
  nearCore: bank(6),
  /** Prefix when a message contained several questions. */
  multi: bank(4),
  meta: z.object({
    askAnswer: bank(5),       // 「答えを教えて」
    askHint: bank(3),         // asks for a hint in chat → point to the hint button
    offtopic: bank(8),        // small talk unrelated to the case
    aboutHolma: bank(6),      // questions about Holma himself
    rude: bank(4),            // insults / abuse → stay in character, de-escalate
    empty: bank(3),           // empty / nonsense input
    tooLong: bank(2),
    culprit: bank(5),         // 「犯人は誰？」「編集者が混ぜた？」 in a case that seals the culprit (culprit.ts)
  }),
  error: z.object({
    network: bank(3),         // request failed; player should retry
    degraded: bank(3),        // answered with the offline judge
    rateLimited: bank(2),
  }),
  investigation: z.object({
    idle: bank(6),
    hintIntro: bank(3),
    inquestConfirmLow: bank(3), // few findings yet
    inquestConfirm: bank(3),
  }),
  inquest: z.object({
    open: bank(3),
    roundStart: bank(3),
    wrongShot: bank(6),
    grant: bank(3),           // player begs for evidence
    composureLow: bank(3),
    suspended: bank(3),       // composure 0 → back to investigation
    verdictPrompt: bank(2),
    verdictCorrect: bank(3),
    verdictAlmost: bank(3),
    verdictMissing: bank(3),
    verdictWrong: bank(4),
    reconstructionIntro: bank(2),
    reconstructionWrong: bank(3),
    reconstructionDone: bank(2),
  }),
  resolution: z.object({ identity: bank(2), farewell: bank(3) }),
  science: z.object({ intro: bank(2), outro: bank(2) }),
  quiz: z.object({ correct: bank(4), wrong: bank(4), complete: bank(3) }),
  title: z.object({ idle: bank(5) }),
});
export type HolmaLines = z.infer<typeof HolmaLinesSchema>;

export const SCRIPT_FX = ['shake', 'flash', 'stamp-yes', 'stamp-no', 'stamp-irrelevant', 'cutin', 'glitch', 'gavel', 'heartbeat'] as const;

export const ScriptLineSchema = z.object({
  speaker: z.enum(['holma', 'jane', 'narration', 'system']),
  mood: z.enum(MOODS).optional(),
  text: z.string().min(1),
  fx: z.enum(SCRIPT_FX).optional(),
  /** Optional BGM switch at this line. */
  bgm: z.enum(['title', 'investigation', 'inquest', 'truth', 'science', 'none']).optional(),
});
export type ScriptLine = z.infer<typeof ScriptLineSchema>;

export const ScriptSchema = z.object({
  id: z.string(),
  background: z.string(),     // public path
  lines: z.array(ScriptLineSchema).min(8),
});
export type Script = z.infer<typeof ScriptSchema>;
