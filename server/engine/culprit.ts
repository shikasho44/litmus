/**
 * Culprit seal — the one kind of question still not answered during the investigation (2026-09-28).
 *
 * Murder / accident / suicide questions are answered truthfully (manner.ts, docs/decisions.md).
 * But in a case whose verdict asks the player to NAME who did it (CASE 04: the culprit is one of
 * the three people at the table), yes/no questions would let the player eliminate the suspects
 * one by one. Such a case opts in with `truth.culpritSeal` (shared/case-schema.ts); then a question
 * that identifies the culprit gets 'cannot' (meta 'culprit', Holma's meta.culprit lines: naming
 * the culprit is for the verdict — ask about the evidence instead). No model is consulted.
 *
 * Sealed (opted-in cases only):
 *   who        「犯人は誰？」「誰がやったの？」「誰のせい？」「毒を入れたのは誰？」「混ぜたのは編集者？」
 *   identity   anything about the culprit except whether one exists: 「犯人は編集者？」「犯人は女性？」
 *   named-*    a named person's part in the crime: mixed / put poison in / procured the poison /
 *              killed / did it / fault / suspicious or innocent / involved / motive —
 *              「編集者が小鉢に混ぜた？」「老人が毒を入れたの？」「編集者のせい？」「老人は怪しい？」
 *              「友人は関係ある？」「編集者は彼女を恨んでいた？」
 * Answered:  the manner with nobody named (「殺されたの？」「誰かが毒を混ぜたの？」「犯人はいますか？」
 *            「事故に見せかけた？」) and evidence about named people (「編集者が盛り付けをしましたか？」
 *            「老人はおひたしを食べましたか？」「編集者ははさみを持っていた？」「編集者の証言は本当？」).
 *
 * People are the generic role words of manner.ts (編集者・老人・友人・男・女性 …) plus the case's own
 * `truth.culpritSeal.people` (nicknames and names: お隣・幼なじみ・看護師 …). The victim is never one.
 * Runs in the rules judge after the victim-name guard and before authored probes (rules-judge.ts);
 * the safety filter (safety.ts) runs before all of it. Pure TS, also used by the static build.
 */
import { normalize } from './normalize.js';
import { ROLES } from './manner.js';

export interface CulpritHit {
  rule: string;
}

