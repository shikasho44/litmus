/**
 * Code rules: what a judged answer is allowed to unlock. Judges (rules or models)
 * only report which facts a question is about and how sure they are; this module alone
 * decides what becomes a 所見 card.
 *
 *   - answer must be yes / no / partial ('irrelevant' / 'cannot' / 'vague' never unlock)
 *   - confidence ≥ 0.5 (≥ 0.6 for spoilerLevel 2)
 *   - spoilerLevel 3 needs confidence ≥ 0.75 AND per-fact strength ≥ 0.7
 *   - spoilerLevel 4 NEVER becomes a card during investigation; a yes/no about it is
 *     allowed (confirming a correct guess is the game) and sets nearCore
 *   - every id in `requires` must already be unlocked
 *   - at most 2 new cards per answer
 *   - science memos unlock with their fact
 */
import type { Case } from '../../shared/case-schema.js';
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
  nearCore: boolean;
  nearCoreNew: boolean;
  blocked: { id: string; reason: string }[];
}

export function applyPolicy(c: Case, index: CaseIndex, decision: JudgeDecision, state: GameState): PolicyResult {
  const blocked: PolicyResult['blocked'] = [];
  const unlock: string[] = [];
  let touchedCore = false;
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
    if (f.spoilerLevel >= 4) {
      touchedCore = true;
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
  const nearCore = state.nearCore || touchedCore || (answerable && decision.closeness >= 3) || progressAfter >= POLICY.nearCoreProgress;
  return { unlock, memos, touchedCore, nearCore, nearCoreNew: nearCore && !state.nearCore, blocked };
}

/** Immutable state update after an answer. */
export function withPolicy(state: GameState, r: PolicyResult): GameState {
  return {
    ...state,
    unlocked: [...state.unlocked, ...r.unlock],
    memos: [...state.memos, ...r.memos],
    nearCore: r.nearCore,
  };
}
