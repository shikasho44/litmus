/**
 * The small part of Cloudflare D1's binding API this project uses, typed structurally so no
 * @cloudflare/workers-types dependency is needed. The real binding (env.VERSUS_DB on the
 * Worker) satisfies it, and so does the node:sqlite adapter the tests use
 * (tests/cloudflare/sqlite-d1.ts), which runs the same SQL against a real SQLite.
 *
 *   db.prepare(sql).bind(...values).all()   → { results: rows }
 *   db.batch([stmt, stmt, …])               → one result per statement, run as ONE transaction
 *                                              (a failing statement rolls the whole batch back)
 */
export type D1Value = string | number | null;

export interface D1ResultLike<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
}

/** Duck-typing check for a D1 binding found on the Worker env. */
export function isD1(v: unknown): v is D1DatabaseLike {
  return !!v && typeof (v as D1DatabaseLike).prepare === 'function' && typeof (v as D1DatabaseLike).batch === 'function';
}
