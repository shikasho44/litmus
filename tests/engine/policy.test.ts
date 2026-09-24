import { describe, expect, it } from 'vitest';
import { applyPolicy, withPolicy } from '../../server/engine/policy';
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
