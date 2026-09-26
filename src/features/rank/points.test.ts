import { describe, expect, it } from 'vitest';
import { DETECTIVE_LEVELS, detectiveLevel, detectiveTotal, resultPoints, runPoints, SPLUS_BONUS } from './points';

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

  it('0 is no badge yet, then Lv1..Lv5 at the thresholds', () => {
    const at = (t: number) => detectiveLevel(t).level;
    expect(at(0)).toBe(0);
    expect(detectiveLevel(0).name).toBe('まだ称号なし');
    expect(detectiveLevel(0).next?.level).toBe(1);
    expect(at(1)).toBe(1);
    expect(at(119)).toBe(1);
    expect(at(120)).toBe(2);
    expect(at(239)).toBe(2);
    expect(at(240)).toBe(3);
    expect(at(360)).toBe(4);
    expect(at(479)).toBe(4);
    expect(at(480)).toBe(5);
    expect(at(9999)).toBe(5);
    expect(DETECTIVE_LEVELS.map((l) => l.name)).toEqual(['駆け出し探偵', '一人前の探偵', '腕利き探偵', '名探偵', '伝説の名探偵']);
  });

  it('reports the next badge and the progress to it', () => {
    const l = detectiveLevel(180);
    expect(l).toMatchObject({ level: 2, total: 180, toNext: 60 });
    expect(l.next?.name).toBe('腕利き探偵');
    expect(l.progress).toBeCloseTo(0.5);
    const top = detectiveLevel(600);
    expect(top.next).toBeNull();
    expect(top.toNext).toBe(0);
    expect(top.progress).toBe(1);
    expect(detectiveLevel(1).progress).toBe(0);
  });

  it('the three current cases cannot reach the top badge (it opens with more cases)', () => {
    const max = 3 * runPoints(100, 'hard', 'S+').total;
    expect(detectiveLevel(max).level).toBe(4);
  });
});
