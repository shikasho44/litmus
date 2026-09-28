/**
 * Rules-judge routing fixes (case reviewers' reports): causal / blame questions, intent and agent
 * words, the broken / forgot-to axes, bare "noun + は？" and "I'm stuck" metas.
 * Generic behaviour is pinned on the fixture; the reviewers' own examples run on the real cases.
 */
import { describe, expect, it } from 'vitest';
import { analyze, detectMeta, isOpenQuestion, normalize, polarityMarks, questionProposition } from '../../server/engine/normalize';
import { buildCaseIndex } from '../../server/engine/case-index';
import { judgeText } from '../../server/engine/rules-judge';
import { applyPolicy } from '../../server/engine/policy';
import { initialState } from '../../server/engine/state';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import { fixtureIndex } from './helpers';

const fx = fixtureIndex();
const fj = (q: string) => judgeText(analyze(q), fx);

describe('normalize: shapes and axes', () => {
  it('treats a bare value topic as an open question, existence shorthands as yes/no', () => {
    for (const q of ['死亡推定時刻は？', '気温は？', '死因は？', '犯人は？', '窒素とは？', '天気は']) expect(isOpenQuestion(normalize(q)), q).toBe(true);
    for (const q of ['毒は？', 'どこかに傷は', '外傷は？', '変なにおいはありましたか', '何者かに襲われた？']) expect(isOpenQuestion(normalize(q)), q).toBe(false);
    expect(isOpenQuestion(normalize('犯人を教えて'))).toBe(true);
  });

  it('reads the broken axis and 「〜忘れ」', () => {
    expect(questionProposition('換気扇は壊れていましたか')).toMatchObject({ polarity: 'neg', determinate: true, family: 'broken' });
    expect(questionProposition('タンクは壊れていなかった？')).toMatchObject({ polarity: 'pos', family: 'broken' });
    expect(questionProposition('弁を閉め忘れた？')).toMatchObject({ polarity: 'pos', determinate: true, family: 'open' });
    expect(questionProposition('電気を消し忘れた？')).toMatchObject({ polarity: 'pos', family: 'state' });
    expect(polarityMarks(normalize('警報は鳴らなかった'))).toEqual([{ polarity: 'neg', stem: true, family: 'state' }]);
    expect(polarityMarks(normalize('換気扇は動かなくなった'))[0]).toMatchObject({ polarity: 'neg', stem: true });
  });

  it('routes "I am stuck" to the hint meta but not 「無理やり」', () => {
    const m = (q: string) => detectMeta(q, normalize(q), false);
    for (const q of ['わからん', 'わからない', 'もう無理', '降参です', '詰んだ', 'さっぱりわからない', '何を聞けばいい？']) expect(m(q), q).toBe('askHint');
    expect(m('無理やり脱がされた？')).toBeUndefined();
    expect(m('犯人は誰？')).toBeUndefined(); // an open question (→ vague), or the culprit seal (culprit.ts)
    expect(m('誰が殺したの？')).toBeUndefined();
    expect(m('何が彼女を殺したの？')).toBe('askAnswer');
  });
});

describe('rules judge on the fixture', () => {
  // Murder / accident / culprit / intent / blame are answered truthfully (2026-09-28, manner.ts).
  // The fixture has neither a manner fact nor a culprit seal: the keyword routing decides.
  it('answers 「誰が殺したの？」 with a rephrase request (no culprit seal here)', () => {
    for (const q of ['誰が殺したの？', '犯人を教えて', '犯人って誰なの']) {
      const d = fj(q);
      expect(d.answerClass, q).toBe('vague');
      expect(d.factIds, q).toEqual([]);
      expect(d.guard, q).toBeUndefined();
    }
  });

  it('routes intent / agent words and a person blamed to the no-crime fact', () => {
    for (const q of ['何者かに殺された？', '犯人がいるの？', '事件ですか？', '同行者のせいですか？']) {
      const d = fj(q);
      expect(d.answerClass, q).toBe('no');
      expect(d.factIds, q).toEqual(['F09']);
    }
  });

  it('answers a bare value topic as vague, not yes', () => {
    expect(fj('天気は？').answerClass).toBe('vague');
  });
});

