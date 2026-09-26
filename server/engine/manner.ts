/**
 * Manner-of-death guard (「殺人か事故か」 is not answerable during the investigation).
 *
 * The science supervisor's rule for the yes/no phase: whether the death was murder, an accident
 * or suicide — and anything that asks the same thing in other words (a culprit, intent, blame) —
 * is decided by the player in the inquest, never confirmed or denied by Holma. Otherwise one
 * question (「事故ですか？」) would dissolve every misdirection a case sets up.
 *
 * Evidence stays answerable: 「争った跡はありますか」「部屋に他の人はいましたか」「熊に襲われた？」
 * 「わざと服を脱いだの？」 are about facts, not about the manner of death.
 *
 * Runs in the rules judge right after the victim-name guard (rules-judge.ts), so it wins over
 * authored probes and no model is consulted (Jev and the LLM judge see the truth, which in a
 * murder case names the culprit). The safety filter (safety.ts) runs earlier, so 「人を殺す方法」
 * still gets the support card. Pure TS, also used by the static build.
 *
 * Patterns run on the normalized text (NFKC, lowercase, katakana → hiragana, no punctuation).
 */
import { normalize } from './normalize.js';

export interface MannerHit {
  rule: string;
}

const P = (s: string) => new RegExp(s, 'u');

// 殺 in words that are not about killing a person (殺虫剤, 殺菌, 相殺, 殺風景 …)
const KILL = '(?<![相黙忙悩笑])殺(?!虫|菌|鼠|そ剤|風景|到|陣)';
// people who could be a culprit — explicit words only (「彼女が押した」「本人が」 must not match)
const SOMEONE = '(?:誰か|だれか|何者か|なにものか|犯人|はんにん|第三者|他人|たにん|不審者|ふしんしゃ|知らない人|しらないひと|別の人|べつのひと|ほかの人|他の人|ほかのひと)';
// 「事故」「事件」 only where they are the answer (「事故ですか」「事故死」「事件性」「殺人事件」),
// not as a noun for the event (「事故の前」「事件当日」「事故を防ぐ装置」)
const AS_ANSWER = '(?:が(?:起|おき|あっ|あり)|です|でした|だった|だ(?:よね)?$|なの|なん|でしょう|か|では|じゃ|ってこと|と(?:いう|考|かんが|思|おも|判断)|扱い|として|$)';

