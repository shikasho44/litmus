/**
 * Code rules: what a judged answer is allowed to unlock. Judges (rules or models)
 * only report which facts a question is about and how sure they are; this module alone
 * decides what becomes a 所見 card.
 *
 *   - answer must be yes / no / partial ('irrelevant' / 'cannot' / 'vague' never unlock)
 *   - confidence ≥ 0.5 (≥ 0.6 for spoilerLevel 2)
 *   - spoilerLevel 3 needs confidence ≥ 0.75 AND per-fact strength ≥ 0.7
 *   - spoilerLevel 4 NEVER becomes a card during investigation; a yes/no about it is
 *     allowed (confirming a correct guess is the game) and sets nearCore when the answer
 *     CONFIRMS it (the answer agrees with the fact's polarity, see coreConfirmed)
 *   - nearCore (per answer): a spoilerLevel-4 topic confirmed for the FIRST time (state.coreSeen),
 *     or — before the state flag is on — the judge's closeness is 3 on an affirming answer (yes /
 *     partial, or no to a negated question). A plain "no" to a wrong cause-of-death guess is NOT
 *     near the core, whatever closeness the judge reports. Repeats are not new moments: in the
 *     2026-09-25 AI playtest Jev rated closeness 3 on up to 25 of 40 on-topic questions, which
 *     would have made Holma say 「近い」 almost every turn.
 *   - the manner fact (fact.manner) never becomes a card from an answer (sealed, manner.ts)
 *   - every id in `requires` must already be unlocked
 *   - at most 2 new cards per answer
 *   - science memos unlock with their fact
 */
import type { AnswerClass, Case } from '../../shared/case-schema.js';
import type { CaseIndex } from './case-index.js';
import type { JudgeDecision } from './judge-types.js';
import type { GameState } from './state.js';
import { memoIdForFact, progressOf } from './state.js';

export const POLICY = {
  minConfidence: 0.5,
  level2Confidence: 0.6,
  level3Confidence: 0.75,
  level3Strength: 0.7,
  maxUnlockPerAnswer: 2,
  /** progress at which nearCore switches on regardless of closeness */
  nearCoreProgress: 0.75,
} as const;

export interface PolicyResult {
  unlock: string[];
  memos: string[];
  /** A spoilerLevel-4 topic was answered yes/no/partial. */
  touchedCore: boolean;
  /** A spoilerLevel-4 topic was answered in agreement with the fact (the guess is right). */
  coreConfirmed: boolean;
  /** The spoilerLevel-4 facts confirmed by this answer that the player had not confirmed before. */
  coreNew: string[];
  /** THIS answer shows the player circling the core truth (AskAnswer.nearCore). */
  nearCoreHit: boolean;
  /** State-level nearCore after this answer (sticky). */
  nearCore: boolean;
  /** nearCore switched on with this answer. */
  nearCoreNew: boolean;
  blocked: { id: string; reason: string }[];
}

export interface PolicyOptions {
  /** The question was a negated confirmation (「〜ではないですよね？」). */
  negated?: boolean;
}

const flip = (a: AnswerClass): AnswerClass => (a === 'yes' ? 'no' : a === 'no' ? 'yes' : a);

/**
 * Does `answer` agree with what the fact says? `fact.ifAsked` is the answer to an affirmative
 * question about the fact's topic (flipped for a negated question); partial ≈ yes here.
 */
export function agreesWith(answer: AnswerClass, ifAsked: AnswerClass, negated = false): boolean {
  const e = negated ? flip(ifAsked) : ifAsked;
  if (answer === e) return true;
  const yesish = (a: AnswerClass) => a === 'yes' || a === 'partial';
  return yesish(answer) && yesish(e);
}

export function applyPolicy(c: Case, index: CaseIndex, decision: JudgeDecision, state: GameState, opts: PolicyOptions = {}): PolicyResult {
  const blocked: PolicyResult['blocked'] = [];
  const unlock: string[] = [];
  let touchedCore = false;
  let coreConfirmed = false;
  const coreNew: string[] = [];
  const seen = new Set(state.coreSeen ?? []);
  const have = new Set(state.unlocked);
  const answerable = decision.answerClass === 'yes' || decision.answerClass === 'no' || decision.answerClass === 'partial';

  for (const id of decision.factIds) {
    const entry = index.factById.get(id);
    if (!entry) {
      blocked.push({ id, reason: 'unknown-fact' });
      continue;
    }
    const f = entry.fact;
    if (!answerable) {
      blocked.push({ id, reason: `answer-${decision.answerClass}` });
      continue;
    }
    // The manner fact is sealed during the investigation (manner.ts): a model judge naming it
    // unlocks nothing. Only the planned スペシャルヒント reveals it (mannerReveal).
    if (f.manner) {
      blocked.push({ id, reason: 'manner' });
      continue;
    }
    if (f.spoilerLevel >= 4) {
      touchedCore = true;
      if (agreesWith(decision.answerClass, f.ifAsked, !!opts.negated)) {
        coreConfirmed = true;
        if (!seen.has(id) && !coreNew.includes(id)) coreNew.push(id);
      }
      blocked.push({ id, reason: 'level4' });
      continue;
    }
    if (have.has(id)) continue;
    const strength = decision.factStrength?.[id] ?? decision.confidence;
    if (decision.confidence < POLICY.minConfidence) {
      blocked.push({ id, reason: 'confidence' });
      continue;
    }
    if (f.spoilerLevel === 2 && (decision.confidence < POLICY.level2Confidence || decision.source === 'fallback')) {
      blocked.push({ id, reason: 'level2' });
      continue;
    }
    if (f.spoilerLevel === 3 && (decision.confidence < POLICY.level3Confidence || strength < POLICY.level3Strength)) {
      blocked.push({ id, reason: 'level3' });
      continue;
    }
    const missing = f.requires.filter((r) => !have.has(r));
    if (missing.length > 0) {
      blocked.push({ id, reason: `requires:${missing.join(',')}` });
      continue;
    }
    if (unlock.length >= POLICY.maxUnlockPerAnswer) {
      blocked.push({ id, reason: 'per-answer-limit' });
      continue;
    }
    unlock.push(id);
    have.add(id);
  }

  const memoSet = new Set(state.memos);
  const memos: string[] = [];
  for (const id of unlock) {
    const m = memoIdForFact(c, id);
    if (m && !memoSet.has(m)) {
      memoSet.add(m);
      memos.push(m);
    }
  }

  const progressAfter = progressOf(c, have);
  const affirming = decision.answerClass === 'yes' || decision.answerClass === 'partial' || (decision.answerClass === 'no' && !!opts.negated);
  const closeAffirmed = affirming && decision.closeness >= 3;
  const nearCore = state.nearCore || coreConfirmed || closeAffirmed || progressAfter >= POLICY.nearCoreProgress;
  const nearCoreHit = coreNew.length > 0 || (closeAffirmed && !state.nearCore);
  return { unlock, memos, touchedCore, coreConfirmed, coreNew, nearCoreHit, nearCore, nearCoreNew: nearCore && !state.nearCore, blocked };
}

/** Immutable state update after an answer. */
export function withPolicy(state: GameState, r: PolicyResult): GameState {
  return {
    ...state,
    unlocked: [...state.unlocked, ...r.unlock],
    memos: [...state.memos, ...r.memos],
    nearCore: r.nearCore,
    coreSeen: r.coreNew.length > 0 ? [...(state.coreSeen ?? []), ...r.coreNew] : state.coreSeen ?? [],
  };
}
