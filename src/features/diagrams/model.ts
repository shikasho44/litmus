/**
 * Pure geometry / parsing helpers for the science diagrams (no DOM). Unit-testable.
 */
import type { Case } from '../../../shared/case-schema';

export type DiagramData = Case['science']['diagrams'][number];
export type LevelsData = Extract<DiagramData, { kind: 'levels' }>;
export type EcgData = Extract<DiagramData, { kind: 'ecg' }>;
export type RatioData = Extract<DiagramData, { kind: 'ratio' }>;
export type CompareData = Extract<DiagramData, { kind: 'compare' }>;
export type Tone = LevelsData['levels'][number]['tone'];

/** Tone → label (meaning is never carried by colour alone) and colour. */
export const TONE_META: Record<Tone, { label: string; color: string }> = {
  safe: { label: '安全', color: '#C6FF3D' },
  note: { label: '目安', color: '#3DE0FF' },
  warn: { label: '注意', color: '#FFB020' },
  danger: { label: '危険', color: '#FF7A3D' },
  fatal: { label: '致命的', color: '#FF2E63' },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* levels                                                              */
/* ------------------------------------------------------------------ */

export interface LevelsModel {
  /** true when the first level has the larger value (O2 %, body temperature): max at the top. */
  descending: boolean;
  /** 0..1 position from the top for a value. */
  pos: (v: number) => number;
  /** Coloured bands, top → bottom, positions 0..1. */
  bands: { from: number; to: number; tone: Tone }[];
  /** Minor ticks (nice step), positions 0..1 with their values. */
  ticks: { value: number; pos: number }[];
}

export function niceStep(range: number, target = 6): number {
  const raw = Math.abs(range) / Math.max(1, target);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

export function levelsModel(d: LevelsData): LevelsModel {
  const lv = d.levels;
  const lo = Math.min(d.min, d.max);
  const hi = Math.max(d.min, d.max);
  const span = hi - lo || 1;
  const descending = lv.length > 1 ? lv[0].value > lv[lv.length - 1].value : true;
  const pos = (v: number) => clamp(descending ? (hi - v) / span : (v - lo) / span, 0, 1);
  const bands: LevelsModel['bands'] = [];
  const first = pos(lv[0].value);
  if (first > 0.001) bands.push({ from: 0, to: first, tone: lv[0].tone });
  lv.forEach((l, i) => {
    const from = pos(l.value);
    const to = i + 1 < lv.length ? pos(lv[i + 1].value) : 1;
    if (to > from) bands.push({ from, to, tone: l.tone });
  });
  const step = niceStep(span, 8);
  const ticks: LevelsModel['ticks'] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push({ value: +v.toFixed(6), pos: pos(v) });
  return { descending, pos, bands, ticks };
}

/** 21 → "21%" · 9.8 → "9.8分" · 37 → "37℃" */
export function formatValue(v: number, unit: string): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '');
  return `${s.replace('-', '−')}${unit}`;
}

/* ------------------------------------------------------------------ */
/* ecg                                                                 */
/* ------------------------------------------------------------------ */

/** One PQRST beat as a sum of Gaussians; x in beat units [0,1), y in units of the R height. */
const WAVES = [
  { a: 0.13, mu: 0.14, s: 0.028 }, // P
  { a: -0.1, mu: 0.248, s: 0.008 }, // Q
  { a: 1.0, mu: 0.272, s: 0.011 }, // R
  { a: -0.27, mu: 0.297, s: 0.01 }, // S
];
export const T_PEAK = 0.52;
/** The vulnerable window: the upslope just before the T peak (drawn wider than life for legibility). */
export const WINDOW: [number, number] = [0.462, 0.508];

export function beatY(x: number): number {
  let y = 0;
  for (const w of WAVES) y += w.a * Math.exp(-(((x - w.mu) / w.s) ** 2));
  // asymmetric T wave: slow rise, quicker fall
  const s = x < T_PEAK ? 0.058 : 0.04;
  y += 0.3 * Math.exp(-(((x - T_PEAK) / s) ** 2));
  return y;
}

export interface EcgModel {
  width: number;
  height: number;
  baseline: number;
  amp: number;
  beatLen: number;
  /** x of each beat start. */
  beats: number[];
  impactX: number;
  vfStart: number;
  normalPath: string;
  vfPath: string;
  /** window bands per beat [x0, x1]. */
  windows: [number, number][];
  /** Peak x/y of labelled waves on beat 1. */
  waves: { key: 'P' | 'QRS' | 'T'; x: number; y: number }[];
}

/**
 * Two beats, an impact inside the second beat's vulnerable window, then ventricular
 * fibrillation to the right edge. Pixel-true geometry for the given width.
 */
