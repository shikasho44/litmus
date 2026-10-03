/**
 * Safety filter (release blocker). Runs on every ask BEFORE probes, judges and models.
 *
 * Detects questions that seek to die / to kill / a lethal dose or time, or that disclose a wish
 * to die. Such a turn is answered with a calm, serious fixed line (Holma does not joke here),
 * `answerClass: 'cannot'`, notice 'support' (the UI shows the consultation card), nothing
 * unlocks, and the question is never sent to a model. Model judges can raise the same response
 * through `JudgeDecision.flags.selfHarm ≥ SELF_HARM_FLAG`.
 *
 * Patterns run on the matching form (normalize(): NFKC, lower case, katakana → hiragana,
 * punctuation removed). They are written to stay silent on ordinary case questions about the
 * victim (「自殺ですか」「毒で死んだ？」「苦しまずに亡くなった？」「窒素は関係ありますか」):
 * past tense, the victim as subject and plain topic words never trigger on their own; the
 * triggers are potential forms (死ねる / 殺せる), method / dose / time words, first-person wishes
 * and "use X for dying" constructions. tests/engine/safety.test.ts runs every authored probe of
 * every real case through the filter.
 *
 * Pure (no Node APIs) — also runs in the embedded browser build.
 */
import { normalize } from './normalize.js';

export type SafetyKind = 'selfHarm' | 'method' | 'harmOthers';

export interface SafetyHit {
  kind: SafetyKind | 'model';
  /** Rule id (traces / tuning). Never the matched text. */
  rule: string;
}

/** `JudgeDecision.flags.selfHarm` at or above this is treated exactly like a rules hit. */
export const SELF_HARM_FLAG = 0.5;

// Death words that are NOT past tense and not about "the death" as a topic:
// 死ね(る) · 死ぬ · 死な(せ) · 死にたい · 死に方 · しね(る/ます) · 自殺 · 安楽死 · 殺す/殺せ/殺し方 · 命を絶つ
const DEATH_ACT =
  '(?:死(?:ね|ぬ|な[せさ]|に(?:たい|方|かた|ます|ません))|(?:^|[でにとらばもてがはを])しね(?:る|ます)|自殺|じさつ|自死|安楽死|あんらくし|人殺し|ひとごろし|(?:殺|ころ)(?:す|せ|し(?:たい|方|かた))|命を(?:絶|断|奪)|いのちを(?:たつ|たて|うば))';

const P = (s: string) => new RegExp(s, 'u');

interface Rule {
  id: string;
  kind: SafetyKind;
  re: RegExp;
}

