/**
 * 質問の例 cards and the per-case 質問枠 (docs/decisions.md 2026-09-29):
 *   - every case has 10–14 extra example questions, each one a probe (so the rules judge's answer
 *     is checked by the validator), a mix of leads and dead ends, none of them a starter again;
 *   - the public pool (exampleView) lists the starters first and only reachable finding ids;
 *   - every case sets its own questionBudget, 見習い ≥ 審問官 ≥ 教授.
 */
import { describe, expect, it } from 'vitest';
import type { Case } from '../../shared/case-schema';
import { normalize } from '../../server/engine/normalize';
import { exampleView, toPublic } from '../../server/engine/public-view';
import { contentRegistry } from './regression-harness';

const cases: Case[] = contentRegistry()
  .list(true)
  .map((l) => l.data);

describe('質問の例 (intro.exampleQuestions)', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s: 10–14 examples, each a probe, a mix of leads and dead ends', (_, c) => {
    const ex = c.intro.exampleQuestions ?? [];
    expect(ex.length).toBeGreaterThanOrEqual(10);
    expect(ex.length).toBeLessThanOrEqual(14);
    const probes = new Map(c.probes.map((p) => [normalize(p.q), p]));
    const facts = new Map(c.facts.map((f) => [f.id, f]));
    let leads = 0;
    let dead = 0;
    for (const q of ex) {
      const p = probes.get(normalize(q));
      expect(p, `${c.id}: ${q} has no probe`).toBeDefined();
      const weight = Math.max(0, ...p!.facts.map((id) => facts.get(id)?.importance ?? 0));
      // never aimed at the core (importance ≥ 3) or at a fact kept for late (spoilerLevel ≥ 3)
      for (const id of p!.facts) {
        expect(facts.get(id)!.importance, `${c.id}: ${q} → ${id}`).toBeLessThan(3);
        expect(facts.get(id)!.spoilerLevel, `${c.id}: ${q} → ${id}`).toBeLessThan(3);
      }
      if (p!.answer === 'irrelevant' || weight === 0) dead++;
      else leads++;
      expect([...q].length, q).toBeLessThanOrEqual(24);
    }
    expect(leads, `${c.id} leads`).toBeGreaterThanOrEqual(3);
    expect(dead, `${c.id} dead ends`).toBeGreaterThanOrEqual(3);
    const starters = new Set(c.intro.starterQuestions.map(normalize));
    for (const q of ex) expect(starters.has(normalize(q)), `${c.id}: ${q} repeats a starter`).toBe(false);
  });

  it('the public pool lists the starters first, then the examples, with reachable finding ids only', () => {
    for (const c of cases) {
      const view = exampleView(c);
      expect(toPublic(c).examples).toEqual(view);
      const starters = view.filter((e) => e.starter).map((e) => e.q);
      expect(starters).toEqual(c.intro.starterQuestions);
      expect(view.slice(0, starters.length).every((e) => e.starter)).toBe(true);
      const reachable = new Set(c.facts.filter((f) => f.spoilerLevel < 4).map((f) => f.id));
      for (const e of view) for (const id of e.facts ?? []) expect(reachable.has(id), `${c.id}: ${e.q} → ${id}`).toBe(true);
      // nothing but the question text and finding ids goes out
      for (const e of view) expect(Object.keys(e).every((k) => ['q', 'starter', 'facts'].includes(k))).toBe(true);
    }
  });
});

describe('質問枠 per case (2026-09-29, provisional)', () => {
  it('every case sets its own budget, 見習い ≥ 審問官 ≥ 教授', () => {
    for (const c of cases) {
      const b = c.questionBudget;
      expect(b, c.id).toBeDefined();
      expect(b!.easy! >= b!.normal! && b!.normal! >= b!.hard!, c.id).toBe(true);
    }
    const byId = Object.fromEntries(cases.map((c) => [c.id, c.questionBudget]));
    expect(byId['c08-half-folded-towel']).toEqual({ easy: 20, normal: 15, hard: 12 });
    expect(byId['c07-thirst-beside-water']).toEqual({ easy: 26, normal: 20, hard: 16 });
    expect(byId['c04-white-flower-supper']).toEqual({ easy: 44, normal: 34, hard: 26 });
  });
});
