/**
 * PROTOTYPES — the browser side: the `?proto=` switches (src/config/proto.ts: i005, seeds and both
 * at once), the hidden saves of a prototype case, and the I-005 red-cabbage band mapping
 * (src/features/i005/closeness.ts).
 */
import { describe, expect, it } from 'vitest';
import { PROTOS, PROTO_I005, PROTO_SEEDS, PROTO_STORAGE_KEY, caseHiddenByProto, readProto, resolveProto } from '../src/config/proto';
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
    expect(PROTOS).toEqual([]);
    expect(PROTO_I005).toBe(false);
    expect(PROTO_SEEDS).toBe(false);
  });

  it('resolves URL first, then the remembered value of the tab', () => {
    expect(resolveProto('i005', null)).toEqual({ ids: ['i005'], store: 'set' });
    expect(resolveProto('I005', null)).toEqual({ ids: ['i005'], store: 'set' });
    expect(resolveProto(null, 'i005')).toEqual({ ids: ['i005'], store: 'keep' });
    expect(resolveProto(null, null)).toEqual({ ids: [], store: 'keep' });
    expect(resolveProto('off', 'i005')).toEqual({ ids: [], store: 'clear' });
    expect(resolveProto('banana', 'i005')).toEqual({ ids: ['i005'], store: 'keep' }); // an unknown value changes nothing
    expect(resolveProto('banana', 'evil')).toEqual({ ids: [], store: 'keep' }); // a tampered store is ignored
  });

  it('several switches coexist: ?proto=i005,seeds or ?proto=seeds&proto=i005; the URL says exactly which are on', () => {
    expect(resolveProto('seeds', null)).toEqual({ ids: ['seeds'], store: 'set' });
    expect(resolveProto('i005,seeds', null)).toEqual({ ids: ['i005', 'seeds'], store: 'set' });
    expect(resolveProto(['seeds', 'I005'], null)).toEqual({ ids: ['i005', 'seeds'], store: 'set' });
    expect(resolveProto('seeds,banana', 'i005')).toEqual({ ids: ['seeds'], store: 'set' }); // replaces, does not add
    expect(resolveProto(null, 'i005,seeds')).toEqual({ ids: ['i005', 'seeds'], store: 'keep' });
    expect(resolveProto(['seeds', 'off'], 'seeds')).toEqual({ ids: [], store: 'clear' });
    const s = memoryStorage();
    expect(readProto('?proto=i005,seeds', s)).toEqual(['i005', 'seeds']);
    expect(s.dump()).toEqual({ [PROTO_STORAGE_KEY]: 'i005,seeds' });
    expect(readProto('?proto=seeds&proto=i005', s)).toEqual(['i005', 'seeds']);
    expect(readProto('#/files', s)).toEqual(['i005', 'seeds']);
    expect(readProto('?proto=seeds', s)).toEqual(['seeds']);
    expect(s.dump()).toEqual({ [PROTO_STORAGE_KEY]: 'seeds' });
  });

  it('remembers ?proto=i005 for the session, so hash navigation (no query) keeps it; ?proto=off forgets it', () => {
    const s = memoryStorage();
    expect(readProto('?mute=1&proto=i005', s)).toEqual(['i005']);
    expect(s.dump()).toEqual({ [PROTO_STORAGE_KEY]: 'i005' });
    expect(readProto('', s)).toEqual(['i005']); // e.g. #/files after a reload without the query
    expect(readProto('?debug=1', s)).toEqual(['i005']);
    expect(readProto('?proto=off', s)).toEqual([]);
    expect(s.dump()).toEqual({});
    expect(readProto('', s)).toEqual([]);
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
    expect(readProto('?proto=i005', blocked)).toEqual(['i005']);
    expect(readProto('', blocked)).toEqual([]);
    expect(readProto('?proto=i005', null)).toEqual(['i005']);
  });

  it('hides a prototype case’s save only while its switch is off', () => {
    expect(caseHiddenByProto('c09-rescued-morning')).toBe(true); // no switch in tests
    expect(caseHiddenByProto('c09-rescued-morning', ['seeds'])).toBe(false);
    expect(caseHiddenByProto('c09-rescued-morning', ['i005'])).toBe(true);
    expect(caseHiddenByProto('c08-half-folded-towel')).toBe(false);
    expect(caseHiddenByProto('toString')).toBe(false); // not fooled by Object.prototype
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
