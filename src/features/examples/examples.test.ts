import { describe, expect, it } from 'vitest';
import type { ExampleQuestion } from '../../../shared/api';
import { advanceExamples, dealsAt, EXAMPLE_TUNING, exampleOrder, examplePool, nextDealAt, newExampleState, sanitizeExamples, useExample, type ExampleContext, type ExampleState } from './examples';

const POOL: ExampleQuestion[] = [
  { q: '持病はありましたか？', starter: true, facts: ['F01'] },
  { q: 'けがはありましたか？', starter: true, facts: ['F02'] },
  { q: '部屋は暑かったですか？', starter: true },
  { q: '猫はいましたか？' },
  { q: '雨でしたか？' },
  { q: '窓は開いていましたか？', facts: ['F05'] },
  { q: '誰かと一緒でしたか？', facts: ['F06', 'F07'] },
];
const none: ExampleContext = { asked: [], facts: [] };
const at = (s: ExampleState, ms: number) => ({ ...s, ms });

describe('dealing schedule (EXAMPLE_TUNING)', () => {
  it('見習い and 審問官 start with 2, then +1 every 60 s', () => {
    for (const d of ['easy', 'normal'] as const) {
      expect(dealsAt(d, 0)).toBe(2);
      expect(dealsAt(d, 59_999)).toBe(2);
      expect(dealsAt(d, 60_000)).toBe(3);
      expect(dealsAt(d, 179_000)).toBe(4);
      expect(nextDealAt(d, 0)).toBe(60_000);
      expect(nextDealAt(d, 61_000)).toBe(120_000);
    }
  });
  it('教授 starts with none: the first after 2 min, then every 90 s', () => {
    expect(dealsAt('hard', 0)).toBe(0);
    expect(dealsAt('hard', 119_999)).toBe(0);
    expect(dealsAt('hard', 120_000)).toBe(1);
    expect(dealsAt('hard', 209_999)).toBe(1);
    expect(dealsAt('hard', 210_000)).toBe(2);
    expect(nextDealAt('hard', 0)).toBe(120_000);
    expect(nextDealAt('hard', 130_000)).toBe(210_000);
  });
});

describe('order', () => {
  it('is the same for the same seed and leads with starters', () => {
    const a = exampleOrder(POOL, 42).map((e) => e.q);
    expect(exampleOrder(POOL, 42).map((e) => e.q)).toEqual(a);
    expect(a).toHaveLength(POOL.length);
    expect(a.slice(0, EXAMPLE_TUNING.starterLead).every((q) => POOL.find((e) => e.q === q)?.starter)).toBe(true);
  });
  it('differs between seeds (some seed gives another order)', () => {
    const a = exampleOrder(POOL, 1).map((e) => e.q).join();
    expect([2, 3, 4, 5, 6, 7].some((s) => exampleOrder(POOL, s).map((e) => e.q).join() !== a)).toBe(true);
  });
});

