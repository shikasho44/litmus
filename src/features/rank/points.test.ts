import { describe, expect, it } from 'vitest';
import { DETECTIVE_LEVELS, LEGEND_STAR_STEP, NO_DETECTIVE_RANK, TOP_DETECTIVE_LEVEL, detectiveLevel, detectiveRank, detectiveTier, detectiveTotal, resultPoints, runPoints, SPLUS_BONUS } from './points';

describe('獲得度数 (runPoints)', () => {
  it('score × difficulty multiplier, rounded', () => {
    expect(runPoints(100, 'normal', 'S').total).toBe(100);
    expect(runPoints(100, 'easy', 'S').total).toBe(60);
    expect(runPoints(100, 'hard', 'S').total).toBe(140);
    expect(runPoints(88, 'hard', 'S').total).toBe(123); // 123.2
    expect(runPoints(85, 'easy', 'A').total).toBe(51);
    expect(runPoints(73, 'normal', 'A')).toMatchObject({ base: 73, bonus: 0, multiplier: 1 });
  });

  it('S+ adds the bonus on top', () => {
    expect(runPoints(100, 'hard', 'S+')).toMatchObject({ base: 140, bonus: SPLUS_BONUS, total: 150 });
    expect(runPoints(96, 'easy', 'S+').total).toBe(58 + SPLUS_BONUS);
  });

  it('is robust to junk', () => {
    expect(runPoints(NaN, undefined, 'C').total).toBe(0);
    expect(runPoints(-5, 'normal', 'C').total).toBe(0);
    expect(runPoints(250, 'normal', 'S').total).toBe(100);
    expect(runPoints(90, 'bogus' as never, 'S').multiplier).toBe(1);
  });

  it('a stored run uses its stats.points, an older one is recomputed from its score', () => {
    expect(resultPoints({ rank: 'A', playDifficulty: 'hard', stats: { score: 80, points: 77 } }).total).toBe(77);
    expect(resultPoints({ rank: 'A', playDifficulty: 'hard', stats: { score: 80 } }).total).toBe(112);
    expect(resultPoints({ rank: 'S+', stats: { score: 100 } }).total).toBe(110);
    expect(resultPoints({ rank: 'S', stats: {} }).total).toBe(0);
  });
});

