/**
 * Prototype switches (2026-10-03 I-005, 2026-10-04 seeds; docs/decisions.md).
 *
 * In the browser `?proto=<id>` turns a switch on for the tab (src/config/proto.ts); several at once
 * with `?proto=i005,seeds`. Without a switch nothing changes.
 *
 *   i005   the four I-005 pieces in the UI (サイエンスヒント・近さの色・余話・矛盾の一文)
 *   seeds  the prototype cases made from the 事件の種 (case seeds): case.json `proto: "seeds"`
 *
 * A prototype CASE exists for a player only while its switch is on — in every build, whatever its
 * `publish` says: the server (server/engine/registry.ts) lists and serves it only to requests that
 * carry the switch (the http client sends PROTO_HEADER, the embedded client passes its switches in
 * the call options), and the browser keeps its saves out of 「続きから」 and the totals otherwise.
 * Online versus never offers a prototype case (its guests may not have the switch).
 *
 * Zod-free: the browser imports this file.
 */
export const PROTO_IDS = ['i005', 'seeds'] as const;
export type ProtoId = (typeof PROTO_IDS)[number];

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
};

export function isProtoId(v: unknown): v is ProtoId {
  return typeof v === 'string' && (PROTO_IDS as readonly string[]).includes(v);
}

/**
 * The known switches in a header / query / stored value: 'seeds', 'i005,seeds', 'seeds i005',
 * ['seeds', 'I005'] → unique, in PROTO_IDS order. Unknown words are ignored.
 */
export function parseProtos(v: unknown): ProtoId[] {
  const words = (Array.isArray(v) ? v : [v])
    .filter((x): x is string => typeof x === 'string')
    .flatMap((x) => x.toLowerCase().split(/[\s,]+/u));
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