export interface CulpritSeal {
  /** Normalised extra person words of the case. */
  people: string[];
  rules: { id: string; re: RegExp }[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const P = (s: string) => new RegExp(s, 'u');

const CULPRIT_WORD = '(?:真犯人|犯人|はんにん|加害者|かがいしゃ|容疑者|ようぎしゃ|下手人|げしゅにん|黒幕|くろまく)';
/** 「犯人はいますか」「犯人がいるの？」 — whether a culprit exists is the manner, answered. */
const EXISTENCE = P(`${CULPRIT_WORD}(?:は|が|って|も)?(?:いる|いま|いた|いな|居|存在|おる|おり)`);
const VICTIM = '(?:彼女|かのじょ|本人|ほんにん|自分|じぶん|被害者|ひがいしゃ|じぇーん)';
/**
 * Acts of the crime. Plating is evidence (「編集者が盛り付けをした？」「おひたしを盛ったのは編集者？」
 * are answered), so 盛る / 入れる only count with the poison as their object.
 */
const POISON = '(?:毒|どく|毒草|どくそう|とりかぶと|葉)';
const CRIME_ACT =
  '(?:混ぜ|まぜ|混入|こんにゅう|仕込|しこん|しこみ|細工|さいく|すり替|すりか|殺(?!虫|菌|鼠|風景)|ころ(?:し|さ|す)|手にかけ|' +
  `${POISON}(?:を|が|の)?.{0,6}(?:入れ|いれ|盛|も[っりら]|摘|つん|つみ|採|取っ|とっ|切っ|切り|きっ|きり|持ち|持っ|もち|用意|手に入|渡|わた|食べさせ|たべさせ|飲ませ|のませ)|` +
  '(?:小鉢|こばち|器|うつわ|おひたし|料理|りょうり|鍋|なべ|皿|さら|食べ物|たべもの).{0,6}(?:混ぜ|まぜ))';
const DONE_BY = '(?:殺さ|ころさ|盛られ|もられ|飲まされ|のまされ|食べさせられ|たべさせられ|混ぜられ|まぜられ|殴|なぐ|襲|おそわ)';

function compileRules(people: readonly string[]): { id: string; re: RegExp }[] {
  const extra = [...people].sort((a, b) => b.length - a.length).map(escape).join('|');
  const PERSON = `(?:${ROLES}${extra ? `|${extra}` : ''})(?:さん|くん|ちゃん|たち|達|の人|のひと|の方)?`;
  return [
    // who did it
    { id: 'who', re: P(`(?:誰|だれ|何者|なにもの|どの人|どのひと|どっち|どちら)(?:が|の)(?:.{0,12})(?:やっ|やり|殺(?!虫|菌)|ころ|混ぜ|まぜ|仕込|しこ|せい|所為|しわざ|仕業|犯人|はんにん|${POISON})`) },
    { id: 'who', re: P(`${CULPRIT_WORD}(?:は|って|が|の(?:名前|なまえ|正体|しょうたい))?(?:.{0,4})(?:誰|だれ|何者|なにもの|どの|どっち|どちら|教え|おしえ)`) },
    // 「毒を入れたのは誰？」「混ぜたのは編集者ですか」 — unless it names the victim (evidence / the manner)
    {
      id: 'who',
      re: P(`(?:混ぜ|まぜ|仕込ん|しこん|やっ|殺し|ころし|${POISON}(?:を)?(?:.{0,6})(?:入れ|いれ|盛っ|もっ|切っ|きっ|摘ん|つん|採っ|とっ|取っ|持ってき|もってき))(?:た|だ)(?:の|人|ひと)(?:は|って|が)(?!${VICTIM})`),
    },
    // a culprit named or described (whether one exists is answered — see EXISTENCE)
    { id: 'identity', re: P(`${CULPRIT_WORD}`) },
    // a named person's part in the crime
    { id: 'named-act', re: P(`${PERSON}(?:が|は|も|って|に)?(?:.{0,16}?)${CRIME_ACT}`) },
    { id: 'named-done-by', re: P(`${PERSON}(?:に|から)(?:.{0,8})${DONE_BY}`) },
    { id: 'named-blame', re: P(`${PERSON}(?:の(?:せい|所為|仕業|しわざ)|(?:が|は|も)(?:悪|わる)(?:い|く|かっ)|(?:に|の)責任|を責め|(?:が|は)(?:やった|やりました|やったん|やったの))`) },
    { id: 'named-suspect', re: P(`${PERSON}(?:が|は|も|を)?(?:.{0,6})(?:怪し|あやし|疑わし|うたがわし|疑う|うたがう|疑っ|うたがっ|不審|無実|むじつ|潔白|けっぱく|疑いが晴|うたがいがはれ)`) },
    {
      id: 'named-involved',
      re: P(`${PERSON}(?:が|は|も|って)?(?:(?:この件|事件|じけん|事故|じこ|死|彼女の死|それ|毒|どく)に)?(?:関係(?:し|あ|が(?:あ|な)|な)|関わ|かかわ|関与|かんよ|絡ん|からん)`),
    },
    { id: 'named-motive', re: P(`${PERSON}(?:.{0,12})(?:恨|うらみ|うらん|憎|にくし|にくん|殺意|さつい|動機|狙っ|ねらっ|邪魔|じゃま)`) },
  ];
}

/** Compiles a case's culprit seal (`truth.culpritSeal`) for the rules judge. */
export function compileCulpritSeal(seal: { people?: readonly string[] }): CulpritSeal {
  const people = [...new Set((seal.people ?? []).map((p) => normalize(p)).filter((p) => p.length > 0))];
  return { people, rules: compileRules(people) };
}

/** The first seal rule an identifying question trips, if any. */
export function detectCulprit(raw: string, seal: CulpritSeal, norm: string = normalize(raw)): CulpritHit | undefined {
  for (const r of seal.rules) {
    if (!r.re.test(norm)) continue;
    if (r.id === 'identity' && EXISTENCE.test(norm)) continue;
    return { rule: r.id };
  }
  return undefined;
}
