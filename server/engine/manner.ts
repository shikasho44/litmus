/**
 * Manner of death in a question: murder, accident or suicide — and the same thing in other words
 * (a culprit, intent, blame, someone tampering with the scene, a named person's part).
 *
 * History. 2026-09-26 the science supervisor's rule sealed these questions during the yes/no
 * investigation (「殺人か事故か」 was decided only in the inquest). 2026-09-28 the owner decided
 * differently (docs/decisions.md): they are ANSWERED TRUTHFULLY. Asking 「殺人か事故か」 is itself a
 * key insight; the misdirection clues stay, so a player can still be misled until they think to
 * ask. The one seal left is naming the culprit, in cases that opt in (culprit.ts).
 *
 * This module is analysis only — it never refuses anything:
 *   detectManner()   is the question about the manner of death at all? (the old guard's
 *                    vocabulary, kept for tests and as the gate for mannerProposal)
 *   mannerProposal() which kind of death the question PROPOSES (homicide / accident / suicide),
 *                    who the agent is, and whether that alone decides the answer. The rules judge
 *                    (rules-judge.ts) answers such a question from the case's manner fact
 *                    (fact.manner, shared/case-schema.ts): 「殺されたの？」→ いいえ in an accident
 *                    case, はい in a murder case.
 *
 * Evidence stays evidence: 「争った跡はありますか」「部屋に他の人はいましたか」「熊に襲われた？」
 * 「わざと服を脱いだの？」「誰かがストッパーを外した？」 are about facts and are routed to them.
 *
 * Patterns run on the normalized text (NFKC, lowercase, katakana → hiragana, no punctuation).
 * Pure TS, also used by the static build.
 */
import { normalize } from './normalize.js';

export type Manner = 'accident' | 'homicide' | 'suicide';

export interface MannerHit {
  rule: string;
}

const P = (s: string) => new RegExp(s, 'u');

// 殺 in words that are not about killing a person (殺虫剤, 殺菌, 相殺, 殺風景 …)
const KILL = '(?<![相黙忙悩笑])殺(?!虫|菌|鼠|そ剤|風景|到|陣)';
// people who could be a culprit — explicit words only (「彼女が押した」「本人が」 must not match)
export const SOMEONE = '(?:誰か|だれか|何者か|なにものか|犯人|はんにん|第三者|他人|たにん|不審者|ふしんしゃ|知らない人|しらないひと|別の人|べつのひと|ほかの人|他の人|ほかのひと)';
// people named by their role or with an honorific (not the victim). Single-kanji roles must not sit
// inside a longer word (酵母, 神父); 祖母・祖父 are listed on their own.
export const ROLES = '(?:(?<!\\p{Script=Han})(?:親|父|母|兄|姉|弟|妹|夫|妻|男|客)|祖母|祖父|両親|家族|恋人|彼氏|友人|友達|ともだち|同僚|上司|部下|先輩|後輩|警備員|大人|おとな|隊員|指令員|医者|医師|仲間|男性|女性|男の子|おじさん|おばさん|おじいさん|おばあさん|老人|名人|学生|院生|大学院生|編集者|隣人|隣の人|近所の人|知人|店員|登山者|通行人|通りすがり|じょがー)';
export const PERSON_ANY = `(?:${SOMEONE}|${ROLES}|もう一人|もうひとり|その人|そのひと|あの人|あのひと|さん|くん|ちゃん|氏)`;
// the victim herself as the subject
const VICTIM = '(?:彼女|かのじょ|本人|ほんにん|自分|じぶん|被害者|ひがいしゃ|じぇーん)';
// 「事故」「事件」 only where they are the answer (「事故ですか」「事故死」「事件性」「殺人事件」),
// not as a noun for the event (「事故の前」「事件当日」「事故を防ぐ装置」)
const AS_ANSWER = '(?:が(?:起|おき|あっ|あり)|です|でした|だった|だ(?:よね)?$|なの|なん|でしょう|か|では|じゃ|ってこと|と(?:いう|考|かんが|思|おも|判断)|扱い|として|$)';

