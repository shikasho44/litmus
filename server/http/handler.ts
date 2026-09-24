/**
 * Framework-free HTTP layer: (Request) → Response, routing every GameApi method under
 * /api/*. Used by the Vite plugin (dev + preview) and the Vercel function via
 * server/node/handler.ts (which injects the file-system content source).
 *
 * Routes (JSON in / JSON out):
 *   GET  /api/health                    public: {ok, version} · dev / admin: full server state
 *   GET  /api/cases                     → CaseSummary[]
 *   GET  /api/cases/:id                 → CasePublic
 *   POST /api/token                     {caseId} → {token, progress}
 *   POST /api/ask                       AskRequest → AskResponse
 *   POST /api/hint                      HintRequest → HintResponse
 *   POST /api/inquest/start             InquestStartRequest → InquestStartResponse
 *   POST /api/inquest/shot              ShotRequest → ShotResponse
 *   POST /api/inquest/grant             GrantRequest → ShotResponse
 *   POST /api/inquest/verdict           VerdictRequest → VerdictResponse
 *   POST /api/reconstruction            ReconstructionRequest → ReconstructionView
 *   POST /api/reconstruction/submit     ReconstructionSubmit → ReconstructionResult
 *   POST /api/solution                  {caseId, token} → SolutionResponse
 *   Admin (dev, or production with header x-admin-token === ADMIN_TOKEN (≥ 32 chars); else 404;
 *   wrong tokens are rate-limited per IP — over the limit every token attempt is 429):
 *   GET  /api/admin/status | /api/admin/cases | /api/admin/traces | /api/admin/bench
 *   POST /api/admin/ask-debug           {caseId, question, token?, mode?}
 *   POST /api/admin/mint-token          {caseId, stage: fresh|investigated|debated|solved|reconstructed}  (QA shortcut)
 *
 * Errors: { error: { code, message, retryable } } with code ∈ ApiError codes.
 *
 * Fail closed: in production without a usable SESSION_SECRET (runtime.config.misconfigured)
 * every POST route (they all sign or verify a progress token) answers
 * 503 { code: 'server', message: 'server misconfigured', retryable: false }.
 */
import { ApiError, type PipelineMode } from '../../shared/api.js';
import { EngineError, statusOf } from '../engine/errors.js';
import { MAX_QUESTION_CHARS } from '../engine/normalize.js';
import { detectSafety } from '../engine/safety.js';
import { MAX_VERDICT_CHARS } from '../engine/game.js';
import { PIPELINE_MODES } from '../engine/env.js';
import { hmacSha256 } from '../engine/sha256.js';
import type { ContentRegistry } from '../engine/registry.js';
import { validateParsedCase, type CaseValidation } from '../engine/validate.js';
import type { ApiRuntime } from './runtime.js';

export const MAX_BODY_BYTES = 8 * 1024;
export const API_VERSION = '1';

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'interest-cohort=()',
};

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...extra } });
}

function errorResponse(e: unknown): Response {
  const status = statusOf(e);
  if (e instanceof ApiError) {
    const extra: Record<string, string> = {};
    if (status === 429) extra['retry-after'] = String((e as EngineError & { retryAfterSec?: number }).retryAfterSec ?? 60);
    return json(status, { error: { code: e.code, message: e.message, retryable: e.retryable } }, extra);
  }
  console.error('[janedoe] unhandled API error', e);
  return json(500, { error: { code: 'server', message: 'internal error', retryable: true } });
}

function clientIp(req: Request): string {
  const h = req.headers;
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : '');
  return first(h.get('x-vercel-forwarded-for')) || first(h.get('x-real-ip')) || first(h.get('x-forwarded-for')) || 'local';
}

/** Per-process key: both strings are compared as fixed-length HMAC digests (no length leak). */
const EQ_KEY: Uint8Array = (() => {
  const b = new Uint8Array(32);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
})();
const utf8 = new TextEncoder();
/** Longer headers are never a valid token (and are not worth hashing). */
const MAX_ADMIN_HEADER = 512;

export function safeEqual(a: string, b: string): boolean {
  const da = hmacSha256(EQ_KEY, utf8.encode(a));
  const db = hmacSha256(EQ_KEY, utf8.encode(b));
  let d = 0;
  for (let i = 0; i < da.length; i++) d |= da[i] ^ db[i];
  return d === 0 && da.length === db.length;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new EngineError('bad_request', 'request body too large', 413);
  let text: string;
  try {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) throw new EngineError('bad_request', 'request body too large', 413);
    text = new TextDecoder().decode(buf);
  } catch (e) {
    if (e instanceof EngineError) throw e;
    throw new EngineError('bad_request', 'cannot read request body', 400);
  }
  if (text.trim() === '') return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new EngineError('bad_request', 'body is not valid JSON', 400);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new EngineError('bad_request', 'body must be a JSON object', 400);
  return v as Record<string, unknown>;
}