const RULES: { id: string; re: RegExp }[] = [
  // killing, in any form (殺された / 殺人 / 他殺 / 自殺 / 殺意 / 毒殺 …)
  { id: 'kill', re: P(KILL) },
  { id: 'kill-kana', re: P('ころ(?:され|さな|した|して|しま|す(?:つもり|気|き)|そうと)|さつじん|さつがい|どくさつ') },
  { id: 'harmed-by', re: P(`(?:${SOMEONE}|誰にも|だれにも|何者にも)(?:に|から|が)?(?:.{0,4})(?:襲|おそわ|やられ|殴|なぐ|刺|さされ|突き落|つきおと|押され|おされ|閉じ込め|とじこめ|狙わ|ねらわ)`) },
  // someone else tampering with the scene or the victim (「誰かがバルブを開けた？」) — presence and help
  // stay answerable (「誰かが部屋に入ってきた？」「誰かが心臓マッサージをした？」)
  {
    id: 'sabotage',
    re: P(`${SOMEONE}(?:が|は|に)(?:.{0,12})(?:こぼ|開け|あけ|閉め|抜い|抜か|ぬい|切っ|切ら|外し|はずし|止め|入れ|いれ|盛っ|盛り|混ぜ|まぜ|すり替|すりか|細工|さいく|仕掛|しかけ|壊|こわ|隠|持ち去|もちさ|盗|ぬす|ぶつけ|投げ|なげ|突き|落と|閉じ込め|とじこめ|脱が|ぬが|つない|繋い|飲ませ|のませ|食べさせ|たべさせ|いじっ)`),
  },
  { id: 'attack', re: P('(?:襲撃|しゅうげき|殺害|暗殺|他殺|たさつ|絞殺|撲殺|刺殺|毒殺)') },
  // suicide in other words (the safety filter already took the present-tense cries for help)
  { id: 'suicide', re: P('(?:じさつ|自死|自害|自ら命|みずから命|みずからいのち|命を絶|いのちをた|身投げ|みなげ)') },
  // accident / incident as the answer
  { id: 'accident', re: P(`(?:事故|じこ)(?:死|に(?:あ|遭)|で(?:死|亡|なくな|した)|${AS_ANSWER})|(?:交通|不慮の|偶然の|不運な|単なる|ただの|作業中の|悲しい)事故`) },
  { id: 'incident', re: P(`(?:事件|じけん)(?:性|に(?:巻き込|まきこ)|${AS_ANSWER})|(?:殺人|刑事|傷害)事件`) },
  { id: 'chance', re: P('(?:偶然|ぐうぜん|たまたま)(?:です|でした|だった|なの|なん|か$|$|じゃ|では)') },
  // culprit and blame (a culprit may not even exist — never imply either way)
  { id: 'culprit', re: P('(?:犯人|はんにん|犯行|はんこう|犯罪|はんざい|加害者|かがいしゃ|容疑者|ようぎしゃ|下手人|黒幕|くろまく|共犯|きょうはん|仕業|しわざ|強盗|ごうとう|通り魔|とおりま|暴漢|ぼうかん|変質者|へんしつしゃ|すとーかー)') },
  // done to her by someone (「毒を飲まされた？」「薬を盛られた？」) — 「毒を飲んだ？」 stays a cause question
  { id: 'done-to', re: P('(?:飲まされ|のまされ|食べさせられ|たべさせられ|盛られ|もられ|嗅がされ|かがされ)') },
  { id: 'blame', re: P('(?:誰|だれ|何者|なにもの)(?:か)?(?:の|が)(?:せい|所為|やった|やりました|しわざ|仕業)') },
  // a person's fault (「弟のせい？」「救急隊のせい？」) — things stay causes (「暑さのせい」「ボールのせい」)
  {
    id: 'blame-person',
    re: P('(?:人|ひと|者|家族|親|父|母|兄|姉|弟|妹|夫|妻|恋人|彼氏|友人|友達|ともだち|同僚|上司|部下|先輩|後輩|警備員|大人|おとな|子ども|子供|こども|隊|隊員|指令員|医者|医師|仲間|本人|自分|彼女|かのじょ)(?:さん|くん|ちゃん|たち|達)?(?:の(?:せい|所為)|(?:は|が|も)(?:悪|わる)(?:い|く|かっ))'),
  },
  // motive (kanji only: hiragana どうき is also 動悸)
  { id: 'motive', re: P('(?:動機|殺意|さつい|悪意|狙われ|ねらわれ)') },
  // intent behind the fatal act (「わざとこぼした」「故意にぶつけた」) — 「わざと服を脱いだ」 stays answerable
  { id: 'intent', re: P('(?:故意|意図的|いとてき|意図して|計画的|けいかくてき|わざと(?:じゃ|では|です|でした|だった|なの|なん|か$|$))') },
  {
    id: 'intent-act',
    re: P('(?:わざと|狙って|ねらって)(?:.{0,10})(?:殺|ころ|撒|まい|まか|ぶつけ|当て|あて|襲|閉じ込め|とじこめ|閉め|しめ|押し|おし|突き|つき|落と|おと|盛|混ぜ|まぜ|入れ|いれ|こぼ|傷つけ|きずつけ|害|止め|とめ|切っ|切ら|抜い|ぬい|外し|はずし|倒|たお|壊|こわ|投げ|なげ|飲ませ|のませ|食べさせ|たべさせ)'),
  },
  // the manner itself, named
  { id: 'manner', re: P('(?:死因の種類|しいんのしゅるい|死に方の種類)') },
];

/** First manner-of-death rule the question trips, if any. */
export function detectManner(raw: string, norm: string = normalize(raw)): MannerHit | undefined {
  for (const r of RULES) if (r.re.test(norm)) return { rule: r.id };
  return undefined;
}
