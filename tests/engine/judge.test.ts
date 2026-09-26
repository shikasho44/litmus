import { describe, expect, it } from 'vitest';
import { analyze } from '../../server/engine/normalize';
import { keywordHits, keywordStrength, retrieve, scoreProbes } from '../../server/engine/retrieve';
import { judgeRules, judgeText, flipAnswer, PROBE_THRESHOLD } from '../../server/engine/rules-judge';
import { fixtureIndex } from './helpers';

const index = fixtureIndex();
const judge = (q: string) => judgeText(analyze(q), index);

describe('retrieve', () => {
  it('ranks facts by keyword hits and overlap (top 8)', () => {
    const c = retrieve(analyze('テントの中にコンロはありましたか'), index);
    expect(c.facts.length).toBeLessThanOrEqual(8);
    expect(c.facts[0].id).toBe('F06');
    expect(c.facts.map((f) => f.id)).toContain('F01');
    expect(c.probes.length).toBeLessThanOrEqual(5);
    expect(c.probes[0].entry.probe.q).toBe('テントの中にコンロがありましたか');
  });

  it('drops nested keyword hits and weights by length', () => {
    const f = index.factById.get('F03')!;
    expect(keywordHits('毒物はありましたか', f)).toEqual(['毒物']);
    expect(keywordStrength(['毒'])).toBeCloseTo(0.5);
    expect(keywordStrength(['毒物'])).toBeCloseTo(0.65);
    expect(keywordStrength(['毒物', '薬物'])).toBeGreaterThan(0.85);
  });

  it('flips probe labels when negation differs', () => {
    const p = scoreProbes(analyze('外傷はありませんでしたよね'), index.probes)[0];
    expect(p.entry.probe.q).toBe('外傷はありましたか');
    expect(p.flip).toBe(true);
  });
});

describe('rules judge', () => {
  it('uses authored probes (verbatim and paraphrased)', () => {
    expect(judge('雨が降っていましたか').answerClass).toBe('yes');
    const d = judge('雨が降っていましたか？');
    expect(d.source).toBe('probe');
    expect(d.factIds).toEqual(['F04']);
    expect(judge('彼女は毒を飲みましたか').answerClass).toBe('no');
  });

  it('flips polarity for negated confirmations', () => {
    expect(judge('外傷はなかったですよね').answerClass).toBe('yes');
    expect(judge('雨じゃなかったですよね').answerClass).toBe('no');
    expect(flipAnswer('partial')).toBe('partial');
  });

  it('falls back to keywords with fact polarity', () => {
    const d = judge('薬物が使われた？');
    expect(d.source).toBe('keyword');
    expect(d.answerClass).toBe('no');
    expect(d.factIds).toEqual(['F03']);
    const n = judge('薬物は使われていないよね');
    expect(n.answerClass).toBe('yes');
  });

  it('answers level-4 topics (confirming the guess is the game)', () => {
    const d = judge('一酸化炭素のせい？');
    expect(d.answerClass).toBe('yes');
    expect(d.factIds).toContain('F15');
    expect(d.closeness).toBe(3);
  });

  it('turns open questions into a rephrase request', () => {
    const d = judge('コンロには何が入っていた？');
    expect(d.answerClass).toBe('vague');
    expect(d.meta).toBe('open');
  });

  it('answers relevance questions from fact importance', () => {
    expect(judge('水筒は関係ありますか').answerClass).toBe('irrelevant');
    expect(judge('コンロは重要ですか').answerClass).toBe('yes');
    expect(judge('宇宙人は関係ありますか').answerClass).toBe('irrelevant');
    expect(judge('七輪は関係ないですよね').answerClass).toBe('no');
  });

  it('handles metas before weak matches, probes before metas when verbatim', () => {
    expect(judge('死因を教えて').answerClass).toBe('cannot');
    expect(judge('死因を教えて').meta).toBe('askAnswer');
    expect(judge('ヒントをください').answerClass).toBe('cannot');
    expect(judge('こんにちは').answerClass).toBe('irrelevant');
    expect(judge('').answerClass).toBe('vague');
    expect(judge('バカ').meta).toBe('rude');
  });

  it('says vague when nothing matches', () => {
    const d = judge('ぴよぴよぱよ');
    expect(d.answerClass).toBe('vague');
    expect(d.source).toBe('fallback');
    expect(d.confidence).toBeLessThan(0.5);
  });

  it('is deterministic', () => {
    const q = analyze('テントの入口は開いていましたか');
    const c = retrieve(q, index);
    expect(judgeRules(q, c, index)).toEqual(judgeRules(q, c, index));
    expect(PROBE_THRESHOLD).toBeGreaterThan(0.5);
  });
});

describe('proposition polarity', () => {
  it('compares a state question with the clause of the fact that holds the keyword', () => {
    // F14: 換気口も閉じられ、空気の入れ替えはなかった (author topic polarity: 'no')
    expect(judge('換気口は閉じられていましたか').answerClass).toBe('yes');
    expect(judge('換気口は開いていましたか').answerClass).toBe('no');
    expect(judge('換気口は閉じられていなかったですよね').answerClass).toBe('no');
  });

  it('flips fuzzy probe matches with the opposite predicate', () => {
    // probe 「入口は閉じていましたか」 (yes)
    const d = judge('入口は開いていましたか');
    expect(d.answerClass).toBe('no');
  });
});