const RULES: { id: string; re: RegExp }[] = [
  // killing, in any form (殺された / 殺人 / 他殺 / 自殺 / 殺意 / 毒殺 …)
  { id: 'kill', re: P(KILL) },
  { id: 'kill-kana', re: P('ころ(?:され|さな|した|して|しま|す(?:つもり|気|き)|そうと)|さつじん|さつがい|どくさつ') },
  { id: 'harmed-by', re: P(`(?:${SOMEONE}|誰にも|だれにも|何者にも)(?:に|から|が)?(?:.{0,4})(?:襲|おそわ|やられ|殴|なぐ|刺|さされ|突き落|つきおと|押され|おされ|閉じ込め|とじこめ|狙わ|ねらわ)`) },
  // someone else doing something to the scene or the victim (「誰かがバルブを開けた？」) — presence and
  // help are not caught (「誰かが部屋に入ってきた？」「誰かが心臓マッサージをした？」)
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
  // culprit and blame
  { id: 'culprit', re: P('(?:犯人|はんにん|犯行|はんこう|犯罪|はんざい|加害者|かがいしゃ|容疑者|ようぎしゃ|下手人|黒幕|くろまく|共犯|きょうはん|仕業|しわざ|強盗|ごうとう|通り魔|とおりま|暴漢|ぼうかん|変質者|へんしつしゃ|すとーかー)') },
  // done to her by someone (「毒を飲まされた？」「薬を盛られた？」) — 「毒を飲んだ？」 stays a cause question
  { id: 'done-to', re: P('(?:飲まされ|のまされ|食べさせられ|たべさせられ|盛られ|もられ|嗅がされ|かがされ|脱がされ|ぬがされ|剥ぎ取られ|はぎ取られ|はぎとられ|押し込まれ|おしこまれ)') },
  // a named person's violence (「男に殴られた？」「弟が突き飛ばした？」) — 「殴られた跡はある？」 is evidence
  { id: 'assault-named', re: P(`${PERSON_ANY}(?:に|から|が|は)(?:.{0,6})(?:殴|突き飛ば|つきとば|押し倒|おしたお|襲|刺し|刺さ|手を出|首を絞|絞め|蹴)`) },
  // someone's involvement or suspiciousness (「もう一人は関係ある？」「その学生は怪しい？」) — 「ボールは関係ある？」 stays
  // (only a person as the subject: 「編集者の車の色は関係ある？」 asks about a thing)
  { id: 'involved', re: P(`${PERSON_ANY}(?:の(?:人|ひと|方))?(?:さん|くん|ちゃん|たち|達|ら|グループ|ぐるーぷ)?(?:が|は|も|って)?(?:(?:この件|事件|事故|死|彼女の死|それ)に)?(?:関係(?:し|あ|が(?:あ|な)|な)|関わ|かかわ|関与|絡ん|からん)`) },
  { id: 'suspect', re: P(`${PERSON_ANY}(?:が|は|も)?(?:.{0,4})(?:怪し|あやし|疑わし|うたがわし|不審)`) },
  // responsibility, blame, arrest (「弟に責任は？」「誰か逮捕された？」) — 「安全管理の責任者は？」 is evidence
  { id: 'responsibility', re: P('(?:に|の)責任(?!者)|責任(?:が|は)?(?:ある|あり|あっ|ない|なし|なかっ)|責め(?:る|ら|られ)|落ち度|おちど|悪気|わるぎ|関与|かんよ|逮捕|たいほ|捕ま(?:っ|る|え)') },
  // mixed in by someone (「小鉢に毒が混ぜられていた？」「毒を盛ったの？」) — 「小鉢に何か混ざっていた？」 is evidence
  { id: 'done-to-mix', re: P('(?:混ぜられ|まぜられ|混入され|こんにゅうされ|仕込まれ|しこまれ|(?:毒|どく|何か|なにか|異物)(?:を|が)?(?:入れられ|いれられ)|(?:毒|どく)を(?:盛|も)(?:っ|ら|り(?!付|つ)))') },
  // a named person (not the victim) mixing something in (「編集者が小鉢に混ぜた？」「老人が毒を入れたの？」)
  {
    id: 'tamper-named',
    re: P('(?<!彼女|かのじょ|本人|ほんにん|自分|じぶん|被害者|ひがいしゃ|じぇーん)(?:が|は)(?:[^がは]{0,14})(?:混ぜ|まぜ|混入|こんにゅう|仕込|しこん|しこみ|盛っ|盛り(?!付|つけ)|入れ(?!替|換|かわ|かえ)|いれ(?:た|て|まし|ら))'),
  },
  // 「編集者がやったの？」 — who did it, with a name
  { id: 'did-it', re: P('(?:が|は)(?:やった|やりました|やったん|やったの)') },
  // a death staged to look like something else (「事故に見せかけたの？」「偽装？」)
  { id: 'staged', re: P('(?:見せかけ|みせかけ|偽装|ぎそう|かもふらーじゅ|装った|よそおった|装って|よそおって)') },
  // the accident in other words (「採り違えですか？」「間違えて摘んだ？」「誤食？」) — 「間違えやすい？」 is science
  { id: 'mistake', re: P('(?:採り違え|採りちがえ|取り違え|取りちがえ|とりちがえ|摘み違え|つみちがえ|誤食|ごしょく|誤って|あやまって|間違って|まちがって|(?:見|み)?(?:間違|まちが)え(?:て|た|まし)|勘違いして|かんちがいして|うっかり)') },
  { id: 'blame', re: P('(?:誰|だれ|何者|なにもの)(?:か)?(?:の|が)(?:せい|所為|やった|やりました|しわざ|仕業)') },
  // a person's fault (「弟のせい？」「救急隊のせい？」) — things stay causes (「暑さのせい」「ボールのせい」)
  {
    id: 'blame-person',
    re: P(`(?:人|ひと|者|${ROLES}|子ども|子供|こども|隊|本人|自分|彼女|かのじょ|さん|くん|ちゃん|氏)(?:さん|くん|ちゃん|たち|達)?(?:の(?:せい|所為)|(?:は|が|も)(?:悪|わる)(?:い|く|かっ))`),
  },
  // motive (kanji only: hiragana どうき is also 動悸)
  { id: 'motive', re: P('(?:動機|殺意|さつい|悪意|狙われ|ねらわれ|恨|うらん|うらみ|憎|にくん|にくし)') },
  // intent behind the fatal act (「わざとこぼした」「故意にぶつけた」) — 「わざと服を脱いだ」 is not caught
  { id: 'intent', re: P('(?:故意|意図的|いとてき|意図して|計画的|けいかくてき|わざと(?:じゃ|では|です|でした|だった|なの|なん|か$|$))') },
  {
    id: 'intent-act',
    re: P('(?:わざと|狙って|ねらって)(?:.{0,10})(?:殺|ころ|撒|まい|まか|ぶつけ|当て|あて|襲|閉じ込め|とじこめ|閉め|しめ|押し|おし|突き|つき|落と|おと|盛|混ぜ|まぜ|入れ|いれ|こぼ|傷つけ|きずつけ|害|止め|とめ|切っ|切ら|抜い|ぬい|外し|はずし|倒|たお|壊|こわ|投げ|なげ|飲ませ|のませ|食べさせ|たべさせ)'),
  },
  // the manner itself, named
  { id: 'manner', re: P('(?:死因の種類|しいんのしゅるい|死に方の種類)') },
];

