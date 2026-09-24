/**
 * Built-in fallback line bank. Used section-by-section whenever content/holma-lines.json
 * is missing or a section fails validation, so the engine always has something in
 * character to say. Keep these short, case-agnostic and fact-free.
 */
import type { HolmaLines } from '../../shared/lines-schema.js';

export const DEFAULT_LINES: HolmaLines = {
  answer: {
    yes: [
      'ええ、その通りですとも。',
      'はい。……おや、なかなか鋭いですねェ。',
      'はい、と申し上げておきましょう。',
      { text: 'クックック……はい、ですとも。', mood: 'laugh' },
      'ご名答。はい、ですねェ。',
    ],
    no: [
      { text: 'いいえ。残念でしたねェ、クックック。', mood: 'laugh' },
      'いいえ、違いますとも。',
      'いいえ。その扉は外れですよ、審問官。',
      'いいえ。……さァ、次の問いを。',
      { text: 'ククッ、いいえ。', mood: 'laugh' },
    ],
    partial: [
      '一部は、そうですねェ。全部ではありませんが。',
      '半分正解、と言ったところでしょうか。',
      'そうとも言えますし、そうでないとも言えますねェ。',
    ],
    irrelevant: [
      'それは、彼女の死とは関係ありませんねェ。',
      '関係ない、とだけ。寄り道がお好きなようで。',
      'ふむ。この件には無関係ですとも。',
    ],
    cannot: [
      { text: 'それは今は答えられませんねェ。掟ですので。', mood: 'serious' },
      'クックック……その問いには、まだお答えできません。',
      '今は、まだ。審問官ご自身で辿り着いていただかねば。',
    ],
    vague: [
      '「はい」か「いいえ」で答えられる形で、もう一度どうぞ。',
      'もう少し具体的に訊いていただけますかねェ。',
      'ふむ、問いがぼやけていますよ。的を絞ってくださいな。',
    ],
  },
  unlock: [
    { text: 'おや、所見がひとつ手に入りましたねェ。', mood: 'surprised' },
    '記録しておきなさい。役に立つかもしれませんよ。',
    'ほう……ノートに書き留めておくとよろしい。',
  ],
  unlockCore: [
    { text: '……ほう。ずいぶん核心に触れる所見ですねェ。', mood: 'surprised' },
    { text: 'クックック、それを掴みましたか。', mood: 'laugh' },
  ],
  nearCore: [
    { text: '……おや。近づいてきましたねェ。', mood: 'surprised' },
    { text: '耳が勝手に動いてしまいますよ。いい所を突いている。', mood: 'surprised' },
  ],
  multi: ['欲張りですねェ。順にお答えしましょう。', 'ひとつずつ参りましょうか。'],
  meta: {
    askAnswer: [
      { text: '答えを言うのは、あなたの口ですよ審問官。私ではない。', mood: 'laugh' },
      '掟をお忘れで？　私は訊かれたことに、はいかいいえで答えるだけですとも。',
    ],
    askHint: ['手詰まりでしたら、上の「ホルマの囁き」をどうぞ。', 'ヒントがご入用なら、囁きの札をお使いなさい。'],
    offtopic: ['世間話は嫌いではありませんがねェ。今は彼女のことを。', 'ふむ。それより、彼女の話をいたしましょう。'],
    aboutHolma: ['私のことはお気になさらず。ただの標本ですとも。', 'クックック、私に興味が？　今は彼女を見てあげなさい。'],
    rude: [{ text: '……言葉は選びなさい。ここは死者の部屋です。', mood: 'serious' }],
    empty: ['……おや、何も聞こえませんでしたねェ。', '問いをどうぞ。はいかいいえで答えますとも。'],
    tooLong: ['長すぎますねェ。もう少し短く、ひとつずつ。'],
  },
  error: {
    network: ['おや、声が届かなかったようで。もう一度どうぞ。'],
    degraded: ['（通信が不安定なため、簡易判定で答えています）'],
    rateLimited: ['少し急ぎすぎですねェ。ひと呼吸おいてからどうぞ。'],
  },
  investigation: {
    idle: ['手が止まっていますよ、審問官。', '彼女は待っていますよ。'],
    hintIntro: ['仕方ありませんねェ。ひとつだけ囁いて差し上げましょう。'],
    inquestConfirmLow: ['……証拠がずいぶん心許ないようですが？　本当に開廷しますか。'],
    inquestConfirm: ['よろしい。では、審問の間へ参りましょう。'],
  },
  inquest: {
    open: [{ text: '開廷ですとも！', mood: 'laugh' }],
    roundStart: ['さァ、彼女の記憶を聞いてあげなさい。'],
    wrongShot: [{ text: 'クックック、的外れですねェ。', mood: 'laugh' }, 'おや、そこではありませんよ。'],
    grant: ['泣きつかれては仕方ない。これをお持ちなさい。'],
    composureLow: ['集中が切れかけていますよ。'],
    suspended: [{ text: '今日の審問はここまで。捜査に戻りなさい。', mood: 'serious' }],
    verdictPrompt: ['彼女に何が起きたのか。あなたの言葉でどうぞ。'],
    verdictCorrect: [{ text: '……お見事。それが、彼女の死因ですとも。', mood: 'serious' }],
    verdictAlmost: ['ほとんど辿り着いていますねェ。あと一歩。'],
    verdictMissing: ['まだ足りないものがありますよ。'],
    verdictWrong: [{ text: 'いいえ。その推理では、彼女は眠れませんねェ。', mood: 'laugh' }],
    reconstructionIntro: ['では、真相を組み直してご覧なさい。'],
    reconstructionWrong: ['そのコマは、そこではありませんねェ。'],
    reconstructionDone: [{ text: 'さァ、全貌をお見せしましょう。', mood: 'serious' }],
  },
  resolution: {
    identity: [{ text: '彼女は、もうジェーン・ドゥではありません。', mood: 'serious' }],
    farewell: [{ text: 'よい旅を。', mood: 'serious' }],
  },
  science: { intro: ['では、この死の裏側にある科学を解剖しましょう。'], outro: ['知ることが、次の誰かを守るのですよ。'] },
  quiz: {
    correct: ['正解ですとも。'],
    wrong: ['おや、もう一度考えてご覧なさい。'],
    complete: [{ text: 'よろしい。記憶に刻まれましたねェ。', mood: 'laugh' }],
  },
  title: { idle: ['さァ、次の魂がお待ちかねですよ。'] },
};
