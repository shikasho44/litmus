/**
 * Verdict rules: clause-scoped negation, affirmed wrong claims dominate, model merge.
 * Real-case regressions come from the c01 reviewers (NOTES §7-2) and each case's truth text.
 */
import { describe, expect, it } from 'vitest';
import { affirmedIn, evaluateVerdict, prepareVerdictText } from '../../server/engine/verdict';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import type { VerdictJudgeOutput } from '../../server/engine/judge-types';
import { fixtureCase } from './helpers';

const c = fixtureCase();
const zero = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
const model = (elements: Record<string, number>, wrongClaims: Record<string, number> = {}): VerdictJudgeOutput => ({ elements, wrongClaims, usage: zero, latencyMs: 1 });

describe('negation is scoped to the mention', () => {
  const aff = (text: string, w: string) => affirmedIn(prepareVerdictText(text), w);
  it('reads denials attached to the keyword', () => {
    expect(aff('毒ではなく事故', '毒')).toBe(false);
    expect(aff('液体窒素は関係ない', '液体窒素')).toBe(false);
    expect(aff('殺されていない', '殺され')).toBe(false);
    expect(aff('殺されたのではない', '殺され')).toBe(false);
    expect(aff('他殺の形跡はない', '他殺')).toBe(false);
    expect(aff('暴行も物取りもなく', '物取り')).toBe(false);
    expect(aff('凍死でも毒でもなく', '凍死')).toBe(false);
    expect(aff('毒物は検出されなかった', '毒')).toBe(false); // inside the compound 毒物
    expect(aff('熱中症と思われた', '熱中症')).toBe(false);
    expect(aff('骨折、心臓の損傷、毒物はいずれも認められなかった', '損傷')).toBe(false);
  });
  it('does not treat descriptions of the answer as denials', () => {
    expect(aff('酸素がなくなって彼女は殺された', '殺')).toBe(true);
    expect(aff('酸素が足りなくなった', '足りな')).toBe(true);
    expect(aff('酸素が少なくなる', '少な')).toBe(true);
    expect(aff('毒で殺された', '毒')).toBe(true);
    expect(aff('毒じゃない。でも毒殺', '毒')).toBe(true);
    expect(aff('ボールが当たったが熱中症ではない', 'ボール')).toBe(true); // denial after 「が」 is another clause
    expect(aff('暑いと思い込んで服を脱いだ', '暑いと')).toBe(true); // the victim's misperception is not a denial
  });
});

describe('verdict results', () => {
  it('classifies the fixture', () => {
    expect(evaluateVerdict(c, 'テントの中で炭火を燃やして一酸化炭素中毒になった').result).toBe('correct');
    expect(evaluateVerdict(c, '一酸化炭素中毒').result).toBe('almost');
    expect(evaluateVerdict(c, 'テントの中の七輪が原因').result).toBe('missing');
    expect(evaluateVerdict(c, '心臓発作').result).toBe('wrong');
    expect(evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒。殺されたのではない').result).toBe('correct');
  });

  it('lets an affirmed wrong claim dominate (at best missing)', () => {
    const ev = evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒。犯人に殺された');
    expect(ev.result).toBe('missing');
    expect(ev.wrongClaims).toEqual(['W2']);
    expect(evaluateVerdict(c, '犯人に毒を盛られた').result).toBe('wrong');
  });

  it('does not match answer elements inside denied mentions', () => {
    const ev = evaluateVerdict(c, '一酸化炭素ではない。炭火は関係ない');
    expect(ev.matched).toEqual([]);
    expect(ev.result).toBe('wrong');
  });

  it('merges model probabilities: adds matches, and a high wrong-claim probability blocks', () => {
    expect(evaluateVerdict(c, '一酸化炭素中毒', model({ B: 0.9 })).result).toBe('correct');
    expect(evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒', model({}, { W2: 0.85 })).result).toBe('missing');
    // a rules-affirmed wrong claim stands unless the model is fairly sure it is not asserted
    expect(evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒。犯人に殺された', model({}, { W2: 0.5 })).result).toBe('missing');
    expect(evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒。犯人に殺された', model({}, { W2: 0.1 })).result).toBe('correct');
  });
});

const registry = loadRegistry(resolveContentRoot({}));
const c01 = registry.get('c01-room-without-breath', true)?.data;

describe.skipIf(!c01)('c01 reviewer regressions', () => {
  it('false stories that describe the oxygen drop are never correct / almost', () => {
    for (const text of [
      '同僚が液体窒素を気化させ、酸素がなくなって彼女は殺された',
      '液体窒素を飲んで、体の中で気化して酸素が足りなくなった',
      '誰かが扉を閉めて閉じ込めたので、液体窒素が気化して酸素が足りなくなり窒息死',
    ]) {
      const ev = evaluateVerdict(c01!, text);
      expect(['missing', 'wrong'], `${text} → ${ev.result}`).toContain(ev.result);
      expect(ev.wrongClaims.length, text).toBeGreaterThan(0);
    }
  });

  it('true stories with lexical negatives stay correct', () => {
    for (const text of ['液体窒素が気化して部屋の酸素が足りなくなり、酸欠で亡くなった', '液体窒素の気化で酸素がなくなって窒息した。他殺ではない']) {
      expect(evaluateVerdict(c01!, text).result, text).toBe('correct');
    }
  });

  it('「液体窒素は関係ない」 does not count as naming the liquid nitrogen', () => {
    const ev = evaluateVerdict(c01!, '酸素が足りなくなって窒息した。液体窒素は関係ない');
    expect(ev.matched).not.toContain('B');
    expect(ev.result).not.toBe('correct');
  });
});

describe('every real case: the truth text is a correct verdict', () => {
  for (const loaded of registry.list(true)) {
    it(loaded.data.id, () => {
      const t = loaded.data.truth;
      const ev = evaluateVerdict(loaded.data, [t.causeOfDeath, t.summary, t.mechanism].join('。'));
      expect(ev.result, `wrong claims ${ev.wrongClaims.join(',')} · matched ${ev.matched.join(',')}`).toBe('correct');
      expect(evaluateVerdict(loaded.data, t.summary).wrongClaims).toEqual([]);
    });
  }
});