/** First manner-of-death rule the question trips, if any (analysis; nothing is refused). */
export function detectManner(raw: string, norm: string = normalize(raw)): MannerHit | undefined {
  for (const r of RULES) if (r.re.test(norm)) return { rule: r.id };
  return undefined;
}

/* ------------------------------------------------------------------ */
/* What the question proposes                                          */
/* ------------------------------------------------------------------ */

/**
 * Who the question says did it: nobody named (「殺されたの？」「毒を盛られた？」), a generic someone
 * (「誰かに殺された？」), a named person (「同僚が犯人？」「弟のせい？」), something that is not a
 * person (「熊に殺された？」「強盗の仕業？」 — a specific hypothesis) or the victim herself
 * (「彼女はわざとこぼした？」).
 */
export type MannerAgent = 'none' | 'someone' | 'named' | 'other' | 'victim';

export interface MannerProposal {
  rule: string;
  proposes: Manner;
  agent: MannerAgent;
  /** The question denies what it names (「弟さんは悪くないですか」): answer the opposite. */
  denies?: boolean;
  /** Decides only a murder case (「間違えて摘んだ？」 is いいえ there; in an accident case it is evidence). */
  weak?: boolean;
  /**
   * The question names the manner itself (殺された・事件・犯人・事故・自殺・故意): the manner fact is
   * its card. Otherwise (「毒を盛られた？」「家族のせい？」) a ruling-out piece of evidence that says the
   * same may be shown instead (rules-judge.ts).
   */
  pure?: boolean;
  /** Span of the deciding words in the normalised text. */
  at: number;
  end: number;
}

