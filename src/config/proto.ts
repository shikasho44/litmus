/**
 * Feature PROTOTYPES behind a URL switch (2026-10-03, docs/decisions.md 「I-005 の試作」).
 *
 * `?proto=i005` shows the four ideas from the supervisor's original 「ジェーンドゥの死因」 design
 * (docs/ideas/I-005-original-design.html): the サイエンスヒント mark on a finding card, the
 * red-cabbage 近い・遠い band after a verdict, the 余話 after the science page and the 矛盾の一文
 * under the case title. The choice is remembered for this tab (sessionStorage), so hash
 * navigation and reloads keep it; `?proto=off` forgets it. Without the switch nothing changes —
 * the case data fields are optional and every UI piece checks PROTO_I005.
 *
 * To adopt the prototype later: drop the PROTO_I005 checks (src/features/i005 holds the pieces).
 * To remove it: delete src/features/i005, this file, and the optional fields in shared/.
 */

export type ProtoId = 'i005';
const KNOWN: readonly ProtoId[] = ['i005'];
export const PROTO_STORAGE_KEY = 'janedoe:proto';

const isId = (v: unknown): v is ProtoId => typeof v === 'string' && (KNOWN as readonly string[]).includes(v);

/**
 * Pure resolution (tests): the URL wins (`off` clears, a known id sets), otherwise the remembered
 * value of this tab. `store` says what to write back to sessionStorage.
 */
export function resolveProto(query: string | null | undefined, stored: string | null | undefined): { id: ProtoId | null; store: 'set' | 'clear' | 'keep' } {
  const q = query?.trim().toLowerCase();
  if (q === 'off' || q === '0' || q === 'none') return { id: null, store: 'clear' };
  if (isId(q)) return { id: q, store: 'set' };
  return { id: isId(stored) ? stored : null, store: 'keep' };
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Reads the switch from a query string and a storage (both injectable for tests). */
export function readProto(search: string, storage: StorageLike | null): ProtoId | null {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(PROTO_STORAGE_KEY) ?? null;
  } catch {
    /* blocked storage: the URL alone decides */
  }
  const r = resolveProto(new URLSearchParams(search).get('proto'), stored);
  try {
    if (r.store === 'set' && r.id) storage?.setItem(PROTO_STORAGE_KEY, r.id);
    else if (r.store === 'clear') storage?.removeItem(PROTO_STORAGE_KEY);
  } catch {
    /* blocked storage: this page view only */
  }
  return r.id;
}

function boot(): ProtoId | null {
  try {
    let storage: StorageLike | null = null;
    try {
      storage = sessionStorage;
    } catch {
      /* no sessionStorage */
    }
    return readProto(location.search, storage);
  } catch {
    return null; // no location (tests, workers)
  }
}

export const PROTO: ProtoId | null = boot();
/** The I-005 prototype (サイエンスヒント・近さの色・余話・矛盾の一文) is on. */
export const PROTO_I005 = PROTO === 'i005';
