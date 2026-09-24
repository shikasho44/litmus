/**
 * Validator extensions: leak scan of contentWarning / intro.location / intro.time, debate
 * success lines, image files (warnings only, via the injected asset check).
 */
import { describe, expect, it } from 'vitest';
import { validateCase } from '../../server/engine/validate';
import { fixtureRaw } from './helpers';

type Raw = Record<string, any>;
const run = (mutate: (c: Raw) => void, assetExists?: (p: string) => boolean) => {
  const raw = fixtureRaw() as Raw;
  mutate(raw);
  return validateCase(raw, { skipGeneralization: true, assetExists });
};

describe('validate: extended checks', () => {
  it('passes the fixture as is', () => {
    const r = run(() => {});
    expect(r.errors).toEqual([]);
  });

  it('scans contentWarning, intro.location and intro.time for leak terms', () => {
    const r = run((c) => {
      c.contentWarning = '一酸化炭素の話です';
      c.intro.location = '一酸化炭素の部屋';
      c.intro.time = 'CO中毒の朝';
    });
    expect(r.errors.filter((e) => e.startsWith('leak term')).map((e) => e.split(' in public field ')[1]).sort()).toEqual(['contentWarning', 'intro.location', 'intro.time']);
  });

  it('requires non-blank debate success lines', () => {
    const r = run((c) => {
      c.debate[0].success = ['  '];
    });
    expect(r.errors.some((e) => e.includes('success lines'))).toBe(true);
  });

  it('warns (never errors) about missing image files when an asset check is given', () => {
    const seen: string[] = [];
    const r = run(
      (c) => {
        c.reconstruction.panels[0].image = 'cases/c90/panel-1.webp';
      },
      (p) => (seen.push(p), p.startsWith('cases/c90/bg')),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes('image file not found: public/cases/c90/panel-1.webp'))).toBe(true);
    expect(seen).toContain('cases/c90/panel-1.webp');
    // without the check nothing is reported
    expect(run((c) => (c.reconstruction.panels[0].image = 'cases/nope.webp')).warnings.some((w) => w.includes('image file'))).toBe(false);
  });
});