const SOMEONE_RE = P(SOMEONE);
const NAMED_RE = P(`(?:${ROLES}|もう一人|もうひとり|その人|そのひと|あの人|あのひと|[人者隊](?:たち|達)?(?=の|が|は|に|も|から)|(?<=\\p{Script=Han})(?:さん|くん|ちゃん)|氏)`);
/** Culprit words themselves (「犯人は…」 must not read as a named person because of 人). */
const CULPRIT_WORDS = /(?:真犯人|犯人|はんにん|加害者|容疑者|下手人)/gu;
const VICTIM_RE = P(VICTIM);
/** Specific culprits: a hypothesis about WHO, not the manner (「強盗に遭った？」 is evidence). */
const SPECIFIC_CULPRIT = P('(?:強盗|ごうとう|通り魔|とおりま|暴漢|ぼうかん|変質者|へんしつしゃ|すとーかー|熊|くま|動物|どうぶつ|獣|けもの|野犬|人影|ひとかげ|幽霊|ゆうれい)');

/** The agent written before position `at` (「誰かに」「弟が」「熊に」「彼女は」). */
function agentBefore(norm: string, at: number): MannerAgent {
  const before = norm.slice(Math.max(0, at - 14), at);
  if (SOMEONE_RE.test(before)) return 'someone';
  if (SPECIFIC_CULPRIT.test(before)) return 'other';
  if (NAMED_RE.test(before)) return 'named';
  if (VICTIM_RE.test(before)) return 'victim';
  // 「窒素に殺された」「熊に」: an agent that is not a person (「小鉢に毒が混ぜられた」 names a place)
  if (/(?:に|から|によって)$/u.test(before) && before.replace(/(?:に|から|によって)$/u, '').length > 0) return 'other';
  return 'none';
}

/** The agent anywhere in the question (culprit / suspicion words: 「同僚が犯人？」「犯人は男？」). */
function agentAnywhere(norm: string): MannerAgent {
  const rest = norm.replace(CULPRIT_WORDS, '');
  if (SPECIFIC_CULPRIT.test(rest)) return 'other';
  if (SOMEONE_RE.test(rest)) return 'someone';
  if (NAMED_RE.test(rest)) return 'named';
  return 'none';
}

interface ProposalRule {
  id: string;
  re: RegExp;
  proposes: Manner;
  agent: (norm: string, at: number, end: number) => MannerAgent;
  weak?: boolean;
  pure?: boolean;
  denies?: RegExp;
  /** The rule does not apply when the question also matches this. */
  unless?: RegExp;
}

// harmful acts done on purpose (投げる is not one: 「弟はわざと投げた？」 — throwing is the game itself)
const HARM_VERB = '(?:殺|ころ|撒|まい|まか|ぶつけ|当て|あて|襲|閉じ込め|とじこめ|閉め|しめ|押し|おし|突き|つき|落と|おと|盛|混ぜ|まぜ|入れ|いれ|こぼ|傷つけ|きずつけ|害|止め|とめ|切っ|切ら|抜い|ぬい|外し|はずし|倒|たお|壊|こわ|飲ませ|のませ|食べさせ|たべさせ)';
const TAMPER_HARM = '(?:混ぜ|まぜ|盛っ|盛り(?!付|つけ)|仕込|しこん|しこみ|細工|さいく|すり替|すりか|飲ませ|のませ|食べさせ|たべさせ|閉じ込め|とじこめ|(?:毒|どく)(?:を|が)?.{0,4}(?:入れ|いれ))';
const PERSON_SUBJ = `(?:${ROLES}|もう一人|もうひとり|その人|そのひと|あの人|あのひと)(?:さん|くん|ちゃん|たち|達)?`;
const GENERIC_ACCIDENT = `(?:(?<![\\p{Script=Han}の])(?:事故|じこ)(?:死|に(?:あ|遭)|で(?:死|亡|なくな|した)|${AS_ANSWER})|(?:不慮の|偶然の|不運な|単なる|ただの|悲しい|ほんとうの|本当の)(?:事故|じこ))`;

