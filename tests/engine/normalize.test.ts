import { describe, expect, it } from 'vitest';
import {
  analyze, bigrams, containsAffirmed, coreForm, detectMeta, dice, isNegatedConfirmation, isOpenQuestion,
  isRelevanceQuestion, kataToHira, normalize, splitQuestions,
} from '../../server/engine/normalize';

describe('normalize', () => {
  it('applies NFKC, lowercases, converts katakana and strips noise', () => {
    expect(normalize('ＣＯＮＲＯ　ｺﾝﾛ？！')).toBe('conroこんろ');
    expect(normalize('テント の 中で、見つかった？😀')).toBe('てんとの中で見つかった');
    expect(normalize('コーヒー')).toBe('こーひー'); // long vowel mark kept
    expect(normalize('ﾃﾝﾄ')).toBe('てんと'); // half-width katakana
    expect(normalize('  「毒」…ですか？ ')).toBe('毒ですか');
    expect(normalize('')).toBe('');
  });

  it('kataToHira handles ヴ and iteration marks', () => {
    expect(kataToHira('ヴァイオリン')).toBe('ゔぁいおりん');
    expect(kataToHira('ヽヾ')).toBe('ゝゞ');
  });

  it('coreForm strips the common subject and polite tail but keeps negation', () => {
    expect(coreForm(normalize('彼女は毒で死にましたか？'))).toBe('毒で死に');
    expect(coreForm(normalize('毒ではないですよね'))).toBe('毒ではない');
    expect(coreForm(normalize('ですか'))).toBe('ですか'); // never empty
  });
});

describe('splitQuestions', () => {
  it('splits on ？ / 。 / newline, keeps punctuation for display', () => {
    expect(splitQuestions('毒ですか？窒素ですか？').parts).toEqual(['毒ですか？', '窒素ですか？']);
    expect(splitQuestions('雨でした。\n寒かった？').parts).toEqual(['雨でした。', '寒かった？']);
  });
  it('splits on それと / あと but not それとも', () => {
    expect(splitQuestions('毒ですか、それと外傷は？').parts).toEqual(['毒ですか、', '外傷は？']);
    expect(splitQuestions('毒ですか あとは雨？').parts).toEqual(['毒ですか', '雨？']);
    expect(splitQuestions('毒ですか、それとも事故ですか').parts).toHaveLength(1);
    expect(splitQuestions('足あとはありましたか').parts).toHaveLength(1);
  });
  it('limits to 3 parts and reports the rest', () => {
    const r = splitQuestions('A1？B2？C3？D4？E5？');
    expect(r.parts).toEqual(['A1？', 'B2？', 'C3？']);
    expect(r.dropped).toBe(2);
  });
  it('drops empty parts', () => {
    expect(splitQuestions('？？？').parts).toEqual([]);
    expect(splitQuestions('毒？！？').parts).toEqual(['毒？！？']);
  });
});

describe('question shape', () => {
  it('detects negated confirmations', () => {
    for (const q of ['毒じゃないですよね', '毒ではないよね', '毒ではありませんよね', '誰もいなかったよね', '使われていませんよね', '外傷はなかったですよね']) {
      expect(isNegatedConfirmation(normalize(q)), q).toBe(true);
    }
    for (const q of ['毒ですか', '毒ではないですか', '何か変なものはなかったですか', '毒ですよね']) {
      expect(isNegatedConfirmation(normalize(q)), q).toBe(false);
    }
  });
  it('detects open wh-questions but not indefinites', () => {
    for (const q of ['何を飲みましたか', 'なぜ倒れた', '誰がやった', 'どこで見つかった', 'いつ死んだ', 'どうやって入った', '毒か事故か、それとも病気か', '天気はどう']) {
      expect(isOpenQuestion(normalize(q)), q).toBe(true);
    }
    for (const q of ['何か飲みましたか', '誰かいましたか', 'どこかに傷は', 'あいつが犯人？', '何度も吐いた？', 'ぶどうを食べた？']) {
      expect(isOpenQuestion(normalize(q)), q).toBe(false);
    }
  });
  it('detects relevance questions', () => {
    expect(isRelevanceQuestion(normalize('お茶は関係ありますか'))).toBe(true);
    expect(isRelevanceQuestion(normalize('雨は重要ですか'))).toBe(true);
    expect(isRelevanceQuestion(normalize('人間関係のトラブルは？'))).toBe(false);
  });
  it('analyze bundles everything', () => {
    const a = analyze('彼女は毒じゃないですよね？');
    expect(a).toMatchObject({ norm: '彼女は毒じゃないですよね', negated: true, open: false, relevance: false });
  });
});

