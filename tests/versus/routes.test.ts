/**
 * /api/versus/* through the real HTTP handler: wiring, validation, disabled states, the verdict
 * observer, and the Upstash REST store against a fake Redis.
 */
import { describe, expect, it } from 'vitest';
import { createApiHandler } from '../../server/http/handler';
import { createRuntime, versusStoreFor } from '../../server/http/runtime';
import { MemoryRoomStore } from '../../server/versus/store';
import { UpstashRoomStore, upstashConfig } from '../../server/versus/upstash';
import { signToken } from '../../server/engine/token';
import { initialState } from '../../server/engine/state';
import { VERSUS_COUNTDOWN_MS, VERSUS_ERR } from '../../shared/versus';
import { FIXTURE_ID, fixtureCase, fixtureRegistry } from '../engine/helpers';

const caseId = FIXTURE_ID;
const BASE = 'http://game.test';
const PROD_SECRET = 'versus-test-secret-0123456789abcdef';

function setup(env: Record<string, string> = {}, roomStore?: MemoryRoomStore | null) {
  let now = 1_800_000_000_000;
  const clock = () => now;
  const registry = fixtureRegistry();
  const rt = createRuntime({
    env: { APP_ENV: 'production', SESSION_SECRET: PROD_SECRET, ...env },
    content: () => registry,
    clock,
    ...(roomStore !== undefined ? { roomStore } : {}),
  });
  const handle = createApiHandler(rt);
  const get = (path: string) => handle(new Request(BASE + path));
  const post = async (path: string, body: unknown, ip = '203.0.113.7') => {
    const r = await handle(
      new Request(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    );
    return { status: r.status, body: (await r.json()) as any };
  };
  return { rt, get, post, advance: (ms: number) => (now += ms) };
}

describe('versus routes', () => {
  it('config: enabled with a store; disabled (and POSTs 404) in production without one', async () => {
    const on = setup({}, new MemoryRoomStore());
    expect(await (await on.get('/api/versus/config')).json()).toMatchObject({ enabled: true, minPlayers: 2, maxPlayers: 4, nameMax: 12 });
    const off = setup(); // production, no Upstash env
    expect(off.rt.versusInfo.enabled).toBe(false);
    expect(await (await off.get('/api/versus/config')).json()).toEqual({ enabled: false });
    const r = await off.post('/api/versus/create', { caseId, difficulty: 'easy', name: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe(VERSUS_ERR.disabled);
    // misconfigured production (no secret): disabled too
    const bad = setup({ SESSION_SECRET: '' }, new MemoryRoomStore());
    expect(await (await bad.get('/api/versus/config')).json()).toEqual({ enabled: false });
    expect((await bad.post('/api/versus/create', { caseId, difficulty: 'easy', name: 'x' })).status).toBe(503);
  });

  it('store selection: Upstash when configured, memory only in dev or on explicit opt-in off Vercel', () => {
    expect(versusStoreFor({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }, false).store?.kind).toBe('redis');
    expect(versusStoreFor({ KV_REST_API_URL: 'https://x.upstash.io/', KV_REST_API_TOKEN: 't' }, false).store?.kind).toBe('redis');
    expect(versusStoreFor({}, true).store?.kind).toBe('memory');
    expect(versusStoreFor({}, false).store).toBeUndefined();
    expect(versusStoreFor({ VERSUS_STORE: 'memory' }, false).store?.kind).toBe('memory');
    expect(versusStoreFor({ VERSUS_STORE: 'memory', VERCEL: '1' }, false).store).toBeUndefined();
    expect(versusStoreFor({ VERSUS_ENABLED: 'false' }, true).store).toBeUndefined();
    expect(upstashConfig({ UPSTASH_REDIS_REST_URL: 'http://insecure', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeUndefined();
  });

  it('validates every body', async () => {
    const t = setup({}, new MemoryRoomStore());
    const cases: [string, unknown][] = [
      ['/api/versus/create', {}],
      ['/api/versus/create', { caseId, difficulty: 'nightmare', name: 'x' }],
      ['/api/versus/create', { caseId, difficulty: 'easy', name: 12 }],
      ['/api/versus/create', { caseId, difficulty: 'easy', name: 'x', cid: 'short' }],
      ['/api/versus/join', { code: 'ABCDEF' }],
      ['/api/versus/join', { code: 42, name: 'x' }],
      ['/api/versus/state', {}],
      ['/api/versus/state', { seat: 5 }],
      ['/api/versus/progress', { seat: 'ABCDEF.0abcde.' + 'A'.repeat(22) }],
      ['/api/versus/progress', { seat: 'ABCDEF.0abcde.' + 'A'.repeat(22), token: 'x'.repeat(7000) }],
      ['/api/versus/start', '[1,2]'],
      ['/api/versus/leave', 'not json'],
    ];
    for (const [path, body] of cases) {
      const r = await t.post(path, body);
      expect(r.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(r.body.error.code).toBe('bad_request');
    }
    // names are checked for meaning too
    expect((await t.post('/api/versus/create', { caseId, difficulty: 'easy', name: '\u200B\u200B' })).body.error.message).toBe(VERSUS_ERR.badName);
    expect((await t.post('/api/versus/join', { code: 'IIIIII', name: 'x' })).body.error.message).toBe(VERSUS_ERR.badCode);
    // GET on a POST route / unknown sub-route
    expect((await t.get('/api/versus/create')).status).toBe(404);
    expect((await t.post('/api/versus/config', {})).status).toBe(405);
  });

  it('plays a race over HTTP: the winning verdict is recorded by the server itself', async () => {
    const t = setup({}, new MemoryRoomStore());
    const host = (await t.post('/api/versus/create', { caseId, difficulty: 'easy', name: 'ホスト' })).body;
    const guest = (await t.post('/api/versus/join', { code: host.room.code, name: 'ゲスト' })).body;
    expect(guest.room.players).toHaveLength(2);
    expect((await t.post('/api/versus/run', { seat: guest.seat })).status).toBe(409);
    const started = (await t.post('/api/versus/start', { seat: host.seat })).body;
    expect(started.room.status).toBe('countdown');
    t.advance(VERSUS_COUNTDOWN_MS);
    const run = (await t.post('/api/versus/run', { seat: guest.seat })).body;
    expect(run.progress.asked).toBe(0);
    const ask = (await t.post('/api/ask', { caseId, question: '雨が降っていましたか？', token: run.token })).body;
    const p1 = (await t.post('/api/versus/progress', { seat: guest.seat, token: ask.token })).body;
    expect(p1.room.players.find((p: any) => p.you)).toMatchObject({ asked: 1, stage: 'investigation' });
    t.advance(30_000);
    // the guest declares the right choice: no client progress call needed to win
    const verdict = (await t.post('/api/inquest/verdict', { caseId, token: ask.token, mode: 'choice', choice: 'co' })).body;
    expect(verdict.result).toBe('correct');
    const seen = (await t.post('/api/versus/state', { seat: host.seat })).body.room;
    expect(seen.winner).toMatchObject({ name: 'ゲスト', ms: 30_000 });
    expect(seen.players.find((p: any) => p.name === 'ゲスト')).toMatchObject({ rank: 1, stage: 'solved' });
    // a single-player solved token cannot join the ranking
    const solo = (await t.post('/api/token', { caseId })).body;
    const soloSolved = (await t.post('/api/inquest/verdict', { caseId, token: solo.token, mode: 'choice', choice: 'co' })).body;
    const refused = await t.post('/api/versus/progress', { seat: host.seat, token: soloSolved.token });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe(VERSUS_ERR.binding);
    // a forged bound token (right shape, wrong key)
    const bound = `${host.room.code}.aaaaaaaaaa.${host.room.you}.e`;
    const forged = await signToken({ ...initialState(fixtureCase(), Date.now()), solved: true, room: bound }, 'janedoe-dev-secret-NOT-FOR-PRODUCTION');
    expect((await t.post('/api/versus/progress', { seat: host.seat, token: forged })).status).toBe(401);
    // leave
    expect((await t.post('/api/versus/leave', { seat: host.seat })).body).toEqual({ ok: true });
    expect((await t.post('/api/versus/state', { seat: guest.seat })).body.room.players.find((p: any) => p.host)).toMatchObject({ left: true });
  });

  it('rate-limits room creation per IP', async () => {
    const t = setup({}, new MemoryRoomStore());
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await t.post('/api/versus/create', { caseId, difficulty: 'easy', name: `n${i}` }, '198.51.100.9')).status;
    expect(last).toBe(429);
    expect((await t.post('/api/versus/create', { caseId, difficulty: 'easy', name: 'other' }, '198.51.100.10')).status).toBe(200);
  });

  it('dev-only versus-bind is not reachable in production, even for an admin', async () => {
    const t = setup({ ADMIN_TOKEN: 'versus-admin-token-0123456789abcdef' }, new MemoryRoomStore());
    const host = (await t.post('/api/versus/create', { caseId, difficulty: 'easy', name: 'h' })).body;
    const r = await createApiHandler(t.rt)(
      new Request(`${BASE}/api/admin/versus-bind`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': 'versus-admin-token-0123456789abcdef' },
        body: JSON.stringify({ seat: host.seat, token: 'j1.x.y' }),
      }),
    );
    expect(r.status).toBe(404);
  });
});

/** A fake Upstash REST endpoint: a tiny Redis on top of the memory store. */
function fakeUpstash() {
  const hashes = new Map<string, Map<string, string>>();
  const calls: unknown[] = [];
  const exec = (cmd: string[]): unknown => {
    const [name, key, ...a] = cmd;
    const h = hashes.get(key) ?? new Map<string, string>();
    switch (name) {
      case 'HGETALL':
        return [...(hashes.get(key) ?? new Map())].flat();
      case 'HSETNX': {
        if (h.has(a[0])) return 0;
        h.set(a[0], a[1]);
        hashes.set(key, h);
        return 1;
      }
      case 'HSET':
        for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]);
        hashes.set(key, h);
        return a.length / 2;
      case 'HDEL':
        for (const f of a) h.delete(f);
        return a.length;
      case 'HINCRBY': {
        const v = Number(h.get(a[0]) ?? 0) + Number(a[1]);
        h.set(a[0], String(v));
        hashes.set(key, h);
        return v;
      }
      case 'EXPIRE':
        return hashes.has(key) ? 1 : 0;
      default:
        throw new Error(`unexpected ${name}`);
    }
  };
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization, body: JSON.parse(String(init.body)) });
    if (!url.endsWith('/pipeline')) return new Response('nope', { status: 404 });
    const cmds = JSON.parse(String(init.body)) as string[][];
    return new Response(JSON.stringify(cmds.map((c) => ({ result: exec(c) }))), { status: 200 });
  };
  return { fetchImpl, calls, hashes };
}

