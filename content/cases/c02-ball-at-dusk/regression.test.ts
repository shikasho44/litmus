/**
 * c02「夕暮れの白球」 regression set (from the 2026-09-24 three-lens review).
 *
 * The validator only re-asks the authored probes. This file asks realistic player
 * phrasings (regression.json) through the real offline pipeline — analyze → retrieve →
 * judgeRules → applyPolicy — and runs the verdict set through evaluateVerdict.
 *
 *   - every `critical` question must get one of its expected answer classes
 *   - no `forbid` fact may unlock (from the start state, and from a state holding F07+F21)
 *   - the whole question set must stay ≥ 95 % (paraphrases may drift to 「もう少し具体的に」)
 *   - every verdict must land on one of its expected results
 *
 * Case data only — if the engine heuristics change on purpose, update regression.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CaseSchema } from '../../../shared/case-schema';
import { buildCaseIndex } from '../../../server/engine/case-index';
import { analyze, splitQuestions } from '../../../server/engine/normalize';
import { judgeText } from '../../../server/engine/rules-judge';
import { applyPolicy } from '../../../server/engine/policy';
import { initialState } from '../../../server/engine/state';
import { evaluateVerdict } from '../../../server/engine/verdict';

interface QuestionCase {
  q: string;
  expect: string[];
  forbid?: string[];
  critical?: boolean;
}
interface VerdictCase {
  text: string;
  expect: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const c = CaseSchema.parse(JSON.parse(readFileSync(resolve(here, 'case.json'), 'utf8')));
const index = buildCaseIndex(c);
const set = JSON.parse(readFileSync(resolve(here, 'regression.json'), 'utf8')) as { questions: QuestionCase[]; verdicts: VerdictCase[] };

function ask(q: string) {
  const part = splitQuestions(q).parts[0] ?? q;
  const d = judgeText(analyze(part), index);
  const s0 = initialState(c, 0);
  const rich = { ...s0, unlocked: [...s0.unlocked, 'F07', 'F21'] };
  const unlocked = new Set([...applyPolicy(c, index, d, s0).unlock, ...applyPolicy(c, index, d, rich).unlock]);
  return { answer: d.answerClass as string, unlocked };
}

describe('c02 regression (rules mode)', () => {
  const results = set.questions.map((x) => ({ x, r: ask(x.q) }));

  it('answers every critical question as expected', () => {
    const bad = results
      .filter(({ x, r }) => x.critical && !x.expect.includes(r.answer))
      .map(({ x, r }) => `${x.q} → ${r.answer} (expected ${x.expect.join('|')})`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('never unlocks a forbidden fact', () => {
    const bad = results
      .filter(({ x, r }) => (x.forbid ?? []).some((id) => r.unlocked.has(id)))
      .map(({ x, r }) => `${x.q} unlocked ${[...r.unlocked].join(',')}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('keeps ≥ 95 % of the whole question set', () => {
    const bad = results.filter(({ x, r }) => !x.expect.includes(r.answer));
    const rate = 1 - bad.length / results.length;
    expect(rate, bad.map(({ x, r }) => `${x.q} → ${r.answer}`).join('\n')).toBeGreaterThanOrEqual(0.95);
  });

  it('classifies every verdict as expected', () => {
    const bad = set.verdicts
      .map((v) => ({ v, got: evaluateVerdict(c, v.text).result as string }))
      .filter(({ v, got }) => !v.expect.includes(got))
      .map(({ v, got }) => `${got} (expected ${v.expect.join('|')}) :: ${v.text}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