const validationCache = new WeakMap<ContentRegistry, CaseValidation[]>();
async function validations(rt: ApiRuntime): Promise<{ reg: ContentRegistry; list: CaseValidation[] }> {
  const reg = await rt.content();
  let list = validationCache.get(reg);
  if (!list) {
    list = reg.cases.map((c) => validateParsedCase(c.data, { path: c.path, assetExists: rt.assetExists }));
    validationCache.set(reg, list);
  }
  return { reg, list };
}

type Route = (ctx: { req: Request; url: URL; params: string[]; admin: boolean; ip: string; body: () => Promise<Record<string, unknown>> }) => Promise<Response>;

export function createApiHandler(rt: ApiRuntime): (req: Request) => Promise<Response> {
  const svc = rt.service;
  const dev = rt.config.dev;

  const limit = (bucket: string, key: string) => {
    const r = rt.limiter.check(bucket, key);
    if (!r.ok) {
      const e = new EngineError('rate_limited', `too many requests (${r.limit} per ${Math.round(r.windowMs / 1000)}s)`, 429, true) as EngineError & { retryAfterSec?: number };
      e.retryAfterSec = Math.ceil(r.retryAfterMs / 1000);
      throw e;
    }
  };

  const get: Record<string, Route> = {
    health: async ({ admin, ip }) => {
      // Public: liveness only (503 while the server is misconfigured). Internal state is for
      // dev / admin (and /api/admin/status) — it used to tell anyone the key was the default.
      if (!admin) {
        limit('read', ip);
        const ok = !rt.config.misconfigured;
        return json(ok ? 200 : 503, { ok, version: API_VERSION });
      }
      const reg = await rt.content();
      return json(200, {
        ok: !rt.config.misconfigured,
        version: API_VERSION,
        mode: rt.components.mode,
        requestedMode: rt.config.mode,
        cases: reg.list(dev).length,
        contentIssues: reg.issues.filter((i) => i.level === 'error').length,
        dev,
        secretConfigured: !rt.config.secretIsDefault && !rt.config.secretTooShort,
        misconfigured: rt.config.misconfigured ?? null,
        budgetExceeded: rt.budget.exceeded(),
        uptimeSec: Math.round((Date.now() - rt.startedAt) / 1000),
      });
    },
    cases: async ({ params, admin, ip }) => {
      limit('read', ip);
      if (params.length === 0) return json(200, await svc.listCases({ admin }));
      if (params.length === 1) return json(200, await svc.getCase(decodeURIComponent(params[0]), { admin }));
      throw new EngineError('bad_request', 'not found', 404);
    },
  };

  const post: Record<string, Route> = {
    token: async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.newToken(b.caseId as string, { admin }));
    },
    ask: async ({ body, admin, ip }) => {
      limit('ask', ip);
      const b = await body();
      if (typeof b.question !== 'string') throw new EngineError('bad_request', 'question is required', 400);
      // Over-long is refused — except a message the safety filter answers (support notice first).
      if ([...b.question].length > MAX_QUESTION_CHARS && !detectSafety(b.question)) throw new EngineError('bad_request', `question is too long (max ${MAX_QUESTION_CHARS})`, 400);
      return json(200, await svc.ask({ caseId: b.caseId as string, question: b.question, token: b.token as string | undefined }, { admin, withTrace: dev || admin }));
    },
    hint: async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.hint({ caseId: b.caseId as string, token: b.token as string }, { admin }));
    },
    'inquest/start': async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.inquestStart({ caseId: b.caseId as string, token: b.token as string }, { admin }));
    },
    'inquest/shot': async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.shot(b as never, { admin }));
    },
    'inquest/grant': async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.grant(b as never, { admin }));
    },
    'inquest/verdict': async ({ body, admin, ip }) => {
      limit('verdict', ip);
      const b = await body();
      if (typeof b.text !== 'string') throw new EngineError('bad_request', 'text is required', 400);
      if ([...b.text].length > MAX_VERDICT_CHARS && detectSafety(b.text)?.kind !== 'selfHarm') throw new EngineError('bad_request', `text is too long (max ${MAX_VERDICT_CHARS})`, 400);
      return json(200, await svc.verdict({ caseId: b.caseId as string, token: b.token as string, text: b.text }, { admin, withTrace: dev || admin }));
    },
    reconstruction: async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.reconstruction({ caseId: b.caseId as string, token: b.token as string }, { admin }));
    },
    'reconstruction/submit': async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.submitReconstruction(b as never, { admin }));
    },
    solution: async ({ body, admin, ip }) => {
      limit('write', ip);
      const b = await body();
      return json(200, await svc.solution({ caseId: b.caseId as string, token: b.token as string }, { admin }));
    },
  };

  const adminGet: Record<string, Route> = {
    status: async () =>
      json(200, {
        mode: rt.components.mode,
        requestedMode: rt.config.mode,
        decisionProvider: rt.config.decisionProvider,
        llmProvider: rt.config.llmProvider,
        llmModel: rt.config.llmModel ?? null,
        jevModel: rt.config.jevModel,
        hasOpenRouterKey: rt.config.hasOpenRouterKey,
        secretConfigured: !rt.config.secretIsDefault && !rt.config.secretTooShort,
        misconfigured: rt.config.misconfigured ?? null,
        budget: rt.budget.status(),
        warnings: rt.warnings,
        rateLimiterKeys: rt.limiter.size(),
        dev,
      }),
    cases: async () => {
      const { reg, list } = await validations(rt);
      return json(200, {
        cases: reg.cases.map((c, i) => ({ id: c.data.id, path: c.path, publish: c.data.publish, reviewStatus: c.data.reviewStatus, validation: list[i], data: c.data })),
        issues: reg.issues,
        lines: reg.lines.info,
        prologue: !!reg.prologue,
      });
    },
    traces: async ({ url }) => {
      const n = Math.min(300, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      return json(200, rt.traces.list(n, url.searchParams.get('caseId') ?? undefined));
    },
    bench: async () => json(200, rt.listBenchReports ? await rt.listBenchReports().catch(() => []) : []),
  };

  const adminPost: Record<string, Route> = {
    'mint-token': async ({ body }) => {
      const b = await body();
      const stage = (['fresh', 'investigated', 'debated', 'solved', 'reconstructed'] as const).find((x) => x === b.stage) ?? 'investigated';
      return json(200, await svc.mintToken(b.caseId as string, stage, { admin: true }));
    },
    'ask-debug': async ({ body }) => {
      const b = await body();
      const mode = typeof b.mode === 'string' && (PIPELINE_MODES as readonly string[]).includes(b.mode) ? (b.mode as PipelineMode) : undefined;
      if (typeof b.question !== 'string') throw new EngineError('bad_request', 'question is required', 400);
      return json(200, await svc.ask({ caseId: b.caseId as string, question: b.question, token: (b.token as string) || undefined }, { admin: true, withTrace: true, mode }));
    },
  };

  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const at = url.pathname.indexOf('/api/');
      const rest = at >= 0 ? url.pathname.slice(at + 5) : url.pathname === '/api' ? '' : null;
      if (rest === null) throw new EngineError('bad_request', 'not found', 404);
      const segs = rest.split('/').filter(Boolean);
      const method = req.method.toUpperCase();
      if (method === 'OPTIONS') return json(204, null, { allow: 'GET, POST, OPTIONS' });
      const ip = clientIp(req);
      const tokenHeader = req.headers.get('x-admin-token') ?? '';
      let adminByToken = false;
      if (!dev && tokenHeader.length > 0) {
        // Brute-force guard: over the wrong-guess limit, every token attempt from this IP is
        // refused — a correct guess included, or the limit would only slow wrong ones down.
        const locked = rt.limiter.peek('adminFail', ip);
        if (!locked.ok) limit('adminFail', ip);
        adminByToken = !!rt.config.adminToken && tokenHeader.length <= MAX_ADMIN_HEADER && safeEqual(tokenHeader, rt.config.adminToken);
        if (!adminByToken) limit('adminFail', ip);
      }
      const admin = dev || adminByToken;
      let parsed: Promise<Record<string, unknown>> | undefined;
      const body = () => (parsed ??= readJson(req));
      // Fail closed: nothing that signs or verifies a progress token runs with an unusable secret.
      const refuseMisconfigured = () => {
        if (rt.config.misconfigured) throw new EngineError('server', 'server misconfigured', 503, false);
      };

      if (segs[0] === 'admin') {
        if (!admin) throw new EngineError('bad_request', 'not found', 404);
        limit('admin', ip);
        const name = segs.slice(1).join('/');
        const table = method === 'GET' ? adminGet : method === 'POST' ? adminPost : undefined;
        const route = table?.[name];
        if (!route) throw new EngineError('bad_request', (adminGet[name] || adminPost[name]) ? 'method not allowed' : 'not found', adminGet[name] || adminPost[name] ? 405 : 404);
        if (method === 'POST') refuseMisconfigured(); // mint-token / ask-debug sign tokens
        return await route({ req, url, params: [], admin: true, ip, body });
      }

      // GET routes are keyed by the first segment (cases/:id); POST routes by the full path.
      if (method === 'GET' || method === 'HEAD') {
        const route = get[segs[0] ?? 'health'];
        if (!route) throw new EngineError('bad_request', post[segs.join('/')] ? 'method not allowed' : 'not found', post[segs.join('/')] ? 405 : 404);
        return await route({ req, url, params: segs.slice(1), admin, ip, body });
      }
      if (method === 'POST') {
        const route = post[segs.join('/')];
        if (!route) throw new EngineError('bad_request', get[segs[0]] ? 'method not allowed' : 'not found', get[segs[0]] ? 405 : 404);
        refuseMisconfigured(); // every POST route signs or verifies a progress token
        return await route({ req, url, params: [], admin, ip, body });
      }
      throw new EngineError('bad_request', 'method not allowed', 405);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
