/**
 * Text normalisation for free-typed Japanese questions.
 *
 * Pure functions, no Node APIs (runs in the browser for the embedded build).
 * The original text is always kept for display; the normalised form is only used
 * for matching (keywords, probes, verdict keyword groups).
 */

/** Katakana → hiragana (ァ..ヶ, ヽヾ). The long-vowel mark ー is kept as is. */
export function kataToHira(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x30a1 && c <= 0x30f6) || c === 0x30fd || c === 0x30fe) out += String.fromCodePoint(c - 0x60);
    else out += ch;
  }
  return out;
}

// Punctuation, symbols, separators, control/format chars, emoji and variation selectors.
// ー (U+30FC) and 々 (U+3005) are letters (Lm) and survive.
const NOISE = /[\p{P}\p{S}\p{Z}\p{C}\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{20E3}]+/gu;

/**
 * Canonical matching form: NFKC (full/half width, compatibility chars), lowercase,
 * katakana → hiragana, and all punctuation / emoji / whitespace removed.
 */
export function normalize(s: string): string {
  if (!s) return '';
  return kataToHira(s.normalize('NFKC').toLowerCase()).replace(NOISE, '');
}

/** Normalises a noise span / display string lightly (NFKC + trim), keeping punctuation. */
export function softNormalize(s: string): string {
  return (s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

// Sentence-final politeness that carries no meaning for matching. Negation is kept.
const POLITE_TAIL = /(?:ん)?(?:です|ます|ました|でした|だった|だ|でしょう|でしょ|だろう|だろ)?(?:か|かな|かね|かしら|の|よね|よな|ね|よ)?$/u;
// Leading subject that almost every question shares ("彼女は…") — removed so it does not
// inflate similarity between unrelated questions.
const COMMON_SUBJECT = /^(?:その|この)?(?:彼女|かのじょ|じぇーんどぅ|じぇーん|被害者|ひがいしゃ|死者|ししゃ|この人|このひと|その人|そのひと|あの人|あのひと)(?:は|が|の|って|も|を|に)?/u;

/** Matching core: normalised, common subject and polite tail stripped. */
export function coreForm(norm: string): string {
  const stripped = norm.replace(COMMON_SUBJECT, '').replace(POLITE_TAIL, '');
  return stripped.length > 0 ? stripped : norm;
}

/* ------------------------------------------------------------------ */
/* Question analysis                                                    */
/* ------------------------------------------------------------------ */

const NEG_CONFIRM: RegExp[] = [
  // …じゃないですよね / ではないよね / ではありませんよね / じゃなかったよね
  /(?:じゃ|では|でわ|じゃあ)(?:ない|なかった|ありません|ありませんでした)(?:ん)?(?:です|でした|だった)?(?:よね|よな|でしょう|でしょ|だよね|よ|ね)$/u,
  // …なかったよね / 来てないですよね / 使われていませんよね
  /(?:ない|なかった|ません|ませんでした)(?:ん)?(?:です|でした|だ)?(?:よね|よな|でしょう|でしょ)$/u,
];

/** "It is NOT X, right?" style confirmation. Answer polarity must be flipped. */
export function isNegatedConfirmation(norm: string): boolean {
  return NEG_CONFIRM.some((re) => re.test(norm));
}

/** Removes the negated-confirmation tail (「止まっていなかったよね」→「止まってい」). */
export function stripNegatedConfirmation(norm: string): string {
  for (const re of NEG_CONFIRM) if (re.test(norm)) return norm.replace(re, '');
  return norm;
}

/* ------------------------------------------------------------------ */
/* Predicate polarity                                                  */
/* ------------------------------------------------------------------ */

/**
 * Polarity of the proposition a question / fact states: 'pos' = works, exists, is on, more;
 * 'neg' = stopped, absent, off, less — including grammatical negation and double negation
 * (「止まっていない」 → pos). Lets the rules judge answer 「換気は止まっていましたか」 against
 * a fact saying the fan 「止まっていた」 without relying on the author's topic polarity
 * (fact.ifAsked), and flip probe near-misses such as 「回っていましたか」 vs 「止まっていましたか」.
 */
const POS_STEMS = [
  '動い', '動作し', '作動し', '稼働', '回っ', '回転し', '鳴っ', '鳴り', '鳴る', '点い', '点灯', '開い', '開け', '開放',
  '正常', '十分', '足りて', '足りる', '満たん', '満杯', '多か', '多い', '増え', '増加', '上が', '機能し', '効い', '残っ',
  '入って', '入れ', '使っ', '使わ', '使い',
];
const NEG_STEMS = [
  '止ま', '止め', '止っ', '停止', '切れ', '消え', '消し', '壊れ', 'こわれ', '故障', '閉ま', '閉じ', '閉め', '塞', 'ふさが',
  '不足', '低下', '下が', '減っ', '減少', '少な', '薄か', '薄く', '薄い', '薄ま', '薄れ', '空っぽ', 'からっぽ', 'ぜろ', '無かっ', '無い', '無く', '無し', 'なし',
];
const NEGATION_AFTER = /^(?:[ってでいおられ]{0,4})(?:な(?:い|かっ|く|さ)|ず|ませ|ねー|ねえ)/u;
const BARE_NEGATION = 'な(?:い|かった|く)|ません|おらず|せず|ず$';
const POLARITY_RE = new RegExp(`(${POS_STEMS.join('|')})|(${NEG_STEMS.join('|')})|(${BARE_NEGATION})`, 'gu');
// 「毒ではないですか」「変なにおいはなかったですか」 ask about the affirmative (rhetorical negative).
const RHETORICAL_NEG_TAIL = /(?:(?:では|じゃ|でわ)(?:ない|なかった)(?:です|でした)?(?:か|かな|かね)?|(?:ない|なかった)(?:です|でした)(?:か|かな|かね)|(?:ない|なかった)(?:か|かな|かね))$/u;

export type Polarity = 'pos' | 'neg';

/** One predicate found in a text: its polarity and whether it came from a state stem. */
export interface PolarityMark {
  polarity: Polarity;
  /** true = a state stem (止まる/動く/…, possibly negated); false = bare grammatical negation. */
  stem: boolean;
}

export function polarityMarks(norm: string): PolarityMark[] {
  const out: PolarityMark[] = [];
  let consumedUntil = -1;
  for (const m of norm.matchAll(POLARITY_RE)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (m[3]) {
      if (at < consumedUntil) continue; // negation already applied to the stem before it
      out.push({ polarity: 'neg', stem: false });
      continue;
    }
    const neg = NEGATION_AFTER.exec(norm.slice(end, end + 8));
    if (neg) consumedUntil = end + neg[0].length;
    const base: Polarity = m[1] ? 'pos' : 'neg';
    out.push({ polarity: neg ? (base === 'pos' ? 'neg' : 'pos') : base, stem: true });
  }
  return out;
}

export function polarities(norm: string): Polarity[] {
  return polarityMarks(norm).map((m) => m.polarity);
}

export interface Proposition {
  polarity: Polarity;
  /**
   * The main predicate is a state stem, so the question can be compared with a fact's
   * state polarity (「換気は止まっていましたか」). Bare negations (「酸欠ではないですよね」)
   * and causal questions are not comparable.
   */
  determinate: boolean;
}

// Causal questions (「〜のせいですか」「〜だからですか」) propose a reason, not a state.
const CAUSAL = /(?:せい|から(?:です|でした)?(?:か|かな)?$|ため|原因|げんいん|理由|りゆう)/u;

/**
 * Polarity of what a question proposes: the main (last) predicate of its last clause.
 * Takes the RAW text so clause commas are still visible.
 */
export function questionProposition(raw: string): Proposition {
  const norm = normalize(raw);
  const clauses = (raw ?? '').split(/[、,，]/u).map(normalize).filter(Boolean);
  const last = clauses[clauses.length - 1] ?? norm;
  const negated = isNegatedConfirmation(norm);
  const t = negated ? last : last.replace(RHETORICAL_NEG_TAIL, '');
  const marks = polarityMarks(t);
  const main = marks[marks.length - 1];
  const polarity = main?.polarity ?? (negated ? 'neg' : 'pos');
  return { polarity, determinate: !!main && main.stem && !CAUSAL.test(norm) };
}

/** Polarity of a fact statement — only when every predicate agrees and at least one is a state stem. */
export function statementPolarity(norm: string): Polarity | undefined {
  const m = polarityMarks(norm);
  if (m.length === 0 || !m.some((x) => x.stem)) return undefined;
  return m.every((x) => x.polarity === m[0].polarity) ? m[0].polarity : undefined;
}

// Open (wh-) questions. Indefinites (何か/誰か/どこか/いつか…) are yes/no questions.
const OPEN_Q = new RegExp(
  [
    'なぜ(?!か)', '何故(?!か)', 'なんで', 'どうして', 'どうやって', 'どうすれば', 'どのよう', 'どんな', 'どういう',
    'どうだった', 'どうなった', 'どうなって', 'どうした', 'どう思', 'どうです', 'どうでした', 'どうでしょう', 'どうなの', 'どうなん', '(?<![ぶこそあ])どう$',
    'どれくらい', 'どれぐらい', 'どのくらい', 'どのぐらい', 'いくつ', 'いくら',
    '何(?!か|も|らか|とか|とも|気|度も|回も|人か|個か|者か|にも)', 'なに(?!か|も|げ|より|にも)', 'なんの', 'なんじ', 'なんさい', 'なんにん',
    '誰(?!か|も|にも|とも|ひとり|一人)', 'だれ(?!か|も|にも|とも)', 'どこ(?!か|にも|も)', '(?<![あこそど])いつ(?!か|も)', 'どれ(?!か|も)', 'どちら', 'どっち', 'それとも',
  ].join('|'),
  'u',
);

export function isOpenQuestion(norm: string): boolean {
  return OPEN_Q.test(norm);
}

// "Is X relevant / important?" — answered from the importance of the fact X points at.
const RELEVANCE_Q = /(?:関係|関連|かんけい|かんれん|重要|じゅうよう|大事|だいじ|意味)(?:が|は|も)?(?:ある|あり|あった|する|し|な(?:い|かった)|です|でした|なの|なん|ありそう)/u;

export function isRelevanceQuestion(norm: string): boolean {
  return RELEVANCE_Q.test(norm);
}

export type MetaKind = 'askAnswer' | 'askHint' | 'offtopic' | 'aboutHolma' | 'rude' | 'empty' | 'tooLong';

const META_ASK_ANSWER: RegExp[] = [
  /(?:死因|しいん|答え|こたえ|正解|せいかい|真相|しんそう|結論|けつろん|犯人|はんにん|真実|しんじつ)(?:を|は|って|が|とか)?(?:教え|おしえ|言って|いって|知りたい|しりたい|なに|何|なん|だれ|誰|どれ|ちょうだい|頂戴|ください|下さい|くれ|ずばり|早く|はやく)/u,
  /(?:死因|答え|正解|真相|真実|結論|全部|ぜんぶ|すべて|全て|何が起き|なにがおき)(?:を|は|って|が)?.{0,4}(?:教えて|おしえて|話して|はなして|説明し|せつめいし|言って|いって)/u,
  /(?:なぜ|どうして|なんで|何が|なにが).{0,14}(?:説明し|せつめいし)(?:て|ろ)/u,
  /(?:彼女|かのじょ|被害者)?(?:の)?(?:名前|なまえ|本名|身元|みもと|正体)(?:を|は|って)?(?:教え|おしえ|なに|何|なん|知りたい|だれ|誰)/u,
  /(?:何|なに|誰|だれ)(?:が|で)(?:彼女を)?(?:殺|ころ)/u,
  /ねたばれ/u,
  /(?:なぜ|何故|なんで|どうして)(?:彼女は|かのじょは|この人は|このひとは)?(?:死ん|しん|亡くな|なくな)/u,
  /(?:何|なに|なん)(?:で|が原因で|によって)(?:死ん|しん|亡くな|なくな)/u,
  /(?:全部|ぜんぶ|すべて|全て)(?:教え|おしえ)/u,
];
const META_ASK_HINT: RegExp[] = [
  /(?:ひんと|手がかり|手掛かり|てがかり)/u,
  /^(?:わからない|分からない|わかんない|わかりません|分かりません|降参|こうさん|ぎぶあっぷ|お手上げ|おてあげ|詰んだ|つんだ|助けて|たすけて|むり|無理)/u,
];
const META_RUDE = /(?:ばか(?!り|ら|す)|馬鹿|あほ(?!う)|阿呆|くそ(?!う)|糞|うざ|きも(?!ち|の|ど|だめ)|きしょ|ぼけ(?!る|て)|かす(?![かりれみんけ])|だまれ|黙れ|死ね|しねよ|^しね$|きえろ|消えろ|ころすぞ|殺すぞ|ふざけんな|ふざけるな|役立たず|やくたたず|のろま|くたばれ)/u;
const META_OFFTOPIC = /^(?:こんにちは|こんにちわ|こんばんは|こんばんわ|おはよう|はじめまして|よろしく|ありがとう|さようなら|さよなら|おやすみ|やあ|hello|hi|hey|もしもし|てすと|test|元気|げんき|天気|てんき|好きな食べ物|すきなたべもの|趣味|しゅみ|今何時|いまなんじ|暇|ひま|眠い|ねむい|お腹すいた|おなかすいた|疲れた|つかれた|おい|ねえ|ねぇ|へい)/u;
/** Small talk that stays small talk even when a case keyword appears (「今日の天気は？」). */
const META_OFFTOPIC_STRONG = /(?:(?:今日|きょう|明日|あした|昨日|きのう)の(?:[^の]{0,6}の)?(?:天気|てんき)|おすすめ|お勧め|お薦め|好きな(?:食べ物|たべもの|色|いろ|動物|どうぶつ|音楽|映画)|趣味は)/u;
const META_ABOUT_HOLMA = /(?:ほるま|holma|あなた|貴方|あんた|きみは|君は|お前|おまえ|てめえ|うさぎさん|兎|管理人|かんりにん|剥製|はくせい)/u;

export const MAX_QUESTION_CHARS = 200;

/** Meta detection. `hasCaseSignal` = retrieval found a keyword hit (suppresses weak metas). */
export function detectMeta(raw: string, norm: string, hasCaseSignal: boolean): MetaKind | undefined {
  if ([...raw].length > MAX_QUESTION_CHARS) return 'tooLong';
  if (isEmptyish(norm)) return 'empty';
  if (!hasCaseSignal && META_RUDE.test(norm)) return 'rude';
  if (META_ASK_ANSWER.some((re) => re.test(norm))) return 'askAnswer';
  if (META_ASK_HINT.some((re) => re.test(norm)) && [...norm].length <= 16) return 'askHint';
  if (META_OFFTOPIC_STRONG.test(norm)) return 'offtopic';
  if (!hasCaseSignal && META_OFFTOPIC.test(norm)) return 'offtopic';
  if (!hasCaseSignal && META_ABOUT_HOLMA.test(norm)) return 'aboutHolma';
  return undefined;
}

function isEmptyish(norm: string): boolean {
  if (norm.length === 0) return true;
  const chars = [...norm];
  if (chars.every((c) => c === chars[0]) && chars.length > 1 && !/\p{Script=Han}/u.test(chars[0])) return true;
  if (/^[wｗ笑草]+$/u.test(norm)) return true;
  if (chars.length === 1 && !/[\p{Script=Han}a-z0-9]/u.test(norm)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Splitting                                                            */
/* ------------------------------------------------------------------ */

export interface SplitResult {
  /** Original-text parts (trimmed, punctuation kept), at most `max`. */
  parts: string[];
  /** How many further parts were dropped beyond `max`. */
  dropped: number;
}

// "それと" (not それとも) / "あと" used as a conjunction after a pause or after a question ending in か.
const CONJ = /(?:(?<=[、,，\s])|(?<=か))(?:それと(?!も)|あと(?=[、,，\s]|は|[\p{Script=Han}\p{Script=Katakana}]))(?:は)?[、,，\s]*/u;

const LEADING_CONJ = /^(?:それと(?!も)|それから|あと(?:は|さ)?(?=[、,，\s]|は|$|[\p{Script=Han}\p{Script=Katakana}])|あとは)[、,，\s]*/u;

/**
 * Splits a message into atomic questions on ？ / ? / 。 / ！ / newline and on the
 * conjunctions それと / あと. Parts that normalise to nothing are dropped.
 */
export function splitQuestions(raw: string, max = 3): SplitResult {
  const text = (raw ?? '').replace(/\r\n?/g, '\n');
  const chunks: string[] = [];
  // Keep terminal punctuation attached to its sentence for display.
  const re = /[^?？。!！\n]+[?？。!！]*|[?？。!！]+/gu;
  for (const m of text.matchAll(re)) {
    const piece = m[0];
    for (const sub of piece.split(CONJ)) chunks.push(sub);
  }
  const parts = chunks
    .map((c) => c.trim())
    // A leading conjunction (「それと毒は？」) is noise once the message is split.
    .map((c) => {
      const stripped = c.replace(LEADING_CONJ, '');
      return normalize(stripped).length > 0 ? stripped : c;
    })
    .filter((c) => normalize(c).length > 0);
  // Merge a dangling 1-char fragment into the previous part (e.g. "毒？ね" → one part).
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length > 0 && [...normalize(p)].length === 1 && !/\p{Script=Han}/u.test(normalize(p))) {
      merged[merged.length - 1] += p;
    } else merged.push(p);
  }
  return { parts: merged.slice(0, max), dropped: Math.max(0, merged.length - max) };
}

/* ------------------------------------------------------------------ */
/* Analysed question                                                    */
/* ------------------------------------------------------------------ */

export interface AnalyzedQuestion {
  /** Original text as typed (one atomic part). */
  raw: string;
  norm: string;
  core: string;
  negated: boolean;
  open: boolean;
  /** 「〜は関係ありますか」 style question. */
  relevance: boolean;
  /** What the question proposes: works/exists (pos) vs stopped/absent/not (neg). */
  prop: Proposition;
}

export function analyze(raw: string): AnalyzedQuestion {
  const norm = normalize(raw);
  return {
    raw,
    norm,
    core: coreForm(norm),
    negated: isNegatedConfirmation(norm),
    open: isOpenQuestion(norm),
    relevance: isRelevanceQuestion(norm),
    prop: questionProposition(raw),
  };
}

/* ------------------------------------------------------------------ */
/* Similarity primitives                                                */
/* ------------------------------------------------------------------ */

/** Character bigram multiset (unigrams for strings shorter than 2 chars). */
export function bigrams(s: string): Map<string, number> {
  const chars = [...s];
  const m = new Map<string, number>();
  if (chars.length === 0) return m;
  if (chars.length === 1) {
    m.set(chars[0], 1);
    return m;
  }
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1];
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function size(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

function intersection(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) n += Math.min(v, w);
  }
  return n;
}

/** Sørensen–Dice coefficient on bigram multisets (0..1). */
export function dice(a: Map<string, number>, b: Map<string, number>): number {
  const sa = size(a), sb = size(b);
  if (sa === 0 || sb === 0) return 0;
  return (2 * intersection(a, b)) / (sa + sb);
}

/** Jaccard on bigram multisets (0..1). */
export function jaccard(a: Map<string, number>, b: Map<string, number>): number {
  const i = intersection(a, b);
  const u = size(a) + size(b) - i;
  return u === 0 ? 0 : i / u;
}

/** Fraction of `a`'s bigrams found in `b` (0..1). Good for "question inside long text". */
export function containment(a: Map<string, number>, b: Map<string, number>): number {
  const sa = size(a);
  return sa === 0 ? 0 : intersection(a, b) / sa;
}

/**
 * True when `word` occurs in `text` (both normalised) at least once without an
 * immediately following negation (「毒ではなく」「毒じゃない」「毒なし」).
 */
export function containsAffirmed(text: string, word: string): boolean {
  if (!word) return false;
  let from = 0;
  for (;;) {
    const i = text.indexOf(word, from);
    if (i < 0) return false;
    const after = text.slice(i + word.length, i + word.length + 8);
    if (!/^(?:[たるだてい]{0,2}の?(?:では|じゃ|でわ|でも)?(?:な[いくかけ]|ありませ)|なし|無し|無く|ではなく|とは(?:違|ちが)|は(?:関係|かんけい)な|は(?:無関係|むかんけい)|(?:は|が)?(?:原因|げんいん)?(?:では|じゃ)な|(?:は|が|も)?(?:い|居)(?:な|ませ))/u.test(after)) return true;
    from = i + 1;
  }
}