describe('UpstashRoomStore (REST, fake server)', () => {
  it('speaks the pipeline protocol with the bearer token, TTL in the same round trip', async () => {
    const f = fakeUpstash();
    const s = new UpstashRoomStore({ url: 'https://example.upstash.io', token: 'sekret' }, f.fetchImpl);
    expect(await s.hgetall('k')).toBeNull();
    expect(await s.hsetnx('k', 'a', '1', 60)).toBe(true);
    expect(await s.hsetnx('k', 'a', '2', 60)).toBe(false);
    await s.hset('k', { b: 'x', c: 'y' }, 60);
    expect(await s.hincrby('k', 'n', 1, 60)).toBe(1);
    expect(await s.hincrby('k', 'n', 1)).toBe(2);
    await s.hdel('k', ['c']);
    expect(await s.hgetall('k')).toEqual({ a: '1', b: 'x', n: '2' });
    const first = f.calls[1] as { url: string; auth: string; body: string[][] };
    expect(first.url).toBe('https://example.upstash.io/pipeline');
    expect(first.auth).toBe('Bearer sekret');
    expect(first.body).toEqual([['HSETNX', 'k', 'a', '1'], ['EXPIRE', 'k', '60']]);
  });

  it('turns failures into a retryable 503 without leaking the token', async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(' '));
    try {
      const down = new UpstashRoomStore({ url: 'https://example.upstash.io', token: 'sekret' }, async () => new Response('x', { status: 500 }));
      await expect(down.hgetall('k')).rejects.toMatchObject({ code: 'server', status: 503, retryable: true });
      const redisErr = new UpstashRoomStore({ url: 'https://example.upstash.io', token: 'sekret' }, async () => new Response(JSON.stringify([{ error: 'WRONGTYPE' }]), { status: 200 }));
      await expect(redisErr.hsetnx('k', 'f', 'v')).rejects.toMatchObject({ status: 503 });
      const net = new UpstashRoomStore({ url: 'https://example.upstash.io', token: 'sekret' }, async () => {
        throw new TypeError('fetch failed');
      });
      await expect(net.hset('k', { a: 'b' })).rejects.toMatchObject({ status: 503 });
    } finally {
      console.error = orig;
    }
    expect(errs.join('\n')).not.toContain('sekret');
  });

  it('runs a whole room on the REST store', async () => {
    const f = fakeUpstash();
    const registry = fixtureRegistry();
    const rt = createRuntime({
      env: { APP_ENV: 'production', SESSION_SECRET: PROD_SECRET },
      content: () => registry,
      roomStore: new UpstashRoomStore({ url: 'https://example.upstash.io', token: 't' }, f.fetchImpl),
    });
    const handle = createApiHandler(rt);
    const post = async (path: string, body: unknown) =>
      (await handle(new Request(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))).json() as Promise<any>;
    const host = await post('/api/versus/create', { caseId, difficulty: 'hard', name: 'h' });
    const guest = await post('/api/versus/join', { code: host.room.code, name: 'g' });
    expect(guest.room.players.map((p: any) => p.name)).toEqual(['h', 'g']);
    const st = await post('/api/versus/start', { seat: host.seat });
    expect(st.room.status).toBe('countdown');
    expect([...f.hashes.keys()]).toEqual([`jd:vs:${host.room.code}`]);
  });
});