const RULES: Rule[] = [
  /* ── wish to die / self-harm disclosure (first person, present) ─────────────────────── */
  // 「死にたい」 but not reported speech about someone else (「死にたいと言っていた」)
  { id: 'want-die', kind: 'selfHarm', re: P('(?:死|し)にたい(?!と(?:言|い[っうわ]|話|はな|書|か[いか]|漏|も[られ]|口|くち|つぶや|呟)|って(?:言|い[っうわ]))') },
  { id: 'want-die-2', kind: 'selfHarm', re: P('(?:死|し)にたく(?:なる|なります|てたまら|て仕方|てしかた)|(?:死|し)んでしまいたい|(?:死|し)んでやる|(?:死|し)ぬしかな|(?:死|し)んだ(?:方|ほう)が(?:まし|いい|楽|らく)|(?:死|し)のう(?:かな|か|と(?:思|おも)(?:う|って(?:る|います|いる)))$') },
  { id: 'want-vanish', kind: 'selfHarm', re: P('(?:消|き)えたい|いなくなりたい|(?:生|い)きて(?:い)?たくな|(?:生|い)きたくな|(?:生|い)きる(?:の|こと)が(?:つら|辛|しんど|嫌|いや|苦し|くるし)|(?:生|い)き(?:る|てる|ている)(?:意味|いみ)(?:が|は|も)?(?:な|無|わから|分から)|(?:楽|らく)になりたい') },
  { id: 'want-suicide', kind: 'selfHarm', re: P('(?:自殺|じさつ|自死)(?:したい|しよう(?:か|かな|と(?:思|おも)(?:う|って(?:る|います|いる)))|を考え|をかんがえ|願望|がんぼう)|自傷(?:したい|が(?:やめ|止め))|りすか|りすとかっと|おーばーどーず|(?:^|[^a-z])od(?:したい|しよう)|首(?:を)?(?:吊|つ)り(?:たい|方|かた|の方法|のやり方)|首(?:を)?(?:吊|つ)ろう|飛び降り(?:たい|よう)|とびおり(?:たい|よう)') },

  /* ── method seeking: can one die / how / how much / how fast ─────────────────────────── */
  // potential 「死ねる」: 「ちっそで死ねる？」「窒素吸ったら楽に死ねる？」
  { id: 'can-die', kind: 'method', re: P('死ね(?:る|ます|ません)|(?:^|[でにとらばもてがはを])しね(?:る|ます)') },
  // 「死に方」 (not 「彼女の死に方」), 「死ぬ方法」, 「死ぬのは楽？」
  { id: 'how-die', kind: 'method', re: P('(?<!(?:(?:彼女|かのじょ|被害者|ひがいしゃ|じぇーん|この人|このひと|その人|そのひと|姉|あね|妹|いもうと|本人|ほんにん)の|この|その|あの|同じ|おなじ))(?:死|し)に(?:方|かた)(?!む|(?:は|って)?(?:です|でした|だった|だ|でしょう|じゃ|では))|(?:死|し)ぬ(?:方法|ほうほう|手段|しゅだん|やり方|やりかた|ための|には|のに(?:必要|ひつよう|十分|じゅうぶん|使|つか|最適|さいてき|向|む|いい|よい))|(?:死|し)ぬの(?:は|って|も)(?:楽|らく|苦しくな|くるしくな|痛くな|いたくな|怖くな|こわくな|簡単|かんたん|一瞬|いっしゅん)') },
  // 「凍死は楽な死に方ですか」「痛くない死に方はありますか」 (not the victim's, past: 「穏やかな死に方でしたか」)
  { id: 'easy-death', kind: 'method', re: P('(?:楽|らく|苦しくない|くるしくない|苦しまない|くるしまない|痛くない|いたくない|安らか|やすらか|穏やか|おだやか|きれい|綺麗|簡単|かんたん|確実|かくじつ)な?(?:死|し)に(?:方|かた)(?!(?:は|って)?(?:でした|だった))') },
  { id: 'die-easily', kind: 'method', re: P('(?:楽|らく|苦しまず|くるしまず|苦しまない|くるしまない|痛くなく|いたくなく|痛くない|いたくない|眠るよう|ねむるよう|安らか|やすらか|確実|かくじつ|簡単|かんたん|一瞬|いっしゅん)(?:に|で)?(?:死|し)(?:ぬ(?:方法|ほうほう|には|ため|の(?:は|って)|(?:の|ん)?(?:です|でしょう)?(?:か)?$)|にたい|に方|にかた|にます)') },
  { id: 'lethal-dose', kind: 'method', re: P('致死(?:量|濃度|時間|的な?(?:量|濃度))|ちしりょう') },
  // 「何分で死にますか」「何リットルで危険」 — non-past only (「何秒で倒れた？」 is a question about the victim)
  { id: 'how-fast', kind: 'method', re: P('(?:何|なん)(?:分|ぷん|ふん|秒|びょう|時間|じかん|りっとる|ml|cc|ぐらむ|mg|ぱーせんと|ppm|きろ|km)(?:くらい|ぐらい|ほど|間|かん)?(?:で|吸|すっ|すう|すえ|浴び|あび|飲|のん|のめ)[^死]{0,6}?(?:死(?:ぬ|ね|に(?:ます|ません)|する|します)|し[ぬね]|亡くな(?:る|り)|なくな(?:る|り)|危険|きけん)') },
  // 「何時間はさまれたら死ぬ？」「2時間はさまれると危ない？」「何キロ乗ったら心臓が止まる？」 — a lethal time / weight
  // asked as a condition (2026-10-04, the prototype c09). Past questions about the victim stay quiet
  // (「何時間もはさまれていましたか？」「何秒で倒れた？」 have no condition + dying / danger word).
  { id: 'how-long-if', kind: 'method', re: P('(?:何|なん|[0-9]+)(?:分|ぷん|ふん|秒|びょう|時間|じかん|日|にち|きろ|kg|とん|ぐらむ|mg)(?:くらい|ぐらい|ほど|以上|いじょう|も)?[^。死亡]{0,10}?(?:たら|れば|ると)[^。死]{0,6}?(?:死(?:ぬ|ね|に(?:ます|ません)|する|します)|し[ぬね]|亡くな(?:る|り)|なくな(?:る|り)|危険|きけん|危な|あぶな|止まる|とまる|止まります|とまります)') },
  { id: 'how-much', kind: 'method', re: P('(?:どの|どれ)(?:くらい|ぐらい|だけ)(?:の(?:量|時間|濃度|間)|で|吸|すっ|すう|すえ|浴び|あび|飲|のん|のめ|入れ|いれ|いれば|あれば|すると|したら|たら|経つと|たつと)[^死亡]{0,6}?(?:死(?:ぬ|ね|に(?:ます|ません))|し[ぬね]|亡くな(?:る|り)|なくな(?:る|り)|致死|ちし)') },
  { id: 'how-much-if', kind: 'method', re: P('(?:どの|どれ)(?:くらい|ぐらい|だけ)[^。]{0,12}?(?:れば|えば|たら|ると|すれば)[^。]{0,8}?(?:死(?:ぬ|ね|に(?:ます|ません)|する|します)|しぬ|しね|止まる|止まります|とまる|とまります)') },
  // 「凍死する方法」「心臓震盪を起こす方法」「人を凍死させる方法」
  { id: 'cause-method', kind: 'method', re: P('死(?:する|させる|させられる|できる)(?:方法|ほうほう|やり方|やりかた|手段|しゅだん|には)|(?:起こす|おこす|起こさせる|おこさせる|引き起こす|ひきおこす)(?:方法|ほうほう|やり方|やりかた|手段|しゅだん|には)') },
  { id: 'suicide-use', kind: 'method', re: P('(?:自殺|じさつ|自死)(?:に|で|の|を|が|って|は)?(?:使|つか|でき|出来|する方法|する手段|のための|の方法|のほうほう|の仕方|のやり方|向|むき|最適|さいてき|適し|てきし|一番|いちばん)|(?:安楽死|あんらくし)(?:に|で|の|を|が|って|は)?(?:使|つか|でき|出来|させ|する方法|の方法|したい)') },
  // 「液体窒素で死にますか」「窒素で死ぬ？」 — generic "does X kill (you)" in the present tense
  { id: 'die-by', kind: 'method', re: P('(?:で|を使えば|を使って|があれば)(?:人は|ひとは|人が|ひとが|すぐ|すぐに|本当に|ほんとうに|確実に|本当|ほんと)?(?:死|し)(?:ぬ(?:の|ん)?(?:です|でしょう)?(?:か)?$|にます(?:か)?$)') },
  // 「吸ったら死ぬ？」「飲めば死ねる」 — self-applied exposure + conditional + dying (non-past)
  { id: 'exposure', kind: 'method', re: P('(?:吸(?:えば|ったら|うと|い込めば|い込んだら|いこめば|いこんだら)|すえば|すったら|すうと|飲(?:めば|んだら|むと|み込めば|みこめば)|のめば|のんだら|のむと|浴び(?:れば|たら|ると)|あび(?:れば|たら|ると)|嗅(?:げば|いだら|ぐと)|かげば|かいだら|注射(?:すれば|したら|すると)|食べ(?:れば|たら|ると)|たべ(?:れば|たら|ると)|かぶ(?:れば|ったら|ると))[^死]{0,8}?(?:死(?:ぬ|ね|に(?:ます|ません))|しぬ|しね(?:る|ます))') },
  // 「同じ方法で死ねる？」「真似したら死ぬ？」 — imitation + an act of dying / killing
  { id: 'imitate', kind: 'method', re: P(`(?:同じ|おなじ)(?:方法|ほうほう|やり方|やりかた|手口|てぐち)[^。]{0,12}?${DEATH_ACT}|(?:真似|まね|再現|さいげん)(?:し|す|でき|を)[^。]{0,12}?${DEATH_ACT}`) },
  // 「…に使える」 with an act of dying / killing anywhere in the question
  { id: 'use-for', kind: 'method', re: P(`${DEATH_ACT}[^。]{0,14}?(?:に|のに|ために|には)(?:使|つか)(?:え|う|わ|い)|(?:に|のに|ために)(?:使|つか)(?:え|う)[^。]{0,14}?${DEATH_ACT}`) },

  /* ── harming others ──────────────────────────────────────────────────────────────────── */
  { id: 'kill-how', kind: 'harmOthers', re: P('(?:殺|(?<![とこごどもうよそおほ])ころ)(?:し方|しかた|す方法|すほうほう|す手段|すやり方|すには|すのに(?:使|つか|必要|十分|最適|向|いい)|せる|せます|せない|せません|したい|してやりたい|してやる|してみたい)|人殺し(?:の方法|のやり方|がしたい|したい)') },
  { id: 'kill-someone', kind: 'harmOthers', re: P('(?:人|ひと|誰か|だれか|他人|たにん|あいつ|やつ)を(?:殺|ころ)(?!され|さ(?:れ|せ)|した|しま|して)') },
  { id: 'hurt-someone', kind: 'harmOthers', re: P('(?:人|ひと|誰か|だれか|他人|たにん)を(?:傷つけ|きずつけ)(?:たい|る方法|るには|られる)|(?:傷つけ|きずつけ)る(?:方法|ほうほう|やり方)|毒(?:を)?(?:盛|入れ|いれ)(?:る方法|るには|りたい|たい|るやり方)|毒殺(?:する|の)?(?:方法|やり方|仕方|したい)|完全犯罪(?:の|を)?(?:方法|やり方|仕方|したい|でき)|(?:気づかれ|きづかれ|ばれ)(?:ずに|ないで|ないように)[^。]{0,8}?(?:殺|ころ|死なせ|しなせ)') },
  { id: 'stop-heart', kind: 'harmOthers', re: P('(?:心臓|しんぞう|心拍|鼓動|こどう)を(?:止め|とめ)(?:られ(?:る|ます)|る(?:方法|ほうほう|やり方|やりかた|には|手段))|(?:狙|ねら)(?:えば|ったら|うと)[^。]{0,10}?(?:止ま|とま|死(?:ぬ|ね|に)|しぬ|殺|ころ)') },
  // 「わざと心臓震盪を起こせますか」 — deliberately causing it, potential form at the end
  { id: 'cause-deliberately', kind: 'harmOthers', re: P('(?:わざと|故意に|意図的に|狙って|ねらって)[^。]{0,14}?(?:起こせ|おこせ|起こさせ|おこさせ|させられ|引き起こせ|ひきおこせ)(?:る|ます)?(?:の|ん)?(?:です)?(?:か)?$') },
];

