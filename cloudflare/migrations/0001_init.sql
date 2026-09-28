-- D1 database "litmus-versus" (binding VERSUS_DB) for the Cloudflare Worker (docs/DEPLOY.md §3).
-- Applied with:  npx wrangler@4 d1 migrations apply litmus-versus --remote
-- The tests run this same file against node:sqlite (tests/cloudflare/sqlite-d1.ts).

-- Online versus rooms (server/versus/d1.ts, D1RoomStore): the Redis-hash model of
-- server/versus/store.ts. One room = one key; each hash field is one row, so every player
-- writes only its own rows and contested fields are claimed with INSERT … ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS vs_keys (
  k   TEXT PRIMARY KEY,
  exp INTEGER            -- expiry, epoch ms; NULL = never (the service always sets one)
);
CREATE INDEX IF NOT EXISTS vs_keys_exp ON vs_keys (exp);

CREATE TABLE IF NOT EXISTS vs_fields (
  k TEXT NOT NULL,
  f TEXT NOT NULL,
  v TEXT NOT NULL,
  PRIMARY KEY (k, f)
);

-- Estimated AI spend per UTC day, summed over every Worker isolate
-- (server/engine/budget.ts BudgetGuard + server/cloudflare/budget-d1.ts).
CREATE TABLE IF NOT EXISTS budget_daily (
  day        TEXT PRIMARY KEY,     -- YYYY-MM-DD (UTC)
  spent_usd  REAL NOT NULL DEFAULT 0,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL      -- epoch ms
);
