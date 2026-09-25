/**
 * Verdict by difficulty (shared/api.ts VERDICT_MODE_BY_DIFFICULTY):
 *   choice (見習い)  one option id                → correct | wrong
 *   cloze  (審問官)  blank id → displayed index   → correct (all) | missing (some) | wrong (none)
 *   free   (教授)    free text                     → verdict.ts (unchanged)
 *
 * Picks are read through the same fixed per-case shuffles the setup view used
 * (public-view.ts verdictChoiceOrder / verdictBlankOrder), so the browser never needs to know
 * which option is right. Anything the setup view could not have produced (unknown option, a
 * struck-out option, a missing / out-of-range blank) is a bad_request and is not counted.
 */
import type { Case, VerdictModes } from '../../shared/case-schema.js';
import type { VerdictMode, VerdictResult } from '../../shared/api.js';
import { badRequest } from './errors.js';
import { verdictAssists, verdictBlankOrder } from './public-view.js';
import { evaluateVerdict } from './verdict.js';

export const VERDICT_MODES: readonly VerdictMode[] = ['choice', 'cloze', 'free'];

/** `fallback` is used when the field is absent (VerdictRequest.mode defaults to 'free'). */
export function parseVerdictMode(v: unknown, fallback?: VerdictMode): VerdictMode {
  if ((v === undefined || v === null) && fallback) return fallback;
  if (typeof v === 'string' && (VERDICT_MODES as readonly string[]).includes(v)) return v as VerdictMode;
  throw badRequest(`mode must be one of ${VERDICT_MODES.join(', ')}`);
}

export interface PickVerdict {
  result: Extract<VerdictResult, 'correct' | 'missing' | 'wrong'>;
  /** choice: every answer element id when correct · cloze: ids of the correctly filled blanks */
  matched: string[];
  /** choice: answer element labels · cloze: blank id → blank label */
  labels: Record<string, string>;
  /** choice, wrong pick: wrong claims the option's text affirms (their feedback is Holma's reply). */
  wrongClaims: string[];
  /** Trace-safe description of the pick (no free text). */
  input: string;
}

function modes(c: Case, mode: VerdictMode): VerdictModes {
  if (!c.verdictModes) throw badRequest(`this case has no ${mode} verdict`);
  return c.verdictModes;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function judgeChoice(c: Case, cleared: readonly string[], choice: unknown): PickVerdict {
  const vm = modes(c, 'choice');
  if (typeof choice !== 'string' || choice.length === 0) throw badRequest('choice is required');
  const opt = vm.choice.options.find((o) => o.id === choice);
  if (!opt) throw badRequest(`unknown choice option: ${choice.slice(0, 64)}`);
  if (verdictAssists(c, vm, cleared, 'choice').earned.has(opt.id)) throw badRequest('that option was struck out');
  const labels: Record<string, string> = {};
  for (const e of c.answerElements) labels[e.id] = e.label;
  const input = `choice:${opt.id}`;
  if (opt.correct) return { result: 'correct', matched: c.answerElements.map((e) => e.id), labels, wrongClaims: [], input };
  return { result: 'wrong', matched: [], labels, wrongClaims: evaluateVerdict(c, opt.text).wrongClaims, input };
}

export function judgeCloze(c: Case, cleared: readonly string[], blanks: unknown): PickVerdict {
  const vm = modes(c, 'cloze');
  if (!blanks || typeof blanks !== 'object' || Array.isArray(blanks)) throw badRequest('blanks is required');
  const picks = blanks as Record<string, unknown>;
  for (const k of Object.keys(picks)) if (!vm.cloze.blanks.some((b) => b.id === k)) throw badRequest(`unknown blank: ${k.slice(0, 64)}`);
  const { earned } = verdictAssists(c, vm, cleared, 'cloze');
  const labels: Record<string, string> = {};
  const matched: string[] = [];
  const shown: string[] = [];
  for (const b of vm.cloze.blanks) {
    labels[b.id] = b.label;
    const order = verdictBlankOrder(c, b);
    let pos = own(picks, b.id) ? picks[b.id] : undefined;
    if (pos === undefined || pos === null) {
      // A blank pre-filled by an assist may be left out; any other blank must be answered.
      if (!earned.has(b.id)) throw badRequest(`blank ${b.id} is not filled`);
      pos = order.indexOf(b.answer);
    }
    if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 0 || pos >= order.length) throw badRequest(`blank ${b.id}: option index out of range`);
    if (order[pos] === b.answer) matched.push(b.id);
    shown.push(`${b.id}=${pos}`);
  }
  const result = matched.length === vm.cloze.blanks.length ? 'correct' : matched.length > 0 ? 'missing' : 'wrong';
  return { result, matched, labels, wrongClaims: [], input: `cloze:${shown.join(',')}` };
}
