/** The cloze verdict (審問官): the truth sentence with {{blankId}} slots. */

/** One segment of the cloze template: text, or the blank with this id. */
export type ClozePart = { text: string } | { blank: string };

/** Split 「{{a}}によって{{b}}が…」 into text and blank parts (unknown markup stays text). */
export function parseCloze(template: string): ClozePart[] {
  const out: ClozePart[] = [];
  const re = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m.index > at) out.push({ text: template.slice(at, m.index) });
    out.push({ blank: m[1] });
    at = m.index + m[0].length;
  }
  if (at < template.length) out.push({ text: template.slice(at) });
  return out;
}
