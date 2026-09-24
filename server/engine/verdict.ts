/**
 * Cause-of-death verdict (死因宣告). Rules keyword groups on the normalised text, merged
 * with optional VerdictJudge probabilities. Never reveals the answer: feedback comes from
 * the line bank, the affirmed wrong claim's authored `feedback`, and each missing element's
 * authored `missingFeedback`.
 *
 *   wrong claim affirmed  → at best 'missing' ('wrong' when no element matched)
 *   correct               all solveRule.required matched
 *   almost                all solveRule.almost matched
 *   missing               ≥ 1 answer element matched
 *   wrong                 nothing matched
 *
 * Negation is scoped to the mention, not the sentence: a keyword occurrence is negated when its
 * own predicate denies it (「毒ではない」「液体窒素は関係ない」「殺されていない」「他殺の形跡はない」
 * 「熱中症と思われた」). Lexical negatives that describe the answer — 「酸素がなくなった」
 * 「足りなくなった」「少なくなる」 — are not denials. Both answer elements and wrong claims only
 * match affirmed mentions.
 */
import type { Case } from '../../shared/case-schema.js';
import type { VerdictResult } from '../../shared/api.js';
import type { RulesVerdict, VerdictJudgeOutput } from './judge-types.js';
import { normalize } from './normalize.js';

export const ELEMENT_PROB = 0.7;
export const WRONG_PROB = 0.7;
/** A rules-affirmed wrong claim stands unless the model is fairly sure it is not asserted. */
export const WRONG_VETO_PROB = 0.4;

const SENTENCE_SPLIT = /[。．.！!？?\n\r；;]+/u;
const CLAUSE_SPLIT = /[、，,：:・\s]+/u;
/**
 * Conjunctions that start a new proposition inside a sentence (normalised text): 「…当たったが熱中症
 * ではない」「熱中症ではなく心臓震盪」「…なので」. A denial never reaches across them.
 */
const CONJUNCTION = /(?<=[たいだ])が(?=.)|けれども|けれど|けど|のに(?!お)|ので(?!は|も|す|しょ)|しかし|ところが|(?<=(?:では|じゃ|でわ)なく)/u;
const B = '｜'; // clause boundary kept in the normalised text so words never match across clauses

/**
 * Denials anchored right after a keyword occurrence (within its clause). Each alternative is a
 * way Japanese says "not X" about the thing just named.
 */
const NEG_AFTER: RegExp[] = [
  // 毒はない / 毒もなく / 外傷なし / 毒でなく / 毒はいずれもない (not: 酸素がなくなった)
  /^(?:は|が|も|で|に|と|の)?(?:いずれも|どれも|ともに|一切|いっさい|全く|まったく)?(?:な(?:い|く(?!な[っるりれらろ])|かっ|し|さそう)|無(?:い|く(?!な[っるりれら])|かっ|し)|ありませ|ございませ)/u,
  // 毒ではない / 殺されたのではない / 殺人じゃなかった
  /^(?:た|だ|だった|である|です|でした|る)?(?:の|ん)?(?:では|じゃ|でわ|じゃあ)(?:な|ありませ)/u,
  // 液体窒素は関係ない / とは関係なく / 無関係
  /^(?:は|が|とは|と|も)?(?:関係|かんけい)(?:は|が|も)?(?:な|無|ありませ)/u,
  /^(?:は|とは|が|も)?(?:無関係|むかんけい)/u,
  // 毒とは違う
  /^(?:とは|では|じゃ|と)?(?:違|ちが)(?:う|い|っ)/u,
  // 毒のせいではない / 毒が原因ではない
  /^(?:の|による|によって|で|が|は)?(?:せい|原因|げんいん|ため)(?:では|じゃ)(?:な|ありませ)/u,
  // 犯人はいない / 誰もいなかった
  /^(?:は|も|が)?(?:い|居)(?:な[いくかけ]|ませ)/u,
  // 毒は検出されなかった / 外傷は見つからない / 爆発は起きていない
  /^(?:は|も|が|を)?(?:いずれも|どれも|すべて|全て|ともに|一切|いっさい|何も|なにも)?(?:見(?:つから|当たら)な|検出され(?:な|ず|て(?:い|お)(?:な|ず|らず))|出(?:な|ず)|認められ(?:な|ず)|確認され(?:な|ず)|起き(?:て)?(?:い|お)?(?:な|ず|らず)|起こら(?:な|ず))/u,
  // 殺されていない / 襲われず / 盛られてはいなかった (verb + inflection + negation)
  /^[かさたなまらわがばられさせしてでいたっおくけ]{0,4}(?:は|も)?(?:い|お)?(?:な(?:い|く(?!な[っるりれらろ])|かっ)|ませ|ず|らず)/u,
  // 脱がされたわけではない
  /^[たるだ]?(?:わけ|訳)(?:では|じゃ)(?:な|ありませ)/u,
  // 他殺の形跡はない / 毒を盛られた様子もなかった / 第三者の関与もない
  /^[^｜]{0,8}?(?:形跡|痕跡|跡|証拠|様子|兆候|気配|事実|可能性|疑い|関与|関わり)(?:は|も|が)?(?:な[いくかけ]|無[いくかし]|ありませ|見(?:つから|当たら)な|認められな)/u,
  // 暴行も物取りもなく / 凍死でも毒でもなく
  /^(?:でも|も)(?:[^｜]{1,8}?(?:でも|も))?(?:な[いく](?!な[っるりれら])|無[いく]|ありませ)/u,
  // 熱中症と思われた / 熱中症だと思い込んだ (someone else's mistaken belief)
  /^(?:だ|である)?(?:と|って)(?:思われ|おもわれ|思い込|おもいこ|勘違い|かんちがい|誤解|疑われ|考えられ|見られ|みられ|判断され|診断され)/u,
];