/**
 * Checks one atomic question (or a whole message). Returns the first matching rule, or
 * undefined. `norm` may be passed when the caller already normalised the text.
 */
export function detectSafety(raw: string, norm: string = normalize(raw)): SafetyHit | undefined {
  if (!norm) return undefined;
  for (const r of RULES) if (r.re.test(norm)) return { kind: r.kind, rule: r.id };
  return undefined;
}

/** True when a model judge flagged the question as self-harm / harming others. */
export function flaggedByModel(flags: { selfHarm?: number } | undefined): boolean {
  return typeof flags?.selfHarm === 'number' && Number.isFinite(flags.selfHarm) && flags.selfHarm >= SELF_HARM_FLAG;
}

/**
 * Fixed lines, Holma's voice but serious (no teasing, no 「ェ」, no laughter). Never case
 * specific. The UI shows the consultation card next to them (notice 'support').
 */
export const SAFETY_LINES: Record<SafetyKind, string> = {
  selfHarm:
    '……審問官。その言葉だけは、聞き流せません。もしあなた自身がつらい思いを抱えているなら、どうか一人で抱えこまず、相談窓口を頼ってください。あなたの話を聴く人は、必ずいます。',
  method:
    '……その問いには、お答えできません。ここは、失われた方の死を正しく知るための場所です。もしあなた自身がつらい思いを抱えているなら、どうか一人で抱えこまず、相談窓口を頼ってください。',
  harmOthers:
    '……その問いには、お答えできません。ここは、失われた方の死を正しく知るための場所です。誰かを傷つけるための知恵は、この部屋にはありません。もしあなた自身がつらい思いを抱えているなら、どうか一人で抱えこまず、相談窓口を頼ってください。',
};

export function safetyLine(hit: SafetyHit): string {
  return SAFETY_LINES[hit.kind === 'model' ? 'method' : hit.kind];
}