const registry = loadRegistry(resolveContentRoot({}));
const real = (id: string) => registry.get(id, true)?.data;

function judgeReal(caseId: string) {
  const c = real(caseId)!;
  const index = buildCaseIndex(c);
  return (q: string) => {
    const d = judgeText(analyze(q), index);
    return { ...d, unlock: applyPolicy(c, index, d, initialState(c, 0)).unlock };
  };
}

describe.skipIf(!real('c01-room-without-breath'))('c01 reviewer examples', () => {
  const j = judgeReal('c01-room-without-breath');
  it('intent words outrank the topic fact (no card for the topic)', () => {
    for (const q of ['液体窒素をわざとまいたの？', '誰かがこぼしたの？', '何者かにバルブを開けられた？']) {
      const d = j(q);
      expect(d.answerClass, q).toBe('no');
      expect(d.unlock, q).not.toContain('F38');
    }
    expect(j('液体窒素をわざとまいたの？').factIds).toEqual(['F47']);
  });
  it('answers the manner from the manner fact, and blame on a person with いいえ', () => {
    expect(j('殺されたの？')).toMatchObject({ answerClass: 'no', factIds: ['F47'] });
    expect(j('事故ですか？')).toMatchObject({ answerClass: 'yes', factIds: ['F47'] });
    for (const q of ['警備員のせい？', '同僚のせいで死んだ？']) expect(j(q).answerClass, q).toBe('no');
    expect(j('部屋に窓はありましたか？').answerClass).toBe('no');
  });
  it('keeps broken apart from stopped / dead battery', () => {
    for (const q of ['排気ファンは壊れてた？', '濃度計は故障してた？']) expect(j(q).answerClass, q).toBe('partial');
    expect(j('扉は壊れていた？').answerClass).toBe('no');
    expect(j('バルブを閉め忘れたの？').answerClass).toBe('yes');
  });
  it('bare topics are open', () => {
    expect(j('気温は？').answerClass).toBe('vague');
    expect(j('死亡推定時刻は？').answerClass).toBe('vague');
  });
});

describe.skipIf(!real('c02-ball-at-dusk'))('c02 reviewer examples', () => {
  const j = judgeReal('c02-ball-at-dusk');
  it('routes people blamed by 「のせい」「が悪い」 to the no-blame / manner facts, things as causes', () => {
    expect(j('通りすがりの人のせい？')).toMatchObject({ answerClass: 'no', factIds: ['F42'] });
    expect(j('弟のせいで死んだの？')).toMatchObject({ answerClass: 'no', factIds: ['F54'] });
    expect(j('弟さんは悪くないですか？').answerClass).toBe('yes');
    expect(j('誰かがわざとぶつけた？')).toMatchObject({ answerClass: 'no', factIds: ['F54'] });
    expect(j('偶然ですか？')).toMatchObject({ answerClass: 'yes', factIds: ['F54'] });
    expect(j('暑さのせい？').answerClass).toBe('no');
    expect(j('ボールのせいで死んだのですか？').answerClass).toBe('yes');
  });
});

describe.skipIf(!real('c03-shed-in-snow'))('c03 reviewer examples', () => {
  const j = judgeReal('c03-shed-in-snow');
  it('routes blame to the no-blame fact and keeps the phone "not broken"', () => {
    expect(j('友人は悪くない？').answerClass).toBe('yes');
    expect(j('捜索隊が悪いの？').answerClass).toBe('no');
    expect(j('誰にも襲われていないですよね？').answerClass).toBe('yes');
    expect(j('熊に襲われましたか？').answerClass).toBe('no');
    expect(j('スマホは壊れていた？').answerClass).toBe('partial');
    expect(j('犯人は誰？').answerClass).toBe('vague');
  });
});
