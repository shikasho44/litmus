import { describe, expect, it } from 'vitest';
import { agreesWith, applyPolicy, withPolicy } from '../../server/engine/policy';
import { initialState, progressOf, shardWeights, snapshot } from '../../server/engine/state';
import type { JudgeDecision } from '../../server/engine/judge-types';
import { fixtureCase, fixtureIndex } from './helpers';

const c = fixtureCase();
const index = fixtureIndex();
const s0 = initialState(c, 0);
const d = (x: Partial<JudgeDecision>): JudgeDecision => ({ answerClass: 'yes', factIds: [], confidence: 0.9, closeness: 0, qtype: 'yesno', source: 'probe', ...x });

describe('policy', () => {
  it('unlocks a plain fact and its science memo', () => {
    const r = applyPolicy(c, index, d({ factIds: ['F06'], factStrength: { F06: 0.9 } }), s0);
    expect(r.unlock).toEqual(['F06']);
    expect(r.memos).toEqual(['M01']);
  });

  it('never turns a spoilerLevel-4 fact into a card, but sets nearCore', () => {
    const r = applyPolicy(c, index, d({ factIds: ['F15'], confidence: 1, closeness: 3 }), s0);
    expect(r.unlock).toEqual([]);
    expect(r.touchedCore).toBe(true);
    expect(r.nearCore).toBe(true);
    expect(r.nearCoreNew).toBe(true);
    expect(r.blocked).toContainEqual({ id: 'F15', reason: 'level4' });
    const no = applyPolicy(c, index, d({ answerClass: 'no', factIds: ['F15'] }), s0);
    expect(no.touchedCore).toBe(true);
  });

  it('nearCore needs the core CONFIRMED (fact polarity) or closeness 3 on an affirming answer', () => {
    // F15 (level 4, ifAsked yes): 'yes' confirms it
    const yes = applyPolicy(c, index, d({ factIds: ['F15'], closeness: 0 }), s0);
    expect(yes.coreConfirmed).toBe(true);
    expect(yes.nearCoreHit).toBe(true);
    expect(yes.nearCore).toBe(true);
    // a wrong guess the judge tagged with the cause-of-death fact: touched, not confirmed, not near
    const wrongGuess = applyPolicy(c, index, d({ answerClass: 'no', factIds: ['F15'], closeness: 3 }), s0);
    expect(wrongGuess.touchedCore).toBe(true);
    expect(wrongGuess.coreConfirmed).toBe(false);
    expect(wrongGuess.nearCoreHit).toBe(false);
    expect(wrongGuess.nearCore).toBe(false);
    expect(wrongGuess.nearCoreNew).toBe(false);
    // the same 'no' to a NEGATED question (「一酸化炭素ではないですよね？」→ いいえ) confirms it
    const negated = applyPolicy(c, index, d({ answerClass: 'no', factIds: ['F15'] }), s0, { negated: true });
    expect(negated.coreConfirmed).toBe(true);
    expect(negated.nearCoreHit).toBe(true);
    // closeness 3 alone: only on yes / partial (a model's "about the cause" is not "right about it")
    expect(applyPolicy(c, index, d({ answerClass: 'partial', closeness: 3 }), s0).nearCoreHit).toBe(true);
    expect(applyPolicy(c, index, d({ answerClass: 'no', closeness: 3 }), s0).nearCoreHit).toBe(false);
    expect(applyPolicy(c, index, d({ answerClass: 'irrelevant', closeness: 3 }), s0).nearCoreHit).toBe(false);
    expect(applyPolicy(c, index, d({ answerClass: 'yes', closeness: 2 }), s0).nearCoreHit).toBe(false);
    // sticky state: once on, later answers keep the state flag but are not hits themselves
    const s1 = withPolicy(s0, yes);
    const later = applyPolicy(c, index, d({ factIds: ['F04'] }), s1);
    expect(later.nearCore).toBe(true);
    expect(later.nearCoreHit).toBe(false);
    expect(later.nearCoreNew).toBe(false);
    // the same level-4 fact confirmed again: still confirmed, but not a new nearCore moment
    expect(s1.coreSeen).toEqual(['F15']);
    const again = applyPolicy(c, index, d({ factIds: ['F15'], closeness: 3 }), s1);
    expect(again.coreConfirmed).toBe(true);
    expect(again.coreNew).toEqual([]);
    expect(again.nearCoreHit).toBe(false);
    // closeness 3 after the state flag is on is not a new moment either
    expect(applyPolicy(c, index, d({ closeness: 3 }), s1).nearCoreHit).toBe(false);
  });

  it('agreesWith: fact polarity, negation flip, partial ~ yes', () => {
    expect(agreesWith('yes', 'yes')).toBe(true);
    expect(agreesWith('partial', 'yes')).toBe(true);
    expect(agreesWith('no', 'no')).toBe(true);
    expect(agreesWith('no', 'yes')).toBe(false);
    expect(agreesWith('yes', 'no')).toBe(false);
    expect(agreesWith('yes', 'no', true)).toBe(true);
    expect(agreesWith('no', 'yes', true)).toBe(true);
    expect(agreesWith('irrelevant', 'yes')).toBe(false);
  });

  it('respects requires', () => {
    const blocked = applyPolicy(c, index, d({ factIds: ['F07'] }), s0);
    expect(blocked.unlock).toEqual([]);
    expect(blocked.blocked[0].reason).toBe('requires:F06');
    const s1 = withPolicy(s0, applyPolicy(c, index, d({ factIds: ['F06'] }), s0));
    expect(applyPolicy(c, index, d({ factIds: ['F07'] }), s1).unlock).toEqual(['F07']);
  });

  it('needs strength for spoilerLevel 3 and confidence for level 2', () => {
    expect(applyPolicy(c, index, d({ factIds: ['F10'], confidence: 0.8, factStrength: { F10: 0.65 } }), s0).unlock).toEqual([]);
    expect(applyPolicy(c, index, d({ factIds: ['F10'], confidence: 0.8, factStrength: { F10: 0.9 } }), s0).unlock).toEqual(['F10']);
    expect(applyPolicy(c, index, d({ factIds: ['F14'], confidence: 0.55 }), s0).unlock).toEqual([]);
    expect(applyPolicy(c, index, d({ factIds: ['F14'], confidence: 0.65 }), s0).unlock).toEqual(['F14']);
  });

  it('never unlocks on irrelevant / cannot / vague or low confidence', () => {
    for (const a of ['irrelevant', 'cannot', 'vague'] as const) {
      expect(applyPolicy(c, index, d({ answerClass: a, factIds: ['F04'] }), s0).unlock).toEqual([]);
    }
    expect(applyPolicy(c, index, d({ factIds: ['F04'], confidence: 0.3 }), s0).unlock).toEqual([]);
  });

  it('caps new cards per answer and ignores unknown ids', () => {
    const r = applyPolicy(c, index, d({ factIds: ['F04', 'F05', 'F08', 'F99'] }), s0);
    expect(r.unlock).toEqual(['F04', 'F05']);
    expect(r.blocked.map((b) => b.reason)).toEqual(expect.arrayContaining(['per-answer-limit', 'unknown-fact']));
  });
});

describe('progress', () => {
  it('weights shards by importance and never counts level-4 facts', () => {
    const w = shardWeights(c);
    expect(w.F06).toBe(3);
    expect(w.F04).toBe(2);
    expect(w.F12).toBeUndefined(); // importance 0
    expect(w.F15).toBeUndefined(); // level 4
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    expect(progressOf(c, ['F06'])).toBeCloseTo(3 / total, 3);
    expect(progressOf(c, Object.keys(w))).toBe(1);
  });

  it('snapshot reflects state and starts with visibleFromStart facts', () => {
    expect(s0.unlocked).toEqual(['F01']);
    const snap = snapshot(c, { ...s0, solved: true });
    expect(snap.progress).toBe(1);
    expect(snap.unlocked).toEqual(['F01']);
  });
});
