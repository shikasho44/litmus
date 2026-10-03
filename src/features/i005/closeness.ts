/**
 * PROTOTYPE I-005 — the red-cabbage band (近い・遠い). Pure helpers: where the marker sits and
 * which word it shows, from the server's VerdictCloseness (server/engine/closeness.ts).
 *
 * Red-cabbage juice is the home-made litmus paper: red in acid → pink → purple near neutral →
 * blue → green in alkali. Far is red, closer is purple, an accepted verdict is blue, a perfect one
 * is green. The marker only moves inside its level's zone, so it never says more than the level
 * and the share the checklist already shows.
 */
import type { VerdictCloseness } from '../../../shared/api';

export type ClosenessLevel = VerdictCloseness['level'];
export const CLOSENESS_LEVELS: readonly ClosenessLevel[] = ['far', 'near', 'correct', 'perfect'];

export const CLOSENESS_LABEL: Record<ClosenessLevel, string> = {
  far: '遠い',
  near: '近い',
  correct: '正解',
  perfect: '完璧な正解',
};

/** Indicator colours along the band (position 0..1). */
export const BAND_STOPS: readonly { at: number; color: string }[] = [
  { at: 0, color: '#E5344E' }, // red
  { at: 0.24, color: '#E0589F' }, // pink
  { at: 0.46, color: '#9061D8' }, // purple
  { at: 0.68, color: '#3E7FEA' }, // blue
  { at: 1, color: '#2FBF7C' }, // green
];

/** Where each word sits under the band (完璧な正解 is drawn flush right, i005.css). */
export const TICK_AT: Record<ClosenessLevel, number> = { far: 0.12, near: 0.4, correct: 0.68, perfect: 0.94 };

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Marker position: far 0.05–0.22 (red → pink), near 0.32–0.48 (pink → purple), correct 0.68
 * (blue), perfect 0.94 (green). Within far / near the share moves it a little.
 */
export function bandPosition(c: VerdictCloseness): number {
  const r = clamp01(c.ratio);
  switch (c.level) {
    case 'perfect':
      return 0.94;
    case 'correct':
      return 0.68;
    case 'near':
      return 0.32 + 0.16 * clamp01((r - 0.5) / 0.5);
    default:
      return 0.05 + 0.17 * clamp01(r / 0.5);
  }
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The band colour at a position (linear between the stops). */
export function bandColor(pos: number): string {
  const p = clamp01(pos);
  for (let i = 1; i < BAND_STOPS.length; i++) {
    const a = BAND_STOPS[i - 1];
    const b = BAND_STOPS[i];
    if (p <= b.at) {
      const t = (p - a.at) / (b.at - a.at || 1);
      const [r1, g1, b1] = hex(a.color);
      const [r2, g2, b2] = hex(b.color);
      const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
      return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
    }
  }
  return BAND_STOPS[BAND_STOPS.length - 1].color;
}

/** A closeness from the wire, or null when it is missing / malformed (the band is then not drawn). */
export function readCloseness(v: unknown): VerdictCloseness | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { level?: unknown; ratio?: unknown };
  if (typeof o.level !== 'string' || !(CLOSENESS_LEVELS as readonly string[]).includes(o.level)) return null;
  return { level: o.level as ClosenessLevel, ratio: typeof o.ratio === 'number' ? clamp01(o.ratio) : 0 };
}