const none = () => 'none' as const;
const before = (norm: string, at: number) => agentBefore(norm, at);

/**
 * Ordered by nothing in particular: the deciding proposal is the LAST one in the sentence (the
 * Japanese predicate comes last: 「他殺ではなく事故？」 proposes an accident, 「事故に見せかけた？」
 * a murder).
 */
const PROPOSALS: ProposalRule[] = [
  { id: 'suicide', re: P('(?:自殺|じさつ|自死|自害|自ら命|みずから(?:命|いのち)|命を絶|いのちをた|身投げ|みなげ)'), proposes: 'suicide', agent: none, pure: true },
  { id: 'staged', re: P('(?:見せかけ|みせかけ|偽装|ぎそう|装っ|よそおっ)'), proposes: 'homicide', agent: none, pure: true },
  { id: 'kill', re: P(`(?<!自)${KILL}|ころ(?:され|さな|した|して|しま|す(?:つもり|気|き)|そうと)|さつじん|さつがい|どくさつ|たさつ`), proposes: 'homicide', agent: before, pure: true },
  { id: 'attack', re: P('(?:襲撃|しゅうげき)'), proposes: 'homicide', agent: before },
  { id: 'done-to', re: P('(?:飲まされ|のまされ|食べさせられ|たべさせられ|盛られ|もられ|嗅がされ|かがされ|脱がされ|ぬがされ|剥ぎ取られ|はぎ(?:取|と)られ|押し込まれ|おしこまれ|混ぜられ|まぜられ|混入され|こんにゅうされ|仕込まれ|しこまれ|(?:毒|どく)(?:を|が)?(?:入れられ|いれられ)|(?:毒|どく)を(?:盛|も)(?:っ|ら|り(?!付|つ)))'), proposes: 'homicide', agent: before },
  { id: 'harmed-by', re: P(`(?:${SOMEONE}|誰にも|だれにも|何者にも)(?:に|から|が)?(?:.{0,4})(?:襲|おそわ|やられ|殴|なぐ|刺|さされ|突き落|つきおと|押され|おされ|閉じ込め|とじこめ|狙わ|ねらわ)`), proposes: 'homicide', agent: () => 'someone' },
  { id: 'sabotage-harm', re: P(`${SOMEONE}(?:が|は|に)(?:.{0,12})${TAMPER_HARM}`), proposes: 'homicide', agent: () => 'someone' },
  // わざと only: 「胸を狙って投げた？」 is what a catcher asks for (evidence)
  { id: 'intent-act', re: P(`わざと(?:.{0,10})${HARM_VERB}`), proposes: 'homicide', agent: before },
  { id: 'intent', re: P('(?:故意|意図的|いとてき|意図して|計画的|けいかくてき|わざと(?:じゃ|では|です|でした|だった|なの|なん|か$|$))'), proposes: 'homicide', agent: before, pure: true },
  // a culprit exists / the crime itself — generic words only; 「犯人は誰？」 never gets here (open question)
  { id: 'culprit', re: P('(?:真犯人|犯人|はんにん|犯行|はんこう|犯罪|はんざい|加害者|かがいしゃ|容疑者|ようぎしゃ|下手人|仕業|しわざ)'), proposes: 'homicide', agent: (n) => agentAnywhere(n), pure: true },
  // 「事件ですか」 — not 「警察は事件として捜査した？」 (what the police did is evidence)
  { id: 'incident', re: P(`(?:事件|じけん)(?:性|に(?:巻き込|まきこ)|${AS_ANSWER})|(?:殺人|刑事|傷害)事件`), proposes: 'homicide', agent: none, pure: true, unless: P('(?:警察|けいさつ|捜査|そうさ)') },
  { id: 'blame', re: P(`(?:${SOMEONE})(?:の|が)(?:せい|所為|やった|やりました|しわざ|仕業)`), proposes: 'homicide', agent: () => 'someone' },
  {
    id: 'blame-person',
    re: P(`(?:[人者隊]|${ROLES}|子ども|子供|こども)(?:さん|くん|ちゃん|たち|達)?(?:の(?:せい|所為)|(?:は|が|も)(?:悪|わる)(?:い|く|かっ))`),
    proposes: 'homicide',
    agent: () => 'named',
    denies: P('(?:悪|わる)く(?:な(?:い|かった|さそう)|ありません)'),
  },
  { id: 'responsibility', re: P(`${PERSON_SUBJ}(?:に|の)責任(?!者)|${PERSON_SUBJ}を責め`), proposes: 'homicide', agent: () => 'named' },
  { id: 'assault-named', re: P(`${PERSON_SUBJ}(?:に|から|が|は)(?:.{0,6})(?:殴|突き飛ば|つきとば|押し倒|おしたお|襲|刺し|刺さ|手を出|首を絞|絞め|蹴)`), proposes: 'homicide', agent: () => 'named' },
  { id: 'suspect', re: P(`(?:${SOMEONE}|${PERSON_SUBJ})(?:が|は|も)?(?:.{0,4})(?:怪し|あやし|疑わし|うたがわし|不審)`), proposes: 'homicide', agent: (n) => agentAnywhere(n) },
  { id: 'did-it', re: P(`(?:${SOMEONE}|${PERSON_SUBJ})(?:が|は)(?:やった|やりました|やったん|やったの)`), proposes: 'homicide', agent: (n) => agentAnywhere(n) },
  { id: 'tamper-named', re: P(`${PERSON_SUBJ}(?:が|は)(?:[^がは]{0,14})${TAMPER_HARM}`), proposes: 'homicide', agent: () => 'named' },
  { id: 'accident', re: P(GENERIC_ACCIDENT), proposes: 'accident', agent: none, pure: true },
  { id: 'chance', re: P('(?:偶然|ぐうぜん|たまたま)(?:です|でした|だった|なの|なん|か$|$|じゃ|では)'), proposes: 'accident', agent: none, pure: true },
  // the accident in other words — only decides a murder case (in an accident case 「間違えて開けた？」 is evidence)
  {
    id: 'mistake',
    re: P('(?:採り違え|採りちがえ|取り違え|取りちがえ|とりちがえ|摘み違え|つみちがえ|誤食|ごしょく|誤って|あやまって|間違って|まちがって|(?:見|み)?(?:間違|まちが)え(?:て|た|まし)|勘違いして|かんちがいして|うっかり)'),
    proposes: 'accident',
    agent: none,
    weak: true,
  },
];

