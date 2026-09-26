/**
 * In-memory sliding-window rate limiter (per server instance). Good enough for a single
 * dev server and as a first line on serverless; put a platform-level limit (Vercel WAF /
 * OpenRouter key limits) in front for real abuse protection.
 */
export interface RateRule {
  limit: number;
  windowMs: number;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const DEFAULT_RATE_RULES: Record<string, RateRule[]> = {
  ask: [{ limit: 30, windowMs: MIN }, { limit: 600, windowMs: DAY }],
  verdict: [{ limit: 12, windowMs: MIN }, { limit: 200, windowMs: DAY }],
  write: [{ limit: 120, windowMs: MIN }, { limit: 3000, windowMs: DAY }],
  read: [{ limit: 240, windowMs: MIN }],
  admin: [{ limit: 120, windowMs: MIN }],
  /** Wrong x-admin-token guesses per IP. Over the limit, even a correct token is refused (429). */
  adminFail: [{ limit: 10, windowMs: MIN }, { limit: 50, windowMs: DAY }],
  /** Online versus (per IP — players of a collab stream may share one). */
  vsCreate: [{ limit: 6, windowMs: MIN }, { limit: 60, windowMs: DAY }],
  /** Joins also bound code guessing: 20 tries a minute against ~8.9e8 codes. */
  vsJoin: [{ limit: 20, windowMs: MIN }, { limit: 300, windowMs: DAY }],
  /** state polls: 4 tabs × 1 s in the lobby fits; the client backs off when hidden. */
  vsPoll: [{ limit: 240, windowMs: MIN }],
  vsWrite: [{ limit: 120, windowMs: MIN }, { limit: 5000, windowMs: DAY }],
};

export type RateResult = { ok: true } | { ok: false; retryAfterMs: number; limit: number; windowMs: number };

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxWindow: number;

  constructor(
    private readonly rules: Record<string, RateRule[]> = DEFAULT_RATE_RULES,
    private readonly clock: () => number = Date.now,
    private readonly maxKeys = 20_000,
  ) {
    this.maxWindow = Math.max(MIN, ...Object.values(rules).flat().map((r) => r.windowMs));
  }

  /** Records a hit for (bucket, key) unless a rule is exceeded. */
  check(bucket: string, key: string): RateResult {
    return this.evaluate(bucket, key, true);
  }

  /** Same verdict as check() without recording a hit. */
  peek(bucket: string, key: string): RateResult {
    return this.evaluate(bucket, key, false);
  }

  private evaluate(bucket: string, key: string, record: boolean): RateResult {
    const rules = this.rules[bucket];
    if (!rules || rules.length === 0) return { ok: true };
    const now = this.clock();
    const k = `${bucket}\u0000${key}`;
    const longest = Math.max(...rules.map((r) => r.windowMs));
    let arr = this.hits.get(k) ?? [];
    // Drop timestamps outside the longest window for this bucket.
    let drop = 0;
    while (drop < arr.length && arr[drop] <= now - longest) drop++;
    if (drop > 0) arr = arr.slice(drop);
    for (const r of rules) {
      const from = now - r.windowMs;
      // arr is sorted ascending: count entries > from
      let lo = 0, hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] > from) hi = mid;
        else lo = mid + 1;
      }
      const count = arr.length - lo;
      if (count >= r.limit) {
        this.hits.set(k, arr);
        const oldestInWindow = arr[arr.length - r.limit];
        return { ok: false, retryAfterMs: Math.max(1000, oldestInWindow + r.windowMs - now), limit: r.limit, windowMs: r.windowMs };
      }
    }
    if (!record) {
      if (arr.length > 0) this.hits.set(k, arr);
      return { ok: true };
    }
    arr.push(now);
    this.hits.set(k, arr);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [k, arr] of this.hits) {
      if (arr.length === 0 || arr[arr.length - 1] <= now - this.maxWindow) this.hits.delete(k);
    }
    // Still too many keys (flood of distinct IPs): drop the oldest half.
    if (this.hits.size > this.maxKeys) {
      const keys = [...this.hits.keys()];
      for (const k of keys.slice(0, Math.floor(keys.length / 2))) this.hits.delete(k);
    }
  }

  size(): number {
    return this.hits.size;
  }
}
