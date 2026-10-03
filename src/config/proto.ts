/**
 * Feature PROTOTYPES behind a URL switch (docs/decisions.md 「I-005 の試作」 2026-10-03,
 * 「事件の種 No.4『助けられた朝』を試作」 2026-10-04, 「I-001 ツクールの見本3問」 2026-10-04 and its rename to
 * リトマス・ラボ 2026-10-04). The switches themselves live in shared/proto.ts (the server reads them too).
 *
 *   ?proto=i005        the four ideas from the supervisor's original 「ジェーンドゥの死因」 design
 *                      (docs/ideas/I-005-original-design.html): the サイエンスヒント mark on a finding
 *                      card, the red-cabbage 近い・遠い band after a verdict, the 余話 after the science
 *                      page and the 矛盾の一文 under the case title (src/features/i005)
 *   ?proto=seeds       the prototype cases made from the 事件の種 (case.json `proto: "seeds"`):
 *                      listed, playable and counted only with the switch (shared/proto.ts)
 *   ?proto=lab         the three sample puzzles of the I-001 リトマス・ラボ (provisional name;
 *                      case.json `proto: "lab"`, docs/ideas/I-001-samples.html): same rules as seeds;
 *                      their case card says 「ラボの見本（やさしい謎・AIと作った）」 (src/ui/CaseTag.tsx).
 *                      The old `?proto=tsukuru` still works (shared/proto.ts PROTO_ALIASES) and is
 *                      remembered as `lab`
 *   ?proto=i005,seeds  both (`?proto=seeds&proto=i005` works too)
 *
 * The URL says exactly which switches are on; the choice is remembered for this tab
 * (sessionStorage), so hash navigation and reloads keep it; `?proto=off` forgets it. Without a
 * switch nothing changes — the case data fields are optional, every UI piece checks PROTO_I005,
 * and the server hides a prototype case from requests without its switch (src/api/http.ts sends them).
 *
 * To adopt I-005 later: drop the PROTO_I005 checks (src/features/i005 holds the pieces).
 * To publish a seeds case: drop its `proto` field and its PROTO_CASES entry, set `publish: true`.
 */
import { PROTO_CASES, parseProtos, type ProtoId } from '../../shared/proto';

export type { ProtoId };
export const PROTO_STORAGE_KEY = 'janedoe:proto';

/**
 * Pure resolution (tests): the URL wins (`off` clears, known ids set exactly those), otherwise the
 * remembered value of this tab. `store` says what to write back to sessionStorage.
 */
export function resolveProto(query: readonly string[] | string | null | undefined, stored: string | null | undefined): { ids: ProtoId[]; store: 'set' | 'clear' | 'keep' } {
  const words = (Array.isArray(query) ? query : query == null ? [] : [query]).map((q) => q.trim().toLowerCase());
  if (words.some((q) => q === 'off' || q === '0' || q === 'none')) return { ids: [], store: 'clear' };
  const fromUrl = parseProtos(words);
  if (fromUrl.length > 0) return { ids: fromUrl, store: 'set' };
  return { ids: parseProtos(stored ?? ''), store: 'keep' };
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Reads the switches from a query string and a storage (both injectable for tests). */
export function readProto(search: string, storage: StorageLike | null): ProtoId[] {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(PROTO_STORAGE_KEY) ?? null;
  } catch {
    /* blocked storage: the URL alone decides */
  }
  const r = resolveProto(new URLSearchParams(search).getAll('proto'), stored);
  try {
    if (r.store === 'set') storage?.setItem(PROTO_STORAGE_KEY, r.ids.join(','));
    else if (r.store === 'clear') storage?.removeItem(PROTO_STORAGE_KEY);
  } catch {
    /* blocked storage: this page view only */
  }
  return r.ids;
}

function boot(): ProtoId[] {
  try {
    let storage: StorageLike | null = null;
    try {
      storage = sessionStorage;
    } catch {
      /* no sessionStorage */
    }
    return readProto(location.search, storage);
  } catch {
    return []; // no location (tests, workers)
  }
}

/** The switches on in this tab, in shared/proto.ts PROTO_IDS order. */
export const PROTOS: readonly ProtoId[] = boot();
/** The I-005 prototype (サイエンスヒント・近さの色・余話・矛盾の一文) is on. */
export const PROTO_I005 = PROTOS.includes('i005');
/** The 事件の種 prototype cases are on (listed, playable, counted). */
export const PROTO_SEEDS = PROTOS.includes('seeds');
/** The I-001 リトマス・ラボ sample puzzles are on (listed, playable, counted). */
export const PROTO_LAB = PROTOS.includes('lab');

/**
 * A prototype case whose switch is off in this tab: its save stays out of 「続きから」, the
 * 名探偵度数 and the counts (the server does not list or serve it either).
 */
export function caseHiddenByProto(caseId: string, on: readonly string[] = PROTOS): boolean {
  const p = Object.prototype.hasOwnProperty.call(PROTO_CASES, caseId) ? PROTO_CASES[caseId] : undefined;
  return !!p && !on.includes(p);
}
