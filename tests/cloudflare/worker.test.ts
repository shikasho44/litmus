/**
 * The Cloudflare Worker entry (server/cloudflare/worker.ts) with a node:sqlite D1 and fake
 * bindings: static assets vs /api routing, embedded content (in sync with content/), versus on
 * D1 end to end through HTTP, client-IP handling (spoofed forwarding headers ignored), the AI
 * rate-limit binding, fail-closed without a secret, the cron cleanup, and the Workers rule that
 * nothing random runs at import time.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import worker, { handleWorkerApi, scheduledCleanup, workerContent, type WorkerEnv } from '../../server/cloudflare/worker';
import { CASE_DIRS } from '../../server/cloudflare/content.generated';
import { GENERATED_PATH, renderContentModule, workerCaseDirs } from '../../scripts/cf-content';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs';
import { VERSUS_COUNTDOWN_MS } from '../../shared/versus';
import { SqliteD1 } from './sqlite-d1';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SECRET = 'cloudflare-test-secret-0123456789abcdefghij';

function envWith(over: Partial<WorkerEnv> = {}): WorkerEnv & { VERSUS_DB: SqliteD1 } {
  return {
    APP_ENV: 'production',
    PIPELINE_MODE: 'rules',
    DAILY_COST_LIMIT_USD: '1',
    SESSION_SECRET: SECRET,
    VERSUS_DB: new SqliteD1(),
    ASSETS: { fetch: async (req: Request) => new Response(`asset ${new URL(req.url).pathname}`, { status: 200 }) },
    ...over,
  } as unknown as WorkerEnv & { VERSUS_DB: SqliteD1 };
}

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), pending };
};

function req(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://litmus.fourthplace43.com${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env: WorkerEnv, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await worker.fetch(req(path, body, headers), env, ctx());
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

describe('embedded content', () => {
  it(`${GENERATED_PATH} is in sync with content/ (run npm run cf:content)`, () => {
    const onDisk = readFileSync(`${ROOT}${GENERATED_PATH}`, 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(renderContentModule(ROOT));
    expect([...CASE_DIRS]).toEqual(workerCaseDirs(`${ROOT}content`));
  });

  it('the embedded registry equals the file-system one', () => {
    const embedded = workerContent();
    const fromFs = loadRegistry(resolveContentRoot({ CONTENT_ROOT: `${ROOT}content` }));
    expect(embedded.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(embedded.list(false).map((c) => c.data.id)).toEqual(fromFs.list(false).map((c) => c.data.id));
    expect(embedded.list(false).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the prototype case in the Worker bundle (?proto=seeds, 2026-10-04)', () => {
  it('ships in the bundle, but the API lists and serves it only with the x-janedoe-proto header', async () => {
    expect(CASE_DIRS).toContain('c09-rescued-morning');
    expect(workerContent().cases.map((c) => c.data.id)).toContain('c09-rescued-morning');
    const env = envWith();
    const plain = await call(env, '/api/cases');
    expect(plain.json.map((c: { id: string }) => c.id)).not.toContain('c09-rescued-morning');
    expect(plain.json).toHaveLength(8);
    const seeds = await call(env, '/api/cases', undefined, { 'x-janedoe-proto': 'seeds' });
    expect(seeds.json.map((c: { id: string }) => c.id)).toContain('c09-rescued-morning');
    expect((await call(env, '/api/cases/c09-rescued-morning')).status).toBe(404);
    expect((await call(env, '/api/cases/c09-rescued-morning', undefined, { 'x-janedoe-proto': 'seeds' })).status).toBe(200);
  });
});

describe('worker routing', () => {
  it('serves static files from ASSETS and /api from the handler', async () => {
    const env = envWith();
    const page = await call(env, '/');
    expect(page.text).toBe('asset /');
    const deep = await call(env, '/some/page');
    expect(deep.text).toBe('asset /some/page');
    const health = await call(env, '/api/health');
    expect(health).toMatchObject({ status: 200, json: { ok: true } });
    expect(health.headers.get('cache-control')).toBe('no-store');
    const cases = await call(env, '/api/cases');
    expect(cases.status).toBe(200);
    expect(cases.json.map((c: { id: string }) => c.id)).toEqual(workerContent().list(false).map((c) => c.data.id));
    // case secrets never leave through the public list
    expect(cases.text).not.toMatch(/"truth"|"probes"/);
  });

  it('fails closed without a usable SESSION_SECRET (503, versus off)', async () => {
    const env = envWith({ SESSION_SECRET: 'short' });
    expect((await call(env, '/api/health')).status).toBe(503);
    expect((await call(env, '/api/token', { caseId: CASE_DIRS[0] })).status).toBe(503);
    expect((await call(env, '/api/versus/config')).json).toEqual({ enabled: false });
  });

  it('versus is enabled with the D1 binding and disabled without it or when switched off', async () => {
    expect((await call(envWith(), '/api/versus/config')).json).toMatchObject({ enabled: true, minPlayers: 2, maxPlayers: 4 });
    expect((await call(envWith({ VERSUS_DB: undefined }), '/api/versus/config')).json).toEqual({ enabled: false });
    expect((await call(envWith({ VERSUS_STORE: 'memory', VERSUS_DB: undefined }), '/api/versus/config')).json).toEqual({ enabled: false });
    expect((await call(envWith({ VERSUS_ENABLED: 'false' }), '/api/versus/config')).json).toEqual({ enabled: false });
  });
});

describe('online versus through the Worker (D1)', () => {
  it('create → join → start → poll → run → leave, rooms in D1', async () => {
    const env = envWith();
    const caseId = workerContent().list(false)[0].data.id;
    const host = await call(env, '/api/versus/create', { caseId, difficulty: 'easy', name: 'ホスト', cid: 'host-tab-0123456789' });
    expect(host.status).toBe(200);
    const code: string = host.json.room.code;
    expect(env.VERSUS_DB.rows('vs_keys').map((r) => r.k)).toEqual([`jd:vs:${code}`]);
    const guest = await call(env, '/api/versus/join', { code, name: 'ゲスト' }, { 'cf-connecting-ip': '198.51.100.4' });
    expect(guest.status).toBe(200);
    expect(guest.json.room.players).toHaveLength(2);
    const start = await call(env, '/api/versus/start', { seat: host.json.seat });
    expect(start.json.room.status).toBe('countdown');
    const early = await call(env, '/api/versus/run', { seat: guest.json.seat });
    expect(early.status).toBe(409);
    const poll = await call(env, '/api/versus/state', { seat: guest.json.seat });
    expect(poll.json.room).toMatchObject({ code, status: 'countdown' });
    // after the countdown both get a room-bound token
    await new Promise((r) => setTimeout(r, Math.max(0, VERSUS_COUNTDOWN_MS - 400 + 50)));
    const run = await call(env, '/api/versus/run', { seat: guest.json.seat });
    expect(run.status).toBe(200);
    expect(typeof run.json.token).toBe('string');
    const ask = await call(env, '/api/ask', { caseId, question: '部屋に窓はありましたか？', token: run.json.token });
    expect(ask.status).toBe(200);
    const prog = await call(env, '/api/versus/progress', { seat: guest.json.seat, token: ask.json.token });
    expect(prog.json.room.players.find((p: { you: boolean }) => p.you)).toMatchObject({ asked: 1, stage: 'investigation' });
    const left = await call(env, '/api/versus/leave', { seat: guest.json.seat });
    expect(left.json).toEqual({ ok: true });
    const after = await call(env, '/api/versus/state', { seat: host.json.seat });
    expect(after.json.room.players.find((p: { you: boolean }) => !p.you)).toMatchObject({ left: true });
  }, 20_000);

  it('the cron cleanup purges expired rooms', async () => {
    const env = envWith();
    const caseId = workerContent().list(false)[0].data.id;
    await call(env, '/api/versus/create', { caseId, difficulty: 'easy', name: 'a' });
    expect((await scheduledCleanup(env, Date.now())).rooms).toBe(0);
    expect((await scheduledCleanup(env, Date.now() + 4 * 3600_000)).rooms).toBe(1);
    expect(env.VERSUS_DB.rows('vs_fields')).toEqual([]);
  });
});

describe('client IP and limits', () => {
  it('rate limits by CF-Connecting-IP; spoofed forwarding headers do not help', async () => {
    const env = envWith();
    const caseId = workerContent().list(false)[0].data.id;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await call(env, '/api/versus/create', { caseId, difficulty: 'easy', name: `n${i}` }, { 'cf-connecting-ip': '192.0.2.9', 'x-forwarded-for': `10.0.0.${i}`, 'x-vercel-forwarded-for': `10.1.0.${i}`, 'x-real-ip': `10.2.0.${i}` });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
    // another client is not affected
    expect((await call(env, '/api/versus/create', { caseId, difficulty: 'easy', name: 'z' }, { 'cf-connecting-ip': '192.0.2.10' })).status).toBe(200);
  });

  it('the AI rate-limit binding guards ask / verdict per IP', async () => {
    const keys: string[] = [];
    const env = envWith({ AI_RATE_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } });
    const caseId = workerContent().list(false)[0].data.id;
    const tok = await call(env, '/api/token', { caseId });
    expect(tok.status).toBe(200); // not an AI route
    const ask = await call(env, '/api/ask', { caseId, question: '窓はありましたか？', token: tok.json.token });
    expect(ask).toMatchObject({ status: 429, json: { error: { code: 'rate_limited' } } });
    expect(ask.headers.get('retry-after')).toBe('60');
    expect(keys).toEqual(['203.0.113.7']);
  });
});

describe('Workers global-scope rule', () => {
  it('importing the Worker makes no random values (they are refused outside a request)', async () => {
    vi.resetModules();
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('random values in the global scope');
    });
    try {
      const mod = await import('../../server/cloudflare/worker');
      expect(typeof mod.default.fetch).toBe('function');
    } finally {
      spy.mockRestore();
    }
  });
});

// handleWorkerApi is the same path worker.fetch takes for /api; keep the export exercised.
it('handleWorkerApi without an execution context awaits the budget flush itself', async () => {
  const res = await handleWorkerApi(req('/api/health'), envWith());
  expect(res.status).toBe(200);
});
