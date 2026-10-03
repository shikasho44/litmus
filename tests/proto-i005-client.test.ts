/**
 * PROTOTYPE I-005 — the browser side: the `?proto=i005` switch (src/config/proto.ts) and the
 * red-cabbage band mapping (src/features/i005/closeness.ts).
 */
import { describe, expect, it } from 'vitest';
import { PROTO, PROTO_I005, PROTO_STORAGE_KEY, readProto, resolveProto } from '../src/config/proto';
import { CLOSENESS_LABEL, CLOSENESS_LEVELS, TICK_AT, bandColor, bandPosition, readCloseness } from '../src/features/i005/closeness';

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe('the ?proto switch', () => {
  it('is off by default (no location in tests → the live default)', () => {
    expect(PROTO).toBeNull();
    expect(PROTO_I005).toBe(false);
  });

  it('resolves URL first, then the remembered value of the tab', () => {
    expect(resolveProto('i005', null)).toEqual({ id: 'i005', store: 'set' });
    expect(resolveProto('I005', null)).toEqual({ id: 'i005', store: 'set' });
    expect(resolveProto(null, 'i005')).toEqual({ id: 'i005', store: 'keep' });
    expect(resolveProto(null, null)).toEqual({ id: null, store: 'keep' });
    expect(resolveProto('off', 'i005')).toEqual({ id: null, store: 'clear' });
    expect(resolveProto('banana', 'i005')).toEqual({ id: 'i005', store: 'keep' }); // an unknown value changes nothing
    expect(resolveProto('banana', 'evil')).toEqual({ id: null, store: 'keep' }); // a tampered store is ignored
  });

  it('remembers ?proto=i005 for the session, so hash navigation (no query) keeps it; ?proto=off forgets it', () => {
    const s = memoryStorage();
    expect(readProto('?mute=1&proto=i005', s)).toBe('i005');
    expect(s.dump()).toEqual({ [PROTO_STORAGE_KEY]: 'i005' });
    expect(readProto('', s)).toBe('i005'); // e.g. #/files after a reload without the query
    expect(readProto('?debug=1', s)).toBe('i005');
    expect(readProto('?proto=off', s)).toBeNull();
    expect(s.dump()).toEqual({});
    expect(readProto('', s)).toBeNull();
  });

  it('works without storage (blocked / private mode): the URL alone decides', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readProto('?proto=i005', blocked)).toBe('i005');
    expect(readProto('', blocked)).toBeNull();
    expect(readProto('?proto=i005', null)).toBe('i005');
  });
});

describe('the red-cabbage band', () => {
  it('labels: 遠い／近い／正解／完璧な正解', () => {
    expect(CLOSENESS_LEVELS.map((l) => CLOSENESS_LABEL[l])).toEqual(['遠い', '近い', '正解', '完璧な正解']);
  });

  it('far (red) < near (purple) < correct (blue) < perfect (green); the share only moves the marker inside its zone', () => {
    const far0 = bandPosition({ level: 'far', ratio: 0 });
    const far1 = bandPosition({ level: 'far', ratio: 1 });
    const near0 = bandPosition({ level: 'near', ratio: 0.5 });
    const near1 = bandPosition({ level: 'near', ratio: 0.99 });
    const ok = bandPosition({ level: 'correct', ratio: 1 });
    const perfect = bandPosition({ level: 'perfect', ratio: 1 });
    expect(far0).toBeLessThan(far1);
    expect(far1).toBeLessThan(near0);
    expect(near0).toBeLessThan(near1);
    expect(near1).toBeLessThan(ok);
    expect(ok).toBeLessThan(perfect);
    expect(far1).toBeLessThanOrEqual(0.24); // red → pink
    expect(near0).toBeGreaterThanOrEqual(0.3);
    expect(near1).toBeLessThanOrEqual(0.5); // pink → purple
    expect(ok).toBe(0.68); // blue
    expect(perfect).toBe(0.94); // green
    // a garbage ratio never escapes the zone
    expect(bandPosition({ level: 'far', ratio: Number.NaN })).toBe(far0);
    expect(bandPosition({ level: 'near', ratio: 7 })).toBe(bandPosition({ level: 'near', ratio: 1 }));
  });

  it('colours: red at the far end, purple in the middle, blue at 正解, green at the perfect end', () => {
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
    const [r0, g0, b0] = rgb(bandColor(0.05));
    expect(r0).toBeGreaterThan(200);
    expect(g0).toBeLessThan(90);
    expect(b0).toBeLessThan(110);
    const [r5, , b5] = rgb(bandColor(0.5));
    expect(b5).toBeGreaterThan(r5); // purple leans blue
    const [r75, , b75] = rgb(bandColor(0.68));
    expect(b75).toBeGreaterThan(200);
    expect(r75).toBeLessThan(90);
    const [r95, g95] = rgb(bandColor(0.94));
    expect(g95).toBeGreaterThan(150);
    expect(r95).toBeLessThan(90);
    expect(Object.values(TICK_AT).every((x) => x > 0 && x < 1)).toBe(true);
  });

  it('reads only a well-formed closeness from the wire', () => {
    expect(readCloseness({ level: 'near', ratio: 0.667 })).toEqual({ level: 'near', ratio: 0.667 });
    expect(readCloseness({ level: 'near' })).toEqual({ level: 'near', ratio: 0 });
    expect(readCloseness({ level: 'perfect', ratio: 3 })).toEqual({ level: 'perfect', ratio: 1 });
    expect(readCloseness({ level: 'warm', ratio: 0.5 })).toBeNull();
    expect(readCloseness(undefined)).toBeNull();
    expect(readCloseness('near')).toBeNull();
  });
});
