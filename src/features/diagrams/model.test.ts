import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeDiagrams, pullQuote } from '../../scenes/Science/text';
import { beatY, cloudPoints, ecgModel, formatValue, levelsModel, niceStep, parseQuantity, ratioMode, T_PEAK, WINDOW, windowTag, type LevelsData, type RatioData } from './model';

const CASES = [
  'c01-room-without-breath', 'c02-ball-at-dusk', 'c03-shed-in-snow', 'c04-white-flower-supper',
  'c05-tiptoe-milk-bottle', 'c06-snowman-below-zero', 'c07-rose-that-bowed', 'c08-half-folded-towel',
];
const load = (id: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../content/cases', id, 'case.json'), 'utf8'));

describe('levels', () => {
  const o2: LevelsData = {
    kind: 'levels',
    title: 't',
    unit: '%',
    min: 0,
    max: 22,
    source: 's',
    levels: [
      { value: 21, label: 'a', detail: '', tone: 'safe' },
      { value: 18, label: 'b', detail: '', tone: 'warn' },
      { value: 6, label: 'c', detail: '', tone: 'fatal' },
    ],
  };
  it('descending data puts the maximum at the top', () => {
    const m = levelsModel(o2);
    expect(m.descending).toBe(true);
    expect(m.pos(22)).toBe(0);
    expect(m.pos(0)).toBe(1);
    expect(m.pos(21)).toBeLessThan(m.pos(18));
  });
  it('ascending data (time) puts the minimum at the top', () => {
    const m = levelsModel({ ...o2, min: 0, max: 16, levels: [...o2.levels].reverse().map((l, i) => ({ ...l, value: i * 5 })) });
    expect(m.descending).toBe(false);
    expect(m.pos(0)).toBe(0);
    expect(m.pos(16)).toBe(1);
  });
  it('bands cover the whole scale in order with the level tones', () => {
    const m = levelsModel(o2);
    expect(m.bands[0].from).toBe(0);
    expect(m.bands[m.bands.length - 1].to).toBe(1);
    for (let i = 1; i < m.bands.length; i++) expect(m.bands[i].from).toBeCloseTo(m.bands[i - 1].to);
    expect(m.bands.map((b) => b.tone)).toEqual(['safe', 'safe', 'warn', 'fatal']);
  });
  it('nice steps and value formatting', () => {
    expect(niceStep(22, 8)).toBe(5);
    expect(niceStep(12, 8)).toBe(2);
    expect(formatValue(9.8, '分')).toBe('9.8分');
    expect(formatValue(-15, '℃')).toBe('−15℃');
  });
  it('every real levels diagram yields monotonic positions', () => {
    for (const id of CASES) {
      for (const d of load(id).science.diagrams.filter((x: { kind: string }) => x.kind === 'levels') as LevelsData[]) {
        const m = levelsModel(d);
        const ps = d.levels.map((l) => m.pos(l.value));
        for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
        if (d.marker) expect(m.pos(d.marker.value)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('ecg', () => {
  it('the vulnerable window sits on the T-wave upslope just before its peak', () => {
    expect(WINDOW[1]).toBeLessThan(T_PEAK);
    expect(beatY(WINDOW[0])).toBeLessThan(beatY(WINDOW[1]));
    expect(beatY(0.272)).toBeGreaterThan(0.9); // R peak
  });
  it('builds paths that fit the width, with the impact inside the 2nd window', () => {
    for (const w of [300, 520, 760]) {
      const m = ecgModel(w, 220);
      expect(m.impactX).toBeGreaterThan(m.windows[1][0]);
      expect(m.impactX).toBeLessThan(m.windows[1][1]);
      expect(m.impactX).toBeLessThan(w - 40);
      const xs = [...m.vfPath.matchAll(/L([\d.]+),/g)].map((x) => Number(x[1]));
      expect(Math.max(...xs)).toBeLessThanOrEqual(w);
    }
  });
  it('takes the window tag from 「」 in the title', () => {
    expect(windowTag('心電図と「受攻期」')).toBe('受攻期');
    expect(windowTag('心電図')).toBe('危険な瞬間');
  });
});

describe('ratio', () => {
  const r = (a: string, b: string): RatioData => ({ kind: 'ratio', title: '', from: { value: a, label: '' }, to: { value: b, label: '' }, detail: '', source: '' });
  it('parses quantities', () => {
    expect(parseQuantity('約700')).toEqual({ prefix: '約', num: 700, unit: '' });
    expect(parseQuantity('−15℃')).toEqual({ prefix: '', num: -15, unit: '℃' });
    expect(parseQuantity('約−27℃')).toEqual({ prefix: '約', num: -27, unit: '℃' });
    expect(parseQuantity('たくさん')).toBeNull();
  });
  it('chooses expand / shift / plain', () => {
    expect(ratioMode(r('1', '約700'))).toMatchObject({ kind: 'expand', dots: 700, perDot: 1 });
    expect(ratioMode(r('−15℃', '約−27℃'))).toMatchObject({ kind: 'shift', a: -15, b: -27 });
    expect(ratioMode(r('1', '5000'))).toMatchObject({ kind: 'expand', perDot: 5 });
    expect(ratioMode(r('水', '氷')).kind).toBe('plain');
  });
  it('makes exactly n cloud points inside a unit-ish ellipse', () => {
    const pts = cloudPoints(700);
    expect(pts).toHaveLength(700);
    for (const p of pts) expect(Math.hypot(p.x, p.y / 0.62)).toBeLessThan(1.25);
  });
});

describe('science text helpers', () => {
  it('places every diagram of the real cases after a mechanism section', () => {
    for (const id of CASES) {
      const s = load(id).science;
      const slots = placeDiagrams(s);
      expect(slots).toHaveLength(s.mechanism.length);
      expect(slots.flat().sort()).toEqual(s.diagrams.map((_: unknown, i: number) => i));
    }
  });
  it('finds a short pull-quote', () => {
    for (const id of CASES) {
      const q = pullQuote(load(id).science);
      expect(q.length).toBeGreaterThan(8);
      expect([...q].length).toBeLessThanOrEqual(90);
    }
  });
});