/**
 * Denials of the whole claim a little later in the same clause (「毒を盛られたわけではない」).
 * Belief words (思い込み・勘違い) are not here: in some cases the victim's misperception IS the
 * answer (「暑いと思い込んで脱いだ」); someone else's mistaken belief is caught right after the
 * keyword instead (「熱中症と思われた」).
 */
const CLAIM_NEG_LATER = /(?:(?:では|じゃ|でわ)(?:な[いくかけ]|ありませ)|わけ(?:では|じゃ)な|とは限らな|(?:関係|かんけい)(?:は|が|も)?(?:な[いくかけ]|ありませ)|無関係|否定され|否定でき|誤り|ありえな|あり得な)/u;

/** A clause that ends the sentence with a denial: 「…はいずれも認められなかった」「…もなかった」. */
const LIST_DENIAL_END = /(?:な(?:い|かった|く|し)|ず|ません(?:でした)?|無(?:い|かった|し))(?:です|でした|だった|である)?$/u;
/** A bare list item: a noun (optionally with a list particle) and no predicate of its own. */
const LIST_ITEM = /[\p{Script=Han}ー\p{Script=Katakana}a-z0-9](?:も|や|と|か|とか|など|および|及び|または)?$/u;

export interface PreparedVerdict {
  /** Whole text, normalised, clauses separated by ｜. */
  joined: string;
  /**
   * Normalised clauses (split on punctuation and conjunctions). Bare list items that a closing
   * collective denial covers (「骨折、心臓の損傷、毒物はいずれも認められなかった」) are dropped.
   */
  clauses: string[];
  /** @deprecated sentence-level view kept for callers of the old shape; `negated` is always false. */
  sentences: { norm: string; negated: boolean }[];
}

export function prepareVerdictText(text: string): PreparedVerdict {
  const clauses: string[] = [];
  const sentences: PreparedVerdict['sentences'] = [];
  for (const sentence of (text ?? '').split(SENTENCE_SPLIT)) {
    const parts = sentence
      .split(CLAUSE_SPLIT)
      .map(normalize)
      .flatMap((c) => c.split(CONJUNCTION))
      .filter(Boolean);
    if (parts.length === 0) continue;
    // 「A、B、Cはいずれも認められなかった」: the denial at the end covers the bare items before it.
    let first = parts.length - 1;
    if (parts.length > 1 && LIST_DENIAL_END.test(parts[parts.length - 1])) {
      while (first > 0 && LIST_ITEM.test(parts[first - 1])) first--;
    }
    clauses.push(...parts.filter((_, i) => i < first || i === parts.length - 1));
    sentences.push({ norm: parts.join(B), negated: false });
  }
  return { joined: clauses.join(B), clauses, sentences };
}

