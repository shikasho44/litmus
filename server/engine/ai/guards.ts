/**
 * Cheap, local (no model) checks shared by the renderer, the LLM judge and the post-checker.
 * Pure — no Node APIs.
 */
import type { AnswerClass, Fact } from '../../../shared/case-schema.js';
import { normalize } from '../normalize.js';

/** Japanese label of each answer class (what Holma's stamp says). */
export const CLASS_LABEL: Record<AnswerClass, string> = {
  yes: 'はい',
  no: 'いいえ',
  partial: '一部そう',
  irrelevant: '関係ない',
  cannot: '今は答えられない',
  vague: 'もう少し具体的に',
};

/**
 * Normalised leak terms present in `line` that are not part of what the player may know.
 * (Same rule as pipeline.findLeaks, re-implemented here so the AI modules do not depend on the
 * pipeline module.)
 */
export function leaksIn(line: string, leakTerms: readonly string[], allowedFacts: readonly Fact[]): string[] {
  const n = normalize(line);
  if (!n) return [];
  const allowed = normalize(allowedFacts.map((f) => f.text).join(' '));
  const terms = leakTerms.map((t) => normalize(t)).filter((t) => t.length > 0);
  return [...new Set(terms.filter((t) => n.includes(t) && !allowed.includes(t)))];
}

const OPENERS: Partial<Record<AnswerClass, RegExp>> = {
  yes: /^(?:はい|ええ|その通り|そのとおり|ご名答|正解)/u,
  no: /^(?:いいえ|いえ|違います|ちがいます|否)/u,
  partial: /^(?:一部|半分|部分的)/u,
  irrelevant: /^(?:関係(?:ない|ありません|ございません)|無関係)/u,
};
const MUST_CONTAIN: Partial<Record<AnswerClass, RegExp>> = {
  cannot: /(?:答え|こたえ|言え|いえ|申せ|お教え|教えられ|明かせ|秘密|掟|宣告|審問官の口)/u,
  vague: /(?:具体|はい.{0,3}いいえ|二択|そうか否か|言い直|問いを|尖ら|絞っ)/u,
};
const FORBIDDEN_START: Partial<Record<AnswerClass, RegExp>> = {
  cannot: /^(?:はい|いいえ|ええ)/u,
  vague: /^(?:はい|いいえ|ええ)(?![」』か])/u,
  irrelevant: /^(?:はい|いいえ)/u,
};

/** Strips leading quote marks / ellipses / whitespace Holma likes to open with. */
function head(text: string): string {
  return text.replace(/^[\s「『"'“…‥・—―-]+/u, '');
}

/**
 * Does `text` clearly express `answerClass` first? yes/no/partial/irrelevant must OPEN with
 * their marker (はい / いいえ / 一部 / 関係ない); cannot / vague must carry their idea and must
 * not open with a polarity word. A 'no' line must never contain はい as an answer, and a 'yes'
 * line must not contain いいえ.
 */
export function expressesClass(text: string, answerClass: AnswerClass): boolean {
  const h = head(text);
  const opener = OPENERS[answerClass];
  if (opener && !opener.test(h)) return false;
  const must = MUST_CONTAIN[answerClass];
  if (must && !must.test(text)) return false;
  const bad = FORBIDDEN_START[answerClass];
  if (bad && bad.test(h)) return false;
  if (answerClass === 'yes' && /いいえ/u.test(text)) return false;
  if (answerClass === 'no' && /(?:^|[。、\s])(?:はい|ええ)(?:[。、！\s]|$)/u.test(h)) return false;
  return true;
}

/** Character count as the player sees it (code points). */
export function charLength(s: string): number {
  return [...s].length;
}

/** Collapses whitespace, strips wrapping quotes and a leading "ホルマ:" label. */
export function cleanLine(s: string): string {
  let t = (s ?? '').trim();
  t = t.replace(/^(?:ホルマ|Holma)\s*[:：]\s*/u, '');
  t = t.replace(/^[「『"“](.*)[」』"”]$/su, '$1');
  return t.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Keywords of facts OUTSIDE the allowed set that a line mentions (hallucination proxy):
 * a keyword counts when it is ≥ 2 chars, not also a keyword of an allowed fact, and not in
 * the question itself (echoing the question is fine).
 */
export function foreignFactMentions(line: string, question: string, allFacts: readonly Fact[], allowedIds: ReadonlySet<string>): string[] {
  const n = normalize(line);
  const q = normalize(question);
  const allowedFacts = allFacts.filter((f) => allowedIds.has(f.id));
  const allowedKw = new Set(allowedFacts.flatMap((f) => f.keywords.map(normalize)));
  const allowedText = normalize(allowedFacts.map((f) => f.text).join(' '));
  const hits = new Set<string>();
  for (const f of allFacts) {
    if (allowedIds.has(f.id)) continue;
    for (const k of f.keywords) {
      const nk = normalize(k);
      // Short pure-kana keywords (けが, いき …) match inside ordinary words (だけが) — skip them.
      const min = /\p{Script=Han}/u.test(nk) ? 2 : 3;
      if ([...nk].length < min || allowedKw.has(nk) || allowedText.includes(nk) || q.includes(nk)) continue;
      if (n.includes(nk)) hits.add(nk);
    }
  }
  return [...hits];
}
