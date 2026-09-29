/**
 * Content regression sets — every tests/content/regression/<case-id>.json (see regression-harness.ts
 * for the file format). Realistic player phrasings and verdict texts from each case's review go
 * through the real offline pipeline (runAsk in rules mode) and evaluateVerdict.
 *
 * Firm expectations fail the suite. Expectations that depend on an engine fix being built
 * concurrently carry `pending: <fix>`; they are asserted once they pass and listed as `todo`
 * while they do not, so the suite stays green and still documents the target:
 *
 *   npx vitest run tests/content                   normal run
 *   STRICT_PENDING=1 npx vitest run tests/content  assert every pending target too
 *
 * Case data only — if the engine heuristics change on purpose, update the set, not this file.
 */
import { describe, expect, it } from 'vitest';
import {
  PENDING_FIXES,
  describeQuestion,
  loadSets,
  runQuestions,
  runVerdicts,
  type PendingFix,
  type QuestionResult,
  type VerdictResultRow,
} from './regression-harness';

const STRICT = process.env.STRICT_PENDING === '1';
const sets = loadSets();

const results = new Map<string, { questions: QuestionResult[]; verdicts: VerdictResultRow[] }>();
for (const set of sets) results.set(set.caseId, { questions: await runQuestions(set), verdicts: runVerdicts(set) });

const list = (rows: string[]) => rows.join('\n');

describe('regression sets', () => {
  it('exist for every case', () => {
    expect(sets.map((s) => s.caseId).sort()).toEqual([
      'c01-room-without-breath', 'c02-ball-at-dusk', 'c03-shed-in-snow', 'c04-white-flower-supper',
      'c05-tiptoe-milk-bottle', 'c06-snowman-below-zero', 'c07-thirst-beside-water', 'c08-half-folded-towel',
    ]);
  });
});

for (const set of sets) {
  const { questions, verdicts } = results.get(set.caseId)!;
  const firm = questions.filter((r) => !r.x.pending);
  const firmVerdicts = verdicts.filter((v) => !v.v.pending);
  const minRate = set.minRate ?? 0.95;

  describe(`${set.caseId} regression (rules mode)`, () => {
    it('answers every critical question as expected', () => {
      const bad = firm.filter((r) => r.x.critical && r.problems.length > 0).map(describeQuestion);
      expect(bad, list(bad)).toEqual([]);
    });

    it('never unlocks a forbidden fact', () => {
      const bad = firm.filter((r) => r.problems.some((p) => p.startsWith('unlocked forbidden'))).map(describeQuestion);
      expect(bad, list(bad)).toEqual([]);
    });

    it('keeps nearCore off where it must stay off', () => {
      const bad = firm.filter((r) => r.problems.includes('switched nearCore on')).map(describeQuestion);
      expect(bad, list(bad)).toEqual([]);
    });

    it('answers manner questions and seals only the culprit (2026-09-28)', () => {
      const bad = firm.filter((r) => (r.x.manner || r.x.culprit) && r.problems.length > 0).map(describeQuestion);
      expect(bad, list(bad)).toEqual([]);
    });

    it('refuses safety questions (cannot, nothing unlocks)', () => {
      const safety = firm.filter((r) => r.x.safety);
      const bad = safety.filter((r) => r.problems.length > 0).map(describeQuestion);
      expect(bad, list(bad)).toEqual([]);
    });

    it(`keeps ≥ ${Math.round(minRate * 100)} % of the whole question set`, () => {
      const bad = firm.filter((r) => r.problems.length > 0);
      const rate = firm.length === 0 ? 1 : 1 - bad.length / firm.length;
      expect(rate, list(bad.map(describeQuestion))).toBeGreaterThanOrEqual(minRate);
    });

    it('classifies every verdict as expected', () => {
      const bad = firmVerdicts.filter((v) => !v.ok).map((v) => `${v.got} (expected ${v.v.expect.join('|')}) :: ${v.v.text}`);
      expect(bad, list(bad)).toEqual([]);
    });

    describe('pending engine fixes', () => {
      for (const fix of PENDING_FIXES) {
        const rows = pendingRows(fix, questions, verdicts);
        if (rows.length === 0) continue;
        const open = rows.filter((r) => !r.ok);
        const done = rows.filter((r) => r.ok);
        if (STRICT) {
          it(`[${fix}] every target is met`, () => expect(open.map((r) => r.label), list(open.map((r) => r.label))).toEqual([]));
          continue;
        }
        if (done.length > 0) it(`[${fix}] ${done.length}/${rows.length} targets already met`, () => expect(done.every((r) => r.ok)).toBe(true));
        if (open.length > 0) it.todo(`[${fix}] ${open.length}/${rows.length} open — ${open.map((r) => r.label).join(' | ')}`);
      }
    });
  });
}

interface PendingRow {
  label: string;
  ok: boolean;
}

/** Everything a fix is expected to change: pending questions/verdicts, plus the support notice. */
function pendingRows(fix: PendingFix, questions: QuestionResult[], verdicts: VerdictResultRow[]): PendingRow[] {
  const rows: PendingRow[] = [];
  for (const r of questions) {
    if (r.x.pending === fix) rows.push({ label: describeQuestion(r), ok: r.pendingProblems.length === 0 });
    else if (fix === 'safety-filter' && r.x.safety && !r.x.pending) {
      const notice = r.pendingProblems.filter((p) => p.startsWith('notice'));
      rows.push({ label: `${r.x.q} → ${notice.join('; ') || 'notice support'}`, ok: notice.length === 0 });
    }
  }
  for (const v of verdicts) {
    if (v.v.pending === fix) rows.push({ label: `${v.got} (target ${v.v.expect.join('|')}) :: ${v.v.text}`, ok: v.ok });
  }
  return rows;
}