/**
 * The kind of death a manner question proposes (see MannerProposal), or undefined when it does
 * not propose one that the case's manner alone can decide (involvement, motive, arrest, a third
 * party's neutral act such as 「誰かが扉を閉めた？」 — those are evidence). Only questions that
 * detectManner catches are considered.
 */
export function mannerProposal(raw: string, norm: string = normalize(raw)): MannerProposal | undefined {
  if (!detectManner(raw, norm)) return undefined;
  let best: MannerProposal | undefined;
  for (const r of PROPOSALS) {
    if (r.unless?.test(norm)) continue;
    const g = new RegExp(r.re.source, 'gu');
    for (const m of norm.matchAll(g)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      if (best && end <= best.end) continue;
      let agent = r.agent(norm, at, end);
      let proposes = r.proposes;
      if (agent === 'victim') {
        // the victim doing it on purpose (「彼女はわざとこぼした？」) proposes a suicide, not a murder;
        // as the one it was done to (「彼女は毒を盛られた？」「彼女は殺された？」) she is not the agent
        if (r.id === 'intent' || r.id === 'intent-act') proposes = 'suicide';
        else agent = 'none';
      }
      best = { rule: r.id, proposes, agent, at, end, ...(r.weak ? { weak: true } : {}), ...(r.pure ? { pure: true } : {}), ...(r.denies?.test(norm) ? { denies: true } : {}) };
    }
  }
  return best;
}

/**
 * Whether the proposal is true for a case whose death was `manner`; undefined when the manner
 * alone does not decide it (which named person did it; a mix-up in an accident case).
 */
export function proposalHolds(p: MannerProposal, manner: Manner): boolean | undefined {
  if (p.proposes === 'suicide') return manner === 'suicide';
  if (p.proposes === 'accident') {
    if (p.weak && manner !== 'homicide') return undefined;
    return manner === 'accident';
  }
  // homicide: nobody killed, harmed or is to blame for a death that was not a murder
  if (manner !== 'homicide') return false;
  return p.agent === 'none' || p.agent === 'someone' ? true : undefined;
}
