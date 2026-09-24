/**
 * Canned line bank (FAST PATH): validation with per-section fallback, deterministic
 * picking without immediate repeats, and composition of Holma's answer line.
 */
import type { AnswerClass } from '../../shared/case-schema.js';
import type { HolmaMood } from '../../shared/api.js';
import { HolmaLinesSchema, LineSchema, type HolmaLines, type Line } from '../../shared/lines-schema.js';
import { DEFAULT_LINES } from './default-lines.js';
import type { MetaKind } from './normalize.js';

export interface LineBankInfo {
  source: 'content' | 'merged' | 'default';
  issues: string[];
}

export class LineBank {
  constructor(readonly lines: HolmaLines, readonly info: LineBankInfo = { source: 'default', issues: [] }) {}

  static default(): LineBank {
    return new LineBank(DEFAULT_LINES, { source: 'default', issues: ['content/holma-lines.json not loaded — using built-in lines'] });
  }

  /**
   * Validates `raw` against HolmaLinesSchema. If the whole file is invalid, every section
   * that is itself a usable list (≥1 valid line) is kept and the rest falls back to the
   * built-in defaults. Never throws.
   */
  static from(raw: unknown): LineBank {
    if (raw === undefined || raw === null) return LineBank.default();
    const full = HolmaLinesSchema.safeParse(raw);
    if (full.success) return new LineBank(full.data, { source: 'content', issues: [] });
    const issues = full.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`);
    const merged = mergeSections(DEFAULT_LINES as unknown as Record<string, unknown>, raw, []);
    return new LineBank(merged as unknown as HolmaLines, { source: 'merged', issues });
  }

  /** Deterministic pick: consecutive seeds never return the same line (when len > 1). */
  pick(list: readonly Line[] | undefined, seed: number, salt: string): { text: string; mood?: HolmaMood } {
    const l = list && list.length > 0 ? list : ['……'];
    const i = pickIndex(l.length, seed, salt);
    const line = l[i];
    return typeof line === 'string' ? { text: line } : { text: line.text, mood: line.mood };
  }
}

function mergeSections(def: Record<string, unknown>, raw: unknown, path: string[]): Record<string, unknown> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, dv] of Object.entries(def)) {
    const rv = src[k];
    if (Array.isArray(dv)) {
      const valid = Array.isArray(rv) ? rv.filter((x) => LineSchema.safeParse(x).success) : [];
      out[k] = valid.length > 0 ? valid : dv;
    } else if (dv && typeof dv === 'object') {
      out[k] = mergeSections(dv as Record<string, unknown>, rv, [...path, k]);
    } else out[k] = dv;
  }
  return out;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function pickIndex(len: number, seed: number, salt: string): number {
  if (len <= 1) return 0;
  let stride = 1;
  for (const s of [7, 5, 3, 2, 1]) {
    if (s % len !== 0 && gcd(s, len) === 1) {
      stride = s;
      break;
    }
  }
  const base = hashString(salt) % len;
  return (base + (Math.abs(Math.floor(seed)) % len) * stride) % len;
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

const CLASS_MOOD: Record<AnswerClass, HolmaMood> = {
  yes: 'normal',
  no: 'laugh',
  partial: 'normal',
  irrelevant: 'normal',
  cannot: 'laugh',
  vague: 'normal',
};

const META_MOOD: Partial<Record<MetaKind | 'open', HolmaMood>> = { rude: 'serious', askAnswer: 'laugh' };

export interface ComposeInput {
  answerClass: AnswerClass;
  meta?: MetaKind | 'open';
  unlockedCore: boolean;
  unlocked: boolean;
  nearCore: boolean;
  /** 0-based index of this part and total parts in the message. */
  part: number;
  parts: number;
  degraded: boolean;
  /** Seed: question counter (+ part index). */
  seed: number;
  /** Case-specific nearCore flavour lines (case.holmaLines.nearCore). */
  caseNearCore?: readonly string[];
}

export interface ComposedLine {
  text: string;
  mood: HolmaMood;
  /** The pieces (for traces / renderer reference). */
  pieces: string[];
}

export function composeLine(bank: LineBank, x: ComposeInput): ComposedLine {
  const L = bank.lines;
  const pieces: string[] = [];
  let mood: HolmaMood | undefined;
  if (x.part === 0 && x.degraded) pieces.push(bank.pick(L.error.degraded, x.seed, 'degraded').text);
  if (x.part === 0 && x.parts > 1) pieces.push(bank.pick(L.multi, x.seed, 'multi').text);

  const base =
    x.meta && x.meta !== 'open'
      ? bank.pick(L.meta[x.meta], x.seed, `meta.${x.meta}`)
      : bank.pick(L.answer[x.answerClass], x.seed, `answer.${x.answerClass}`);
  pieces.push(base.text);
  mood = base.mood ?? (x.meta ? META_MOOD[x.meta] : undefined) ?? CLASS_MOOD[x.answerClass];

  if (x.unlockedCore) {
    const l = bank.pick(L.unlockCore, x.seed, 'unlockCore');
    pieces.push(l.text);
    mood = l.mood ?? 'surprised';
  } else if (x.unlocked) {
    const l = bank.pick(L.unlock, x.seed, 'unlock');
    pieces.push(l.text);
    if (l.mood) mood = l.mood;
  }
  if (x.nearCore) {
    const useCase = x.caseNearCore && x.caseNearCore.length > 0 && x.seed % 2 === 0;
    const l = useCase ? bank.pick(x.caseNearCore, x.seed, 'case.nearCore') : bank.pick(L.nearCore, x.seed, 'nearCore');
    pieces.push(l.text);
    mood = l.mood ?? 'surprised';
  }
  return { text: pieces.join('\n'), mood, pieces };
}

/** Plain list of texts from a bank section (for multi-line responses such as debate lines). */
export function texts(list: readonly Line[] | undefined): string[] {
  return (list ?? []).map((l) => (typeof l === 'string' ? l : l.text));
}
