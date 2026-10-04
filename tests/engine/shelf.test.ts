/**
 * The 事件ファイル shelves (2026-10-04, shared/shelf.ts, docs/decisions.md 「事件ファイルを棚に分けた」):
 * くられ先生監修 (CASE 01, 05–08), オリジナル (CASE 02–04 and the seeds prototype), リトマス・ラボ (the lab
 * samples, only behind ?proto=lab). Which shelf each case stands on, and which shelves a player sees.
 */
import { describe, expect, it } from 'vitest';
import { caseShelf, isOfficialCase } from '../../shared/shelf';
import { validateCase } from '../../server/engine/validate';
import { toSummary } from '../../server/engine/public-view';
import { contentRegistry } from '../content/regression-harness';

const reg = () => contentRegistry();
const shelfOf = (protos: string[]) => {
  const m: Record<string, string[]> = {};
  for (const c of reg().list(false, protos)) (m[caseShelf(c.data)] ??= []).push(c.data.id.slice(0, 3));
  return m;
};

describe('case shelves', () => {
  it('default: a lab prototype on the lab shelf, every other case on the original shelf; the field wins', () => {
    expect(caseShelf({})).toBe('original');
    expect(caseShelf({ proto: 'seeds' })).toBe('original');
    expect(caseShelf({ proto: 'lab' })).toBe('lab');
    expect(caseShelf({ shelf: 'kurare' })).toBe('kurare');
    expect(caseShelf({ shelf: 'nope' })).toBe('original');
    expect(isOfficialCase({ shelf: 'kurare' })).toBe(true);
    expect(isOfficialCase({ shelf: 'original', proto: 'seeds' })).toBe(false);
    expect(isOfficialCase({ proto: 'lab' })).toBe(false);
  });

  it('assigns CASE 01 and 05–08 to くられ先生監修, CASE 02–04 and c09 to オリジナル, c10–c12 to the lab', () => {
    const by: Record<string, string> = {};
    for (const c of reg().list(true, ['seeds', 'lab'])) by[c.data.id.slice(0, 3)] = caseShelf(c.data);
    expect(by).toEqual({
      c01: 'kurare', c02: 'kurare', c03: 'kurare', c04: 'kurare', c08: 'kurare',
      c05: 'original', c06: 'original', c07: 'original', c09: 'original',
      c10: 'lab', c11: 'lab', c12: 'lab',
    });
    const numbers = reg().list(false, []).filter((c) => caseShelf(c.data) === 'kurare').map((c) => c.data.number);
    expect(numbers).toEqual([1, 5, 6, 7, 8]); // CASE numbering unchanged
  });

  it('no switch: the official 8 on two shelves, no lab shelf; the lab shelf only with ?proto=lab', () => {
    expect(shelfOf([])).toEqual({ kurare: ['c08', 'c01', 'c02', 'c03', 'c04'], original: ['c05', 'c06', 'c07'] });
    expect(shelfOf(['seeds']).original).toEqual(['c05', 'c06', 'c07', 'c09']);
    expect(shelfOf(['seeds']).lab).toBeUndefined();
    expect(shelfOf(['lab']).lab).toEqual(['c10', 'c11', 'c12']);
    // the counters count the official cases only, with or without a switch
    expect(reg().list(false, ['seeds', 'lab']).filter((c) => isOfficialCase(c.data))).toHaveLength(8);
  });

  it('the case summary carries the shelf and the review status (the 監修中 stamp)', () => {
    const s = toSummary(reg().get('c08-half-folded-towel')!.data);
    expect(s.shelf).toBe('kurare');
    expect(s.reviewStatus).toBe('ai-reviewed');
    expect(toSummary(reg().get('c10-shaken-bottle', true)!.data).shelf).toBe('lab');
  });

  it('the validator keeps the lab shelf for lab prototypes only', () => {
    const base = reg().get('c10-shaken-bottle', true)!.data;
    const errs = (patch: object) => validateCase({ ...base, ...patch }, { skipGeneralization: true }).errors.filter((e) => e.includes('shelf'));
    expect(errs({})).toEqual([]);
    expect(errs({ shelf: 'original' })).toHaveLength(1); // a lab puzzle among the official cases
    const pub = reg().get('c05-tiptoe-milk-bottle')!.data;
    const e2 = validateCase({ ...pub, shelf: 'lab' }, { skipGeneralization: true }).errors.filter((e) => e.includes('shelf'));
    expect(e2).toHaveLength(1); // a public case on the lab shelf
  });
});
