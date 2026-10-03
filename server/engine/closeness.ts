/**
 * PROTOTYPE I-005 (2026-10-03, docs/decisions.md 「I-005 の試作」): 近い・遠い — how close a judged
 * verdict came, for the red-cabbage band the browser draws with `?proto=i005` (shared/api.ts
 * VerdictCloseness). Pure, and derived only from what the judge already decided — no new
 * judgement, no closeness the engine cannot justify:
 *
 *   free   (教授)   required answer elements matched / solveRule.required; a wrong claim the text
 *                   affirms (the story contradicts the truth) keeps it 'far' — the same rule that
 *                   makes the judge answer 「違う」. Accepted with every optional element too = perfect.
 *   cloze  (審問官) blanks right / blanks. Accepted means every blank, i.e. the full truth sentence
 *                   (the template carries the optional situation as well) = perfect.
 *   choice (見習い) a wrong pick: the picked option's text run through the free-text judge (the
 *                   judge already does this for its wrong claims) — shares at least half of the
 *                   required elements without a false story = near. A right pick = correct: one
 *                   picked sentence cannot express more, so there is no 'perfect' in this format.
 *
 * near = at least half (NEAR_AT). The ratio is a share, never the list of what is missing.
 */
import type { VerdictCloseness, VerdictResult } from '../../shared/api.js';
import type { Case } from '../../shared/case-schema.js';
import { evaluateVerdict } from './verdict.js';

export const NEAR_AT = 0.5;

const round = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;

/** Not accepted: near from half of what the format measures, unless a false story is affirmed. */
export function partialCloseness(ratio: number, contradicted: boolean): VerdictCloseness {
  const r = round(ratio);
  return { level: !contradicted && r >= NEAR_AT ? 'near' : 'far', ratio: r };
}

/** Share of solveRule.required among the matched element ids. */
export function requiredShare(c: Case, matched: readonly string[]): number {
  const req = c.solveRule.required;
  if (req.length === 0) return 0;
  const has = new Set(matched);
  return req.filter((id) => has.has(id)).length / req.length;
}

/** Free text (and Jev): from the verdict evaluation (result, matched ids, affirmed wrong claims). */
export function freeCloseness(c: Case, ev: { result: VerdictResult; matched: readonly string[]; wrongClaims: readonly string[] }): VerdictCloseness {
  if (ev.result === 'correct') {
    const has = new Set(ev.matched);
    const optional = c.answerElements.filter((e) => !c.solveRule.required.includes(e.id));
    return { level: optional.every((e) => has.has(e.id)) ? 'perfect' : 'correct', ratio: 1 };
  }
  return partialCloseness(requiredShare(c, ev.matched), ev.wrongClaims.length > 0);
}

/** Cloze: blanks right of all blanks. */
export function clozeCloseness(right: number, total: number): VerdictCloseness {
  if (total > 0 && right >= total) return { level: 'perfect', ratio: 1 };
  return partialCloseness(total > 0 ? right / total : 0, false);
}

/** Choice: the picked option (its text is judged like a free-text verdict when it is wrong). */
export function choiceCloseness(c: Case, option: { text: string; correct: boolean }): VerdictCloseness {
  if (option.correct) return { level: 'correct', ratio: 1 };
  const ev = evaluateVerdict(c, option.text);
  return partialCloseness(requiredShare(c, ev.matched), ev.wrongClaims.length > 0);
}