describe('advanceExamples', () => {
  it('審問官: two starter cards at once, a third at 60 s, never more than 3 on the table', () => {
    let s = advanceExamples(newExampleState(7), 'normal', POOL, none);
    expect(s.shown).toHaveLength(2);
    expect(s.shown.every((q) => POOL.find((e) => e.q === q)?.starter)).toBe(true);
    s = advanceExamples(at(s, 60_000), 'normal', POOL, none);
    expect(s.shown).toHaveLength(3);
    s = advanceExamples(at(s, 300_000), 'normal', POOL, none);
    expect(s.shown).toHaveLength(3);
    expect(s.dealt).toBe(dealsAt('normal', 300_000));
  });

  it('a used card is refilled on the next deal, not at once; unused cards stay', () => {
    let s = advanceExamples(at(newExampleState(3), 60_000), 'normal', POOL, none);
    const [first, ...others] = s.shown;
    const u = useExample(s, first, first);
    expect(u.card).toBe(first);
    s = advanceExamples(u.state, 'normal', POOL, { asked: [first], facts: [] });
    expect(s.shown).toEqual(others);
    s = advanceExamples(at(s, 119_000), 'normal', POOL, { asked: [first], facts: [] });
    expect(s.shown).toHaveLength(2);
    s = advanceExamples(at(s, 120_000), 'normal', POOL, { asked: [first], facts: [] });
    expect(s.shown).toHaveLength(3);
    expect(s.shown.slice(0, 2)).toEqual(others);
    expect(s.shown).not.toContain(first);
  });

  it('the first two cards are starters even when a starter is already pointless', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = advanceExamples(newExampleState(seed), 'normal', POOL, { asked: [], facts: ['F01'] });
      expect(s.shown.every((q) => POOL.find((e) => e.q === q)?.starter)).toBe(true);
      expect(s.shown).not.toContain('持病はありましたか？');
    }
  });

  it('教授: nothing at the start, one card at 2 min', () => {
    let s = advanceExamples(newExampleState(9), 'hard', POOL, none);
    expect(s.shown).toEqual([]);
    s = advanceExamples(at(s, 120_000), 'hard', POOL, none);
    expect(s.shown).toHaveLength(1);
    expect(POOL.find((e) => e.q === s.shown[0])?.starter).toBe(true);
  });

  it('never deals (and removes) a card already asked or whose findings are all in hand', () => {
    const ctx: ExampleContext = { asked: ['持病はありましたか'], facts: ['F02', 'F05', 'F06'] };
    let s = advanceExamples(at(newExampleState(5), 900_000), 'normal', POOL, ctx);
    expect(s.shown).not.toContain('持病はありましたか？');
    expect(s.shown).not.toContain('けがはありましたか？');
    expect(s.shown).not.toContain('窓は開いていましたか？');
    // one of two findings is not enough to retire a card
    s = { ...s, shown: ['誰かと一緒でしたか？'] };
    expect(advanceExamples(s, 'normal', POOL, ctx).shown).toContain('誰かと一緒でしたか？');
    expect(advanceExamples(s, 'normal', POOL, { ...ctx, facts: [...ctx.facts, 'F07'] }).shown).not.toContain('誰かと一緒でしたか？');
  });

  it('returns the same object when nothing changes', () => {
    const s = advanceExamples(newExampleState(1), 'normal', POOL, none);
    expect(advanceExamples(at(s, 1000), 'normal', POOL, none).shown).toBe(s.shown);
    const same = at(s, 1000);
    expect(advanceExamples(same, 'normal', POOL, none)).toBe(same);
  });

  it('runs out quietly when the pool is empty', () => {
    const s = advanceExamples(at(newExampleState(1), 600_000), 'normal', [], none);
    expect(s.shown).toEqual([]);
  });
});

describe('useExample', () => {
  const s: ExampleState = { seed: 1, ms: 0, dealt: 2, shown: ['猫はいましたか？', '雨でしたか？'], used: [] };
  it('the picked card counts even when its words were edited', () => {
    const u = useExample(s, '猫は家にいましたか', '猫はいましたか？');
    expect(u.card).toBe('猫はいましたか？');
    expect(u.state.used).toEqual(['猫はいましたか？']);
    expect(u.state.shown).toEqual(['雨でしたか？']);
  });
  it('a question typed by hand is never a used card (a card with the same words just leaves the table)', () => {
    expect(useExample(s, '雨でしたか').card).toBeNull();
    expect(useExample(s, '晴れでしたか？').state).toBe(s);
    const pruned = advanceExamples(s, 'normal', POOL, { asked: ['雨でしたか'], facts: [] });
    expect(pruned.shown).toEqual(['猫はいましたか？']);
    expect(pruned.used).toEqual([]);
  });
});

describe('save helpers', () => {
  it('sanitizes a stored state', () => {
    expect(sanitizeExamples(null)).toBeUndefined();
    expect(sanitizeExamples({ ms: 3 })).toBeUndefined();
    expect(sanitizeExamples({ seed: 4, ms: -1, dealt: 2.7, shown: ['a', 1, 'b', 'c', 'd'], used: 'x' })).toEqual({ seed: 4, ms: 0, dealt: 2, shown: ['a', 'b', 'c'], used: [] });
  });
  it('falls back to the starters of an older server', () => {
    expect(examplePool({ starterQuestions: ['a？'] })).toEqual([{ q: 'a？', starter: true }]);
    expect(examplePool({ examples: POOL, starterQuestions: [] })).toBe(POOL);
  });
});
