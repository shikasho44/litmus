/**
 * A D1-compatible database on node:sqlite (built into Node 24, no npm dependency) for tests:
 * the SQL of server/versus/d1.ts and server/cloudflare/budget-d1.ts runs against a real SQLite
 * (D1 is SQLite), with the schema from cloudflare/migrations/*.sql.
 *
 * Mirrors the D1 behaviour the code relies on: prepare().bind() is immutable, all() returns
 * { results, meta.changes }, first() the first row or null, batch() runs the statements as one
 * transaction (a failing statement rolls every earlier one back and rejects).
 *
 * `failNext(n)` makes the next n calls reject (store-outage tests); `calls` counts round trips.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike, D1Value } from '../../server/cloudflare/d1';

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown };
};
const require = createRequire(import.meta.url);

const MIGRATIONS = fileURLToPath(new URL('../../cloudflare/migrations/', import.meta.url));

export class SqliteD1 implements D1DatabaseLike {
  readonly db: SqliteDb;
  calls = 0;
  private failures = 0;

  constructor() {
    // Loaded lazily through require so importing this helper never trips module resolution.
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => SqliteDb };
    this.db = new DatabaseSync(':memory:');
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) this.db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }

  failNext(n = 1): void {
    this.failures += n;
  }

  private gate(): void {
    this.calls++;
    if (this.failures > 0) {
      this.failures--;
      throw new Error('D1_ERROR: simulated outage');
    }
  }

  /** Runs one statement: rows (for RETURNING / SELECT) and the change count. */
  execOne(sql: string, values: D1Value[]): D1ResultLike {
    const rows = this.db.prepare(sql).all(...values) as Record<string, unknown>[];
    const changes = Number((this.db.prepare('SELECT changes() AS n').get() as { n: number }).n);
    return { results: rows.map((r) => ({ ...r })), success: true, meta: { changes } };
  }

  prepare(sql: string): D1PreparedStatementLike {
    return new Stmt(this, sql, []);
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> {
    this.gate();
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => {
        const st = s as Stmt;
        return this.execOne(st.sql, st.values) as D1ResultLike<T>;
      });
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Test peek: every row of a table. */
  rows(table: string): Record<string, unknown>[] {
    return (this.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]).map((r) => ({ ...r }));
  }

  async runSingle(sql: string, values: D1Value[]): Promise<D1ResultLike> {
    this.gate();
    return this.execOne(sql, values);
  }
}

class Stmt implements D1PreparedStatementLike {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    readonly values: D1Value[],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    return new Stmt(this.owner, this.sql, values);
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return (await this.owner.runSingle(this.sql, this.values)) as D1ResultLike<T>;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const r = await this.owner.runSingle(this.sql, this.values);
    return ((r.results ?? [])[0] as T | undefined) ?? null;
  }

  async run(): Promise<D1ResultLike> {
    return this.owner.runSingle(this.sql, this.values);
  }
}