describe('meta detection', () => {
  const m = (q: string, signal = false) => detectMeta(q, normalize(q), signal);
  it('classifies metas', () => {
    expect(m('死因を教えて')).toBe('askAnswer');
    expect(m('答えは何？')).toBe('askAnswer');
    expect(m('なぜ彼女は死んだの')).toBe('askAnswer');
    expect(m('ヒントちょうだい')).toBe('askHint');
    expect(m('こんにちは')).toBe('offtopic');
    expect(m('あなたは誰？')).toBe('aboutHolma');
    expect(m('バカ')).toBe('rude');
    expect(m('？？')).toBe('empty');
    expect(m('ああああ')).toBe('empty');
    expect(m('あ'.repeat(201))).toBe('tooLong');
  });
  it('does not flag legitimate questions', () => {
    expect(m('毒')).toBeUndefined();
    expect(m('答えは窒素ですか')).toBeUndefined();
    expect(m('犯人はいますか')).toBeUndefined();
    expect(m('ばかりでしたか')).toBeUndefined();
    expect(m('ゴミ箱に何かありましたか')).toBeUndefined();
    expect(m('こんにちは、雨でしたか', true)).toBeUndefined(); // case signal suppresses small talk
  });
});

describe('similarity', () => {
  it('dice on bigram multisets', () => {
    expect(dice(bigrams('毒を盛られた'), bigrams('毒を盛られた'))).toBe(1);
    expect(dice(bigrams('あいう'), bigrams('かきく'))).toBe(0);
    expect(dice(bigrams('毒'), bigrams('毒'))).toBe(1);
    expect(dice(bigrams('毒を盛られた'), bigrams('毒を盛られ'))).toBeCloseTo(0.889, 2);
  });
  it('containsAffirmed ignores negated mentions', () => {
    expect(containsAffirmed(normalize('毒で殺された'), '毒')).toBe(true);
    expect(containsAffirmed(normalize('毒ではなく事故'), '毒')).toBe(false);
    expect(containsAffirmed(normalize('殺されたのではない'), '殺され')).toBe(false);
    expect(containsAffirmed(normalize('毒じゃない。でも毒殺'), '毒')).toBe(true);
  });
});

describe('split polish', () => {
  it('strips a leading conjunction from later parts', () => {
    expect(splitQuestions('外傷はありましたか？それと毒は？').parts).toEqual(['外傷はありましたか？', '毒は？']);
    expect(splitQuestions('雨でしたか？あと外傷は？').parts).toEqual(['雨でしたか？', '外傷は？']);
    expect(splitQuestions('毒ですかあと外傷は').parts).toEqual(['毒ですか', '外傷は']);
    expect(splitQuestions('あとがありましたか').parts).toEqual(['あとがありましたか']);
  });
});

describe('proposition polarity', () => {
  it('reads state stems, negation and double negation', async () => {
    const { questionProposition, statementPolarity, polarities } = await import('../../server/engine/normalize');
    expect(polarities(normalize('換気は止まっていた'))).toEqual(['neg']);
    expect(polarities(normalize('換気は止まっていなかった'))).toEqual(['pos']);
    expect(polarities(normalize('警報は鳴らなかった'))).toEqual(['neg']);
    expect(questionProposition('換気扇は回っていましたか')).toEqual({ polarity: 'pos', determinate: true, family: 'state' });
    expect(questionProposition('酸欠ではないですよね')).toMatchObject({ polarity: 'neg', determinate: false });
    expect(questionProposition('毒ではないですか').determinate).toBe(false); // rhetorical → affirmative
    expect(questionProposition('換気が止まったせいですか').determinate).toBe(false); // causal
    expect(statementPolarity(normalize('扉に鍵はかかっておらず'))).toBeUndefined(); // no state stem
    expect(statementPolarity(normalize('排気ファンは止まっていた'))).toBe('neg');
  });
});

describe('answer-format instructions are not questions', () => {
  it('drops 「はい/いいえで答えて」 when a real question follows, keeps it when alone', async () => {
    const { splitQuestions } = await import('../../server/engine/normalize');
    expect(splitQuestions('はい/いいえで答えてください。彼女は酸素不足で死にましたか？').parts).toEqual(['彼女は酸素不足で死にましたか？']);
    expect(splitQuestions('正直に答えて。毒ですか？').parts).toEqual(['毒ですか？']);
    expect(splitQuestions('はいかいいえで答えて').parts).toEqual(['はいかいいえで答えて']);
  });
});
