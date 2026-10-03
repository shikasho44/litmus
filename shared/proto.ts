/**
 * Prototype switches (2026-10-03 I-005, 2026-10-04 seeds and lab; docs/decisions.md).
 *
 * In the browser `?proto=<id>` turns a switch on for the tab (src/config/proto.ts); several at once
 * with `?proto=i005,seeds`. Without a switch nothing changes.
 *
 *   i005   the four I-005 pieces in the UI (サイエンスヒント・近さの色・余話・矛盾の一文)
 *   seeds  the prototype cases made from the 事件の種 (case seeds): case.json `proto: "seeds"`
 *   lab    the three sample puzzles of the I-001 リトマス・ラボ (provisional name; made the way the
 *          AI drafter would make them, no hand-made art): case.json `proto: "lab"`. Until 2026-10-04
 *          the switch was called `tsukuru` (the working word ツクール); `?proto=tsukuru` still turns
 *          `lab` on (PROTO_ALIASES) so old links work, but every doc and link says `?proto=lab`.
 *
 * A prototype CASE exists for a player only while its switch is on — in every build, whatever its
 * `publish` says: the server (server/engine/registry.ts) lists and serves it only to requests that
 * carry the switch (the http client sends PROTO_HEADER, the embedded client passes its switches in
 * the call options), and the browser keeps its saves out of 「続きから」 and the totals otherwise.
 * Online versus never offers a prototype case (its guests may not have the switch).
 *
 * Zod-free: the browser imports this file.
 */
export const PROTO_IDS = ['i005', 'seeds', 'lab'] as const;
export type ProtoId = (typeof PROTO_IDS)[number];

/**
 * Old names that still turn a switch on (silently: the switch is stored and sent under its new
 * name). `tsukuru` → `lab` (renamed 2026-10-04: 「ツクール」 was only a working word and overlaps
 * with RPGツクール). Drop an alias once old links no longer matter.
 */
export const PROTO_ALIASES: Readonly<Record<string, ProtoId>> = { tsukuru: 'lab' };

/** Request header with the caller's switches, comma separated (e.g. `seeds` or `i005,seeds`). */
export const PROTO_HEADER = 'x-janedoe-proto';

/**
 * The prototype cases by id: the browser's copy of case.json `proto` (the browser has no case
 * files, and a hidden case never comes back from the API), so the save of a hidden case stays out
 * of 「続きから」 and the 名探偵度数 even before the case list loads.
 * tests/engine/proto-seeds.test.ts keeps this equal to the case files.
 */
export const PROTO_CASES: Readonly<Record<string, ProtoId>> = {
  'c09-rescued-morning': 'seeds',
  // I-001 リトマス・ラボの見本 (2026-10-04)
  'c10-shaken-bottle': 'lab',
  'c11-wet-window': 'lab',
  'c12-two-shadows': 'lab',
};

export function isProtoId(v: unknown): v is ProtoId {
  return typeof v === 'string' && (PROTO_IDS as readonly string[]).includes(v);
}

/**
 * The known switches in a header / query / stored value: 'seeds', 'i005,seeds', 'seeds i005',
 * ['seeds', 'I005'] → unique, in PROTO_IDS order. An old name counts as its new one
 * (PROTO_ALIASES: 'tsukuru' → 'lab'). Unknown words are ignored.
 */
export function parseProtos(v: unknown): ProtoId[] {
  const words = (Array.isArray(v) ? v : [v])
    .filter((x): x is string => typeof x === 'string')
    .flatMap((x) => x.toLowerCase().split(/[\s,]+/u))
    .map((w) => (Object.prototype.hasOwnProperty.call(PROTO_ALIASES, w) ? PROTO_ALIASES[w] : w));
  return PROTO_IDS.filter((id) => words.includes(id));
}

/**
 * Whether a case is there for a caller. A prototype case (`caseProto` set) only when the caller's
 * switches include it; `protos` undefined = a tool's catalogue view (tests, validate, admin): the
 * prototype counts as unpublished. Every other case: published, or unpublished for dev / admin.
 */
export function caseVisible(c: { publish: boolean; proto?: string }, includeUnpublished: boolean, protos?: readonly string[]): boolean {
  if (c.proto) return protos ? protos.includes(c.proto) : includeUnpublished;
  return includeUnpublished || c.publish;
}
