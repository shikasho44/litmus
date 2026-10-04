/**
 * The shelves of the 事件ファイル screen (2026-10-04, docs/decisions.md 「事件ファイルを棚に分けた」).
 *
 *   kurare    「くられ先生監修」 cases written for the supervisor's scientific supervision (and, later,
 *             cases he writes himself). The shelf says 監修中 until a case is human-reviewed — it
 *             never claims a supervision that has not happened.
 *   original  「オリジナル」 the game's own cases, not under supervision (the intro cases, the seeds
 *             prototype c09).
 *   lab       「リトマス・ラボ」 puzzles made by players with an AI (now the three samples c10–c12),
 *             unreviewed. Only prototype `lab` cases may stand here (validate.ts), so the shelf
 *             exists for a player only with ?proto=lab.
 *
 * case.json `shelf` is optional: without it a `proto: "lab"` case is on the lab shelf and every
 * other case on the original shelf. Zod-free: the browser imports this file.
 */
export const SHELF_IDS = ['kurare', 'original', 'lab'] as const;
export type ShelfId = (typeof SHELF_IDS)[number];

export function isShelfId(v: unknown): v is ShelfId {
  return typeof v === 'string' && (SHELF_IDS as readonly string[]).includes(v);
}

/** The shelf a case stands on: its `shelf` field, else lab for a `lab` prototype, else original. */
export function caseShelf(c: { shelf?: string; proto?: string }): ShelfId {
  if (isShelfId(c.shelf)) return c.shelf;
  return c.proto === 'lab' ? 'lab' : 'original';
}

/**
 * An OFFICIAL case: a public case (no prototype switch) on the kurare or original shelf. The
 * 事件ファイル counters (SOLVED / COMPLETE / 初見タイム合計) count these only, so they read x/8 with
 * or without a switch; the prototype cases are counted on their own shelf.
 */
export function isOfficialCase(c: { shelf?: string; proto?: string }): boolean {
  return !c.proto && caseShelf(c) !== 'lab';
}
