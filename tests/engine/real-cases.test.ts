/**
 * Runs every REAL case under content/cases through the engine:
 *   - schema + semantic validation must have no errors
 *   - every authored probe, judged verbatim by the rules judge, reproduces its label (≥ 95 %)
 *   - the truth text passes the verdict, and the public view leaks nothing secret
 * Skipped while no real case exists yet (other builders write them in parallel).
 */
import { describe, expect, it } from 'vitest';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import { validateParsedCase, SELF_CONSISTENCY_MIN } from '../../server/engine/validate';
import { toPublic } from '../../server/engine/public-view';
import { evaluateVerdict } from '../../server/engine/verdict';
import { normalize } from '../../server/engine/normalize';

const registry = loadRegistry(resolveContentRoot({}));
const cases = registry.list(true);

describe.skipIf(cases.length === 0)('real cases', () => {
  for (const loaded of cases) {
    const c = loaded.data;
    describe(c.id, () => {
      it('validates without errors', () => {
        const r = validateParsedCase(c, { path: loaded.path, skipGeneralization: true });
        expect(r.errors, r.errors.join('\n')).toEqual([]);
      });

      it(`rules mode reproduces ≥ ${SELF_CONSISTENCY_MIN * 100}% of probe labels`, () => {
        const r = validateParsedCase(c, { skipGeneralization: true });
        const s = r.stats!.selfConsistency;
        const detail = s.mismatches.map((m) => `${m.q} → expected ${m.expected}, got ${m.got} (${m.source})`).join('\n');
        expect(s.rate, detail).toBeGreaterThanOrEqual(SELF_CONSISTENCY_MIN);
      });

      it('truth passes the verdict', () => {
        expect(evaluateVerdict(c, [c.truth.causeOfDeath, c.truth.summary, c.truth.mechanism].join('。')).result).toBe('correct');
      });

      it('public view carries no leak terms or identity', () => {
        const pub = normalize(JSON.stringify(toPublic(c)));
        for (const t of c.leakTerms) expect(pub, t).not.toContain(normalize(t));
        expect(pub).not.toContain(normalize(c.victim.name));
      });
    });
  }
});

describe('content registry on disk', () => {
  it('loads without throwing and reports broken files instead of crashing', () => {
    expect(Array.isArray(registry.issues)).toBe(true);
    expect(registry.lines.lines.answer.yes.length).toBeGreaterThan(0);
  });
});