describe('名探偵度数 (detectiveTotal / detectiveLevel)', () => {
  it('sums every case best', () => {
    expect(detectiveTotal({ a: { bestPoints: 100 }, b: { bestPoints: 58 }, c: {} })).toBe(158);
    expect(detectiveTotal({})).toBe(0);
    expect(detectiveTotal(undefined)).toBe(0);
  });

  it('0 is no badge yet, then Lv1..Lv11 at the thresholds (11 named levels, 2026-10-04)', () => {
    const at = (t: number) => detectiveLevel(t).level;
    expect(at(0)).toBe(0);
    expect(detectiveLevel(0).name).toBe('まだ称号なし');
    expect(detectiveLevel(0).next.level).toBe(1);
    expect(at(1)).toBe(1);
    expect(at(79)).toBe(1);
    expect(at(80)).toBe(2);
    expect(at(179)).toBe(2);
    expect(at(180)).toBe(3);
    expect(at(849)).toBe(6);
    expect(at(850)).toBe(7);
    expect(at(2499)).toBe(10);
    expect(at(2500)).toBe(11);
    expect(DETECTIVE_LEVELS.map((l) => l.name)).toEqual([
      '駆け出し探偵', '一人前の探偵', '所見を読む探偵', '腕利き探偵', '検死に通じた探偵', '審問の切れ者',
      '名探偵', '死因を見抜く名探偵', '名を還す名探偵', '零番安置室の名探偵', '伝説の名探偵',
    ]);
    expect(DETECTIVE_LEVELS.length).toBeGreaterThanOrEqual(10);
    expect(TOP_DETECTIVE_LEVEL).toBe(11);
  });

  it('the thresholds rise, and the steps between them never shrink', () => {
    const mins = DETECTIVE_LEVELS.map((l) => l.min);
    DETECTIVE_LEVELS.forEach((l, i) => expect(l.level).toBe(i + 1));
    const steps = mins.slice(1).map((m, i) => m - mins[i]);
    for (let i = 1; i < steps.length; i++) expect(steps[i], `step ${i + 1}→${i + 2}`).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(LEGEND_STAR_STEP).toBeGreaterThanOrEqual(steps[steps.length - 1]);
  });

  it('never ends: past 伝説の名探偵 a ★ every LEGEND_STAR_STEP, one level each', () => {
    const top = DETECTIVE_LEVELS[DETECTIVE_LEVELS.length - 1];
    const legend = detectiveLevel(top.min + 120);
    expect(legend).toMatchObject({ level: 11, name: '伝説の名探偵', stars: 0, toNext: LEGEND_STAR_STEP - 120 });
    expect(legend.next).toMatchObject({ level: 12, name: '伝説の名探偵 ★2', stars: 2, min: top.min + LEGEND_STAR_STEP });
    expect(detectiveLevel(top.min + LEGEND_STAR_STEP)).toMatchObject({ level: 12, name: '伝説の名探偵 ★2', stars: 2 });
    expect(detectiveLevel(top.min + 3 * LEGEND_STAR_STEP + 1)).toMatchObject({ level: 14, name: '伝説の名探偵 ★4', stars: 4, toNext: LEGEND_STAR_STEP - 1 });
    expect(detectiveLevel(99_999).next.level).toBe(detectiveLevel(99_999).level + 1);
    expect(detectiveRank(13)).toMatchObject({ name: '伝説の名探偵 ★3', min: top.min + 2 * LEGEND_STAR_STEP });
    expect(detectiveRank(0)).toBe(NO_DETECTIVE_RANK);
    expect(detectiveRank(7).name).toBe('名探偵');
  });

  it('badge tiers: one per named level, the ★ tail keeps the top one', () => {
    expect([0, 1, 7, 11, 12, 40].map(detectiveTier)).toEqual([0, 1, 7, 11, 11, 11]);
    expect(detectiveTier(-3)).toBe(0);
  });

  it('reports the next badge and the progress to it', () => {
    const l = detectiveLevel(130);
    expect(l).toMatchObject({ level: 2, total: 130, toNext: 50 });
    expect(l.next.name).toBe('所見を読む探偵');
    expect(l.progress).toBeCloseTo(0.5);
    expect(detectiveLevel(1).progress).toBe(0);
    expect(detectiveLevel(2500 + 250).progress).toBeCloseTo(0.5);
  });

  describe('growth (the owner’s request 2026-10-04: quick at first, real tuning above)', () => {
    const normalS = runPoints(100, 'normal', 'S').total; // 100
    const normalSPlus = runPoints(100, 'normal', 'S+').total; // 110
    const typical = runPoints(85, 'normal', 'A').total; // 85
    const max = runPoints(100, 'hard', 'S+').total; // 150

    it('Lv2 after about one solved case, Lv3 after about two', () => {
      expect(detectiveLevel(typical).level).toBe(2);
      expect(detectiveLevel(runPoints(90, 'easy', 'A').total).level).toBe(1); // 見習い: two cases
      expect(detectiveLevel(2 * runPoints(90, 'easy', 'A').total).level).toBe(2);
      expect(detectiveLevel(2 * typical).level).toBe(2);
      expect(detectiveLevel(2 * runPoints(90, 'normal', 'S').total).level).toBe(3);
    });

    it('名探偵 takes about the eight official cases played well, not a handful', () => {
      expect(detectiveLevel(8 * normalSPlus).name).toBe('名探偵');
      expect(detectiveLevel(8 * typical).level).toBeLessThan(7);
      expect(detectiveLevel(5 * max).level).toBeLessThan(7);
    });

    it('伝説の名探偵 needs far more than today’s eight cases: 17 at the maximum, about 20 at high play', () => {
      expect(detectiveLevel(8 * max).level).toBe(8); // today’s content at its very best
      expect(detectiveLevel(16 * max).level).toBeLessThan(11);
      expect(detectiveLevel(17 * max).name).toBe('伝説の名探偵');
      expect(detectiveLevel(19 * 125).level).toBeLessThan(11);
      expect(detectiveLevel(20 * 125).level).toBe(11);
      expect(detectiveLevel(22 * normalSPlus).level).toBeLessThan(11);
      expect(normalS).toBe(100);
    });
  });
});
