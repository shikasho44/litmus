/**
 * Built-in fallback line bank. Used section-by-section whenever content/holma-lines.json
 * is missing or a section fails validation, so the engine always has something in
 * character to say. Keep these short, case-agnostic and fact-free.
 */
import type { HolmaLines, Line } from '../../shared/lines-schema.js';
import type { WhKind } from './normalize.js';

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
    manner: [
      'その問いは、宣告まで封印です。“事故か、誰かの仕業か”は、審問の最後にあなたが決めること。',
      '事故か、殺しか。決めるのは私ではなく、あなたが集める所見です。争った跡、出入り、体の様子——そちらをどうぞ。',
      'おっと、そこは答えられません。“事実”でしたら、いくらでもお答えしますよ。',
      'わざとか、そうでないか——それは宣告のときに審問官が見極めるもの。今は物と体に訊きなさいな。',
      'その問いに答えたら、審問がいらなくなってしまいます。何が、どこに、どうなっていたか、をどうぞ。',
    ],
    culprit: [
      '犯人の名は、宣告のときにあなたが口にするもの。今はお答えしません。',
      '名指しは宣告で。誰がどこにいて、何に触れたか——“事実”でしたら、お答えしますよ。',
      'ひとりずつ名前を挙げて確かめる——それでは審問になりませんねェ。証拠をどうぞ。',
      '誰の手によるものか。それは、あなたが集める所見で決めることです。',
      '犯人を名指す問いは、捜査中は封印です。行動と証拠に訊いてごらんなさい。',
    ],
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
    wrongShot: [{ text: 'クックック、反応なしですねェ。', mood: 'laugh' }, 'おや、色は変わりませんでしたよ。'],
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

/**
 * Holma's answer to a question that cannot be answered はい／いいえ (meta 'open': 「なぜ倒れたの？」
 * 「どこに当たったんですか」「犯人は誰？」). One consistent coaching move per wh-word, with a
 * fact-free template of the yes/no form (『〜のせいですか？』). Used instead of the generic
 * answer.vague pool, whose 「具体的に」 lines misread an already specific question. The content
 * line bank may override a kind with meta.open.<kind> once the schema carries it.
 */
export const OPEN_LINES: Record<WhKind, Line[]> = {
  why: [
    '「なぜ」を解くのは審問官の役目。『〜のせいですか？』と訊きなさい。',
    '理由は、ひとつ挙げてごらんなさい。『〜が原因ですか？』と。',
  ],
  how: [
    '「どうやって」は語れません。『〜しましたか？』と、ひとつずつ。',
    '仕組みは二択の積み重ねで解くもの。『〜でしたか？』の形でどうぞ。',
  ],
  where: [
    '場所は、候補を挙げて訊きなさい。『〜でしたか？』と、ひとつずつ。',
    { text: 'ククッ、「どこ」には答えられません。『〜のあたりですか？』の形で。', mood: 'laugh' },
  ],
  when: [
    '「いつ」ではなく、区切って訊きなさい。『〜より前ですか？』と。',
    '時を当てるなら、ひとつ挙げて。『〜の頃でしたか？』と。',
  ],
  who: [
    '「誰」とは申せません。『〜はそこにいましたか？』と、ひとりずつ。',
    '人を訊くなら、ひとりずつ名指しで。『〜はいましたか？』と。',
  ],
  what: [
    '「何」を当てるのは審問官。『それは〜ですか？』と挙げてごらんなさい。',
    '問いの形を変えましょう。『〜でしたか？』なら、必ず答えますとも。',
  ],
};