export function ecgModel(width: number, height: number): EcgModel {
  const m = 12;
  const L = clamp((width - 2 * m) / 2.8, 90, 240);
  const baseline = height * 0.64;
  const amp = height * 0.44;
  const x0 = m + L * 0.08;
  const beats = [x0, x0 + L];
  const impactX = beats[1] + L * ((WINDOW[0] + WINDOW[1]) / 2);
  const Y = (v: number) => baseline - v * amp;
  const pts: string[] = [`M${m},${Y(0).toFixed(1)}`];
  for (let x = x0; x <= impactX; x += 1) {
    const local = (x - x0) % L;
    pts.push(`L${x.toFixed(1)},${Y(beatY(local / L)).toFixed(1)}`);
  }
  const startY = beatY(WINDOW[1] - 0.023);
  const vf: string[] = [`M${impactX.toFixed(1)},${Y(startY).toFixed(1)}`];
  const end = width - m;
  for (let x = impactX + 1; x <= end; x += 1) {
    const t = (x - impactX) / L;
    const env = Math.min(1, t * 6) * (0.78 + 0.22 * Math.sin(t * 5.1 + 0.6));
    const y =
      startY * Math.max(0, 1 - t * 8) +
      env * (0.32 * Math.sin(2 * Math.PI * 4.7 * t + 0.4) + 0.14 * Math.sin(2 * Math.PI * 7.9 * t + 1.9) + 0.08 * Math.sin(2 * Math.PI * 12.3 * t + 0.2));
    vf.push(`L${x.toFixed(1)},${Y(y).toFixed(1)}`);
  }
  const windows: [number, number][] = beats.map((b) => [b + WINDOW[0] * L, b + WINDOW[1] * L]);
  const waves: EcgModel['waves'] = [
    { key: 'P', x: beats[0] + 0.14 * L, y: Y(0.13) },
    { key: 'QRS', x: beats[0] + 0.272 * L, y: Y(1) },
    { key: 'T', x: beats[0] + T_PEAK * L, y: Y(0.3) },
  ];
  return { width, height, baseline, amp, beatLen: L, beats, impactX, vfStart: impactX, normalPath: pts.join(''), vfPath: vf.join(''), windows, waves };
}

/** Short tag for the window: text inside 「」 in the title, else a generic phrase. */
export function windowTag(title: string): string {
  const m = title.match(/「([^「」]{1,8})」/);
  return m ? m[1] : '危険な瞬間';
}

/* ------------------------------------------------------------------ */
/* ratio                                                               */
/* ------------------------------------------------------------------ */

export interface Quantity {
  prefix: string;
  num: number;
  unit: string;
}

/** "約700" → {prefix:'約', num:700, unit:''} · "−15℃" → {num:-15, unit:'℃'} · "約−27℃" */
export function parseQuantity(s: string): Quantity | null {
  const t = s
    .replace(/[−–—－]/g, '-')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .trim();
  const m = t.match(/^(\D*?)(-?\d+(?:[.,]\d+)?)(.*)$/);
  if (!m) return null;
  const num = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return { prefix: m[1].trim(), num, unit: m[3].trim() };
}

export type RatioMode = { kind: 'expand'; factor: number; dots: number; perDot: number } | { kind: 'shift'; a: number; b: number; unit: string } | { kind: 'plain' };

export function ratioMode(d: RatioData): RatioMode {
  const a = parseQuantity(d.from.value);
  const b = parseQuantity(d.to.value);
  if (!a || !b) return { kind: 'plain' };
  if (a.num > 0 && b.num > 0 && b.num / a.num >= 5 && a.unit === b.unit) {
    const factor = b.num / a.num;
    const perDot = factor > 1200 ? Math.ceil(factor / 1000) : 1;
    return { kind: 'expand', factor, dots: Math.round(factor / perDot), perDot };
  }
  if (a.unit === b.unit) return { kind: 'shift', a: a.num, b: b.num, unit: a.unit };
  return { kind: 'plain' };
}

/**
 * Deterministic cloud of `n` points (Vogel sunflower in a wobbly ellipse), centred at 0,0,
 * radius ~1 horizontally × `aspect` vertically. Returns points sorted from the centre out.
 */
export function cloudPoints(n: number, aspect = 0.62): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const th = i * golden;
    const wob = 1 + 0.1 * Math.sin(3 * th + 0.7) + 0.06 * Math.sin(5 * th + 2.1);
    const rr = r * wob;
    out.push({ x: Math.cos(th) * rr, y: Math.sin(th) * rr * aspect, r });
  }
  return out;
}
