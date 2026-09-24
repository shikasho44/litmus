/**
 * Furigana in script text: 「解剖（しらべ）」 → <ruby>解剖<rt>しらべ</rt></ruby>.
 *
 * Only a run of kanji directly followed by a full-width parenthesised run of hiragana is
 * treated as a reading, so ordinary parentheses (「（仮）」「（34）」, English, katakana) stay
 * as written. Used by the DialogueBox, the backlog and cut-ins.
 */
import type { ComponentChildren } from 'preact';

const RUBY_RE = /([㐀-䶿一-鿿々〆ヶ]+)（([ぁ-ゖー]+)）/g;

export type RubySeg = { text: string; rt?: string };

/** Split text into plain runs and {text, rt} ruby units. */
export function parseRuby(text: string): RubySeg[] {
  const out: RubySeg[] = [];
  let last = 0;
  for (const m of text.matchAll(RUBY_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[1], rt: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The text as it reads on screen without the readings (for lengths / fitting). */
export function stripRuby(text: string): string {
  return text.replace(RUBY_RE, '$1');
}

export function hasRuby(text: string): boolean {
  RUBY_RE.lastIndex = 0;
  const r = RUBY_RE.test(text);
  RUBY_RE.lastIndex = 0;
  return r;
}

export function renderRubySeg(seg: RubySeg, key?: string | number): ComponentChildren {
  if (!seg.rt) return seg.text;
  return (
    <ruby key={key}>
      {seg.text}
      <rp>（</rp>
      <rt>{seg.rt}</rt>
      <rp>）</rp>
    </ruby>
  );
}

/** Inline text with furigana. */
export function RubyText({ text }: { text: string }) {
  const segs = parseRuby(text);
  if (segs.length === 1 && !segs[0].rt) return <>{text}</>;
  return <>{segs.map((s, i) => renderRubySeg(s, i))}</>;
}
