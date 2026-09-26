/**
 * /api/versus/* routes (online versus, docs/versus.md). Mounted by server/http/handler.ts.
 *
 *   GET  /api/versus/config      → VersusConfig ({ enabled:false } when no room store is usable)
 *   POST /api/versus/create      {caseId, difficulty, name, cid?}   → {seat, room}
 *   POST /api/versus/join        {code, name, cid?}                 → {seat, room}
 *   POST /api/versus/start       {seat}                              → {room}   host only, ≥ 2 players
 *   POST /api/versus/state       {seat}                              → {room}   poll (~2 s)
 *   POST /api/versus/run         {seat}                              → {token, progress, room}  after startAt
 *   POST /api/versus/progress    {seat, token}                       → {room}
 *   POST /api/versus/leave       {seat}                              → {ok}
 *   dev only: POST /api/admin/versus-bind {seat, token} → a minted token bound to the seat's run (QA)
 *
 * Every body is validated with zod here (the service validates the semantics again). Disabled
 * versus (no store, or a misconfigured production) answers 404 on the POST routes.
 */
import { z } from 'zod';
import { VERSUS_ERR } from '../../shared/versus.js';
import { EngineError } from '../engine/errors.js';
import type { ApiRuntime } from './runtime.js';

type Ctx = { params: string[]; ip: string; admin: boolean; body: () => Promise<Record<string, unknown>> };
type Handler = (ctx: Ctx) => Promise<Response>;
type Json = (status: number, body: unknown, extra?: Record<string, string>) => Response;
type Limit = (bucket: string, key: string) => void;

const seat = z.string().min(10).max(80);
const cid = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional();
const name = z.string().max(64);
const Schemas = {
  create: z.object({ caseId: z.string().min(1).max(80), difficulty: z.enum(['easy', 'normal', 'hard']), name, cid }),
  join: z.object({ code: z.string().min(1).max(32), name, cid }),
  seat: z.object({ seat }),
  progress: z.object({ seat, token: z.string().min(1).max(6000) }),
};

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path?.map(String).join('.') || 'body';
    // name / code problems get the messages the UI knows how to explain
    if (field === 'name') throw new EngineError('bad_request', VERSUS_ERR.badName, 400);
    if (field === 'code') throw new EngineError('bad_request', VERSUS_ERR.badCode, 400);
    throw new EngineError('bad_request', `invalid ${field}`, 400);
  }
  return r.data;
}

export function versusRoutes(rt: ApiRuntime, json: Json, limit: Limit): { get: Handler; post: Record<string, Handler>; devBind: Handler } {
  const vs = () => {
    if (!rt.versus) throw new EngineError('bad_request', VERSUS_ERR.disabled, 404);
    return rt.versus;
  };

  const get: Handler = async ({ params, ip }) => {
    limit('read', ip);
    if (params.join('/') !== 'config') throw new EngineError('bad_request', 'not found', 404);
    return json(200, rt.versus && !rt.config.misconfigured ? rt.versus.config() : { enabled: false });
  };

  const post: Record<string, Handler> = {
    'versus/create': async ({ body, ip, admin }) => {
      limit('vsCreate', ip);
      const b = parse(Schemas.create, await body());
      return json(200, await vs().create(b, { admin }));
    },
    'versus/join': async ({ body, ip }) => {
      limit('vsJoin', ip);
      const b = parse(Schemas.join, await body());
      return json(200, await vs().join(b));
    },
    'versus/start': async ({ body, ip }) => {
      limit('vsWrite', ip);
      return json(200, await vs().start(parse(Schemas.seat, await body()).seat));
    },
    'versus/state': async ({ body, ip }) => {
      limit('vsPoll', ip);
      return json(200, await vs().state(parse(Schemas.seat, await body()).seat));
    },
    'versus/run': async ({ body, ip }) => {
      limit('vsWrite', ip);
      return json(200, await vs().run(parse(Schemas.seat, await body()).seat));
    },
    'versus/progress': async ({ body, ip }) => {
      limit('vsWrite', ip);
      const b = parse(Schemas.progress, await body());
      return json(200, await vs().progress(b.seat, b.token));
    },
    'versus/leave': async ({ body, ip }) => {
      limit('vsWrite', ip);
      return json(200, await vs().leave(parse(Schemas.seat, await body()).seat));
    },
  };

  const devBind: Handler = async ({ body }) => {
    if (!rt.config.dev) throw new EngineError('bad_request', 'not found', 404);
    const b = parse(Schemas.progress, await body());
    return json(200, await vs().devBind(b.seat, b.token));
  };

  return { get, post, devBind };
}

/**
 * After a verdict: let the versus service see the attempt (best effort — a store hiccup must
 * never fail the player's verdict; the client's progress submission catches up later).
 */
export async function observeVerdict(rt: ApiRuntime, caseId: unknown, before: unknown, after: string): Promise<void> {
  if (!rt.versus) return;
  try {
    await rt.versus.observeVerdict(caseId, before, after);
  } catch (e) {
    console.error('[janedoe] versus: could not record a verdict', e instanceof Error ? e.message : e);
  }
}
