/**
 * Plain enum-like constants shared by the case schema, the server and the browser.
 *
 * Kept free of zod (and of any side effect) on purpose: the game client imports these as
 * values, and pulling them from `case-schema.ts` would drag zod and every schema object into
 * the entry chunk (≈86 KB) and trip the production CSP with zod's `Function('')` probe.
 * `case-schema.ts` re-exports them, so server code can keep importing from there.
 * Browser code under `src/` (except the admin console) must import from this file instead.
 */
export const FACT_CATEGORIES = ['人物', '場所', '時間', '物品', '身体', '環境', '証拠', '科学'] as const;
export const ANSWER_CLASSES = ['yes', 'no', 'partial', 'irrelevant', 'cannot', 'vague'] as const;
export const PROBE_KINDS = [
  'yes', 'no', 'irrelevant', 'ambiguous', 'indirect', 'core', 'spoiler-bait',
  'out-of-scope', 'paraphrase', 'typo', 'negated', 'multi', 'meta',
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];
export type AnswerClass = (typeof ANSWER_CLASSES)[number];
export type ProbeKind = (typeof PROBE_KINDS)[number];
