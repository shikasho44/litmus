import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../../server/engine/registry';
import { composeLine, LineBank, pickIndex } from '../../server/engine/lines';
import { DEFAULT_LINES } from '../../server/engine/default-lines';
import { validateCase } from '../../server/engine/validate';
import { fixtureRaw, FIXTURE_ID } from './helpers';

describe('content registry', () => {
  it('loads valid cases, skips broken ones and reports them', () => {
    const broken = fixtureRaw();
    broken.id = 'c91-broken';
    delete broken.truth;
    const reg = ContentRegistry.fromRaw({
      cases: [
        { dir: FIXTURE_ID, path: 'a.json', data: fixtureRaw() },
        { dir: 'c91-broken', path: 'b.json', data: broken },
        { dir: 'c92-unreadable', path: 'c.json', error: 'Unexpected token' },
      ],
    });
    expect(reg.cases.map((c) => c.data.id)).toEqual([FIXTURE_ID]);
    const errs = reg.issues.filter((i) => i.level === 'error');
    expect(errs.some((i) => i.path === 'b.json' && i.caseId === 'c91-broken' && i.message.startsWith('truth'))).toBe(true);
    expect(errs.some((i) => i.path === 'c.json')).toBe(true);
    // missing line bank → built-in default + warning
    expect(reg.lines.info.source).toBe('default');
    expect(reg.issues.some((i) => i.path === 'content/holma-lines.json' && i.level === 'warning')).toBe(true);
  });

  it('hides unpublished cases unless asked', () => {
    const draft = fixtureRaw();
    draft.id = 'c93-draft';
    draft.number = 93;
    draft.publish = false;
    const reg = ContentRegistry.fromRaw({ cases: [{ dir: 'x', path: 'x', data: fixtureRaw() }, { dir: 'c93-draft', path: 'y', data: draft }] });
    expect(reg.list().map((c) => c.data.id)).toEqual([FIXTURE_ID]);
    expect(reg.list(true).map((c) => c.data.id)).toEqual([FIXTURE_ID, 'c93-draft']);
    expect(reg.get('c93-draft')).toBeUndefined();
    expect(reg.get('c93-draft', true)?.data.id).toBe('c93-draft');
    expect(reg.issues.some((i) => i.message.includes('does not match case id'))).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const reg = ContentRegistry.fromRaw({ cases: [{ dir: FIXTURE_ID, path: 'a', data: fixtureRaw() }, { dir: FIXTURE_ID, path: 'b', data: fixtureRaw() }] });
    expect(reg.cases).toHaveLength(1);
    expect(reg.issues.some((i) => i.message.includes('duplicate case id'))).toBe(true);
  });
});

describe('line bank', () => {
  it('falls back per section when the file is partly invalid', () => {
    const bank = LineBank.from({ answer: { yes: ['はいですとも。'] } });
    expect(bank.info.source).toBe('merged');
    expect(bank.lines.answer.yes).toEqual(['はいですとも。']);
    expect(bank.lines.answer.no).toEqual(DEFAULT_LINES.answer.no);
    expect(bank.info.issues.length).toBeGreaterThan(0);
    expect(LineBank.from(undefined).info.source).toBe('default');
  });

  it('never repeats a line on consecutive seeds', () => {
    for (const len of [2, 3, 5, 7, 14]) {
      for (let seed = 0; seed < 30; seed++) expect(pickIndex(len, seed, 'k')).not.toBe(pickIndex(len, seed + 1, 'k'));
    }
    expect(pickIndex(1, 5, 'k')).toBe(0);
  });

  it('composes prefixes, unlock and nearCore lines with a mood', () => {
    const bank = LineBank.default();
    const l = composeLine(bank, { answerClass: 'yes', unlockedCore: true, unlocked: true, nearCore: true, part: 0, parts: 2, degraded: true, seed: 0, caseNearCore: ['ケースの台詞'] });
    expect(l.pieces).toHaveLength(5); // degraded + multi + answer + unlockCore + nearCore
    expect(l.pieces[0]).toContain('簡易判定');
    expect(l.mood).toBe('surprised');
    const meta = composeLine(bank, { answerClass: 'cannot', meta: 'rude', unlockedCore: false, unlocked: false, nearCore: false, part: 1, parts: 2, degraded: true, seed: 3 });
    expect(meta.pieces).toHaveLength(1);
    expect(meta.mood).toBe('serious');
  });
});

describe('validator', () => {
  it('passes the fixture', () => {
    const r = validateCase(fixtureRaw());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats!.selfConsistency.rate).toBeGreaterThanOrEqual(0.95);
    expect(r.stats!.generalization.total).toBe(r.stats!.probes);
  });

  it('reports semantic errors', () => {
    const c = fixtureRaw() as Record<string, any>;
    c.probes[0].facts = ['F77'];
    c.facts[3].requires = ['F99'];
    c.debate[0].answer.span = '曇っていた';
    c.debate[1].answer.fact = 'F15'; // level 4 → not usable as evidence
    c.reconstruction.panels[1].choice.options[1].correct = true;
    c.quiz[0].answer = 9;
    c.solveRule.required = ['A', 'Z'];
    c.sources[0].url = 'http://insecure.example/';
    c.intro.summary = '一酸化炭素で亡くなった女性。';
    c.probes = c.probes.filter((p: { kind: string }) => p.kind !== 'typo');
    c.probes.push({ q: '雨が降っていましたか', answer: 'no', facts: ['F04'], kind: 'no' });
    const r = validateCase(c);
    const all = r.errors.join('\n');
    expect(r.ok).toBe(false);
    for (const needle of ['unknown fact F77', 'F99', '曇っていた', 'not usable as evidence', '2 correct options', 'out of range', 'unknown element Z', 'not https', 'leak term "一酸化炭素"', 'missing kinds: typo', 'conflicting probe labels']) {
      expect(all, needle).toContain(needle);
    }
  });

  it('reports schema errors without throwing', () => {
    const r = validateCase({ id: 'c99-x' });
    expect(r.ok).toBe(false);
    expect(r.caseId).toBe('c99-x');
    expect(r.errors[0]).toMatch(/^schema: /);
  });
});
