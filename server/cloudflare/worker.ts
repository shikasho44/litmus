/**
 * Cloudflare Worker entry (wrangler.jsonc `main`) — the AI-judged http build on Cloudflare,
 * https://litmus.fourthplace43.com/ (docs/DEPLOY.md §3).
 *
 *   /api, /api/*   → the same framework-free handler as Vercel and the dev server
 *                     (server/http/handler.ts), with
 *                       - the case content embedded at build time (content.generated.ts; no fs)
 *                       - online versus rooms in D1 (binding VERSUS_DB, server/versus/d1.ts)
 *                       - the daily AI spend summed across isolates in D1 (server/cloudflare/budget-d1.ts)
 *                       - an optional Cloudflare rate-limit binding in front of the AI routes
 *   everything else → static assets (dist/, SPA fallback). wrangler.jsonc sends only /api to
 *                     the Worker first; asset requests normally never reach this code.
 *   cron            → deletes expired versus rooms and old daily-spend rows.
 *
 * The runtime is built on the first request (not at import: Workers refuse random values in the
 * global scope) and cached per isolate for as long as the string env stays the same.
 */
import type { EnvLike } from '../engine/env.js';
import { ContentRegistry } from '../engine/registry.js';
import { createApiHandler, json } from '../http/handler.js';
import { createRuntime, type ApiRuntime } from '../http/runtime.js';
import { D1RoomStore } from '../versus/d1.js';
import { D1BudgetStore } from './budget-d1.js';
import { isD1, type D1DatabaseLike } from './d1.js';
import { rawContent } from './content.generated.js';

/** Workers rate-limiting binding (wrangler.jsonc `ratelimits`). */
interface RateLimitBinding {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export interface WorkerEnv {
  /** Static assets (wrangler.jsonc assets.binding). */
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** D1 "litmus-versus": versus rooms + daily spend. */
  VERSUS_DB?: D1DatabaseLike;
  /** Per-IP limit on the routes that can call the AI (ask, verdict). */
  AI_RATE_LIMITER?: RateLimitBinding;
  /** vars + secrets (strings); other bindings are ignored by the engine. */
  [k: string]: unknown;
}

export interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

/** The routes that may spend on the AI: rate-limited by the binding and budget-checked. */
const AI_ROUTES = new Set(['ask', 'inquest/verdict']);
/** How often an isolate re-reads the day's shared spend before an AI request. */
const BUDGET_REFRESH_MS = 15_000;

let registry: ContentRegistry | undefined;
/** Parsed once per isolate, on the first request that needs content. */
export function workerContent(): ContentRegistry {
  return (registry ??= ContentRegistry.fromRaw(rawContent()));
}

/** Only string values reach the engine (bindings are objects). */
function stringEnv(env: WorkerEnv): EnvLike {
  const out: EnvLike = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v;
  return out;
}

interface Cached {
  sig: string;
  db?: D1DatabaseLike;
  runtime: ApiRuntime;
  handler: (req: Request) => Promise<Response>;
}
let cached: Cached | undefined;

export function getWorkerRuntime(env: WorkerEnv, clock?: () => number): Cached {
  const senv = stringEnv(env);
  const db = isD1(env.VERSUS_DB) ? env.VERSUS_DB : undefined;
  // Values are only compared in memory, never logged.
  const sig = Object.keys(senv)
    .sort()
    .map((k) => `${k}=${senv[k]}`)
    .join('\n');
  if (cached && cached.sig === sig && cached.db === db) return cached;
  const runtime = createRuntime({
    env: senv,
    content: workerContent,
    clock,
    versusStore: { d1: db, serverless: true },
    budgetStore: db ? new D1BudgetStore(db, clock) : undefined,
  });
  cached = { sig, db, runtime, handler: createApiHandler(runtime) };
  return cached;
}

/**
 * The client IP for rate limits is Cloudflare's CF-Connecting-IP. Headers a client could send to
 * pose as someone else (Vercel's / proxies' forwarding headers) are dropped first, and the IP is
 * handed to the shared handler as x-real-ip.
 */
function clientRequest(request: Request): { req: Request; ip: string } {
  const h = new Headers(request.headers);
  for (const k of ['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip']) h.delete(k);
  const ip = (request.headers.get('cf-connecting-ip') ?? '').trim();
  if (ip) h.set('x-real-ip', ip);
  return { req: new Request(request, { headers: h }), ip: ip || 'local' };
}

export async function handleWorkerApi(request: Request, env: WorkerEnv, ctx?: ExecutionContextLike, clock?: () => number): Promise<Response> {
  const { runtime, handler } = getWorkerRuntime(env, clock);
  const { req, ip } = clientRequest(request);
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const aiRoute = req.method.toUpperCase() === 'POST' && AI_ROUTES.has(route);
  if (aiRoute) {
    if (env.AI_RATE_LIMITER) {
      try {
        const { success } = await env.AI_RATE_LIMITER.limit({ key: ip });
        if (!success) return json(429, { error: { code: 'rate_limited', message: 'too many requests (per minute)', retryable: true } }, { 'retry-after': '60' });
      } catch {
        // The binding is a first line only; the handler's own limiter still applies.
      }
    }
    await runtime.budget.refresh(BUDGET_REFRESH_MS);
  }
  const res = await handler(req);
  if (runtime.budget.unsent > 0) {
    const p = runtime.budget.flush();
    if (ctx) ctx.waitUntil(p);
    else await p;
  }
  return res;
}

/** Cron trigger: expired rooms and old spend rows. */
export async function scheduledCleanup(env: WorkerEnv, now = Date.now()): Promise<{ rooms: number }> {
  if (!isD1(env.VERSUS_DB)) return { rooms: 0 };
  const rooms = await new D1RoomStore(env.VERSUS_DB, () => now).purgeExpired(now);
  await new D1BudgetStore(env.VERSUS_DB, () => now).prune();
  return { rooms };
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) return handleWorkerApi(request, env, ctx);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_controller: unknown, env: WorkerEnv, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil(
      scheduledCleanup(env).then(
        (r) => console.log(JSON.stringify({ type: 'cron', roomsPurged: r.rooms })),
        (e) => console.error('[janedoe] cron cleanup failed', e instanceof Error ? e.message : e),
      ),
    );
  },
};