const HAN_RUN = /^\p{Script=Han}+/u;

/**
 * True when this occurrence of a keyword (clause[at … at+len]) is denied. A keyword inside a
 * longer compound noun is judged by the compound's predicate (「毒」 in 「毒物は認められなかった」).
 */
export function deniedAt(clause: string, at: number, len: number): boolean {
  let rest = clause.slice(at + len);
  if (/\p{Script=Han}$/u.test(clause.slice(0, at + len))) rest = rest.replace(HAN_RUN, '');
  if (NEG_AFTER.some((re) => re.test(rest))) return true;
  return CLAIM_NEG_LATER.test(rest.slice(0, 16));
}

/** The word (normalised) occurs at least once in `clause` without being denied. */
export function affirmedInClause(clause: string, word: string): boolean {
  if (!word) return true;
  for (let at = clause.indexOf(word); at >= 0; at = clause.indexOf(word, at + 1)) {
    if (!deniedAt(clause, at, word.length)) return true;
  }
  return false;
}

/** The word occurs affirmed in some clause of the prepared text. */
export function affirmedIn(p: PreparedVerdict, word: string): boolean {
  const n = normalize(word);
  return !n || p.clauses.some((c) => affirmedInClause(c, n));
}

export function rulesVerdict(c: Case, text: string | PreparedVerdict): RulesVerdict {
  const p = typeof text === 'string' ? prepareVerdictText(text) : text;
  const group = (g: string[]) => g.every((w) => affirmedIn(p, w));
  const elements: Record<string, boolean> = {};
  for (const el of c.answerElements) elements[el.id] = el.keywordGroups.some(group);
  const wrongClaims: Record<string, boolean> = {};
  for (const w of c.wrongClaims) wrongClaims[w.id] = w.keywordGroups.some(group);
  return { elements, wrongClaims };
}

export interface VerdictEvaluation {
  result: VerdictResult;
  matched: string[];
  wrongClaims: string[];
  missing: string[];
  rules: RulesVerdict;
  model?: { elements: Record<string, number>; wrongClaims: Record<string, number> };
}

export function evaluateVerdict(c: Case, text: string, model?: VerdictJudgeOutput): VerdictEvaluation {
  const rules = rulesVerdict(c, prepareVerdictText(text));
  const matched = c.answerElements
    .filter((el) => rules.elements[el.id] || (model?.elements[el.id] ?? 0) >= ELEMENT_PROB)
    .map((el) => el.id);
  const wrongClaims = c.wrongClaims
    .filter((w) => {
      const p = model?.wrongClaims[w.id];
      if (p === undefined || !Number.isFinite(p)) return rules.wrongClaims[w.id];
      return p >= WRONG_PROB || (rules.wrongClaims[w.id] && p >= WRONG_VETO_PROB);
    })
    .map((w) => w.id);
  const has = new Set(matched);
  const allRequired = c.solveRule.required.every((id) => has.has(id));
  const allAlmost = c.solveRule.almost.every((id) => has.has(id));
  let result: VerdictResult;
  // An affirmed wrong claim dominates: the story contradicts the truth, so it is never correct
  // or almost, however many elements it also names.
  if (wrongClaims.length > 0) result = matched.length > 0 ? 'missing' : 'wrong';
  else if (allRequired) result = 'correct';
  else if (allAlmost) result = 'almost';
  else if (matched.length > 0) result = 'missing';
  else result = 'wrong';
  const missing = c.answerElements.filter((el) => !has.has(el.id) && (el.required || c.solveRule.required.includes(el.id))).map((el) => el.id);
  return {
    result,
    matched: result === 'wrong' ? [] : matched,
    wrongClaims,
    missing,
    rules,
    model: model ? { elements: model.elements, wrongClaims: model.wrongClaims } : undefined,
  };
}
