import { describe, expect, it } from 'vitest';
import { createApiHandler, safeEqual } from '../../server/http/handler';
import { signToken } from '../../server/engine/token';
import { initialState } from '../../server/engine/state';
import { createRuntime } from '../../server/http/runtime';
import { FIXTURE_ID, fixtureRegistry } from './helpers';

const caseId = FIXTURE_ID;
const BASE = 'http://game.test';
const PROD_SECRET = 'handler-test-secret-0123456789abcdef'; // ≥ 32 chars
const ADMIN = 'sesame-admin-token-0123456789abcdef'; // ≥ 32 chars

function setup(env: Record<string, string> = {}, rateRules?: Parameters<typeof createRuntime>[0]['rateRules']) {
  const registry = fixtureRegistry();
  const rt = createRuntime({ env: { APP_ENV: 'production', SESSION_SECRET: PROD_SECRET, ...env }, content: () => registry, rateRules });
  const handle = createApiHandler(rt);
  const get = (path: string, headers: Record<string, string> = {}) => handle(new Request(BASE + path, { headers }));
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    handle(new Request(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { rt, handle, get, post };
}

async function body(r: Response) {
  return (await r.json()) as any;
}

describe('HTTP handler (end to end)', () => {
  it('serves health, cases and case detail with security headers', async () => {
    const { get } = setup();
    const h = await get('/api/health');
    expect(h.status).toBe(200);
    expect(h.headers.get('x-content-type-options')).toBe('nosniff');
    expect(h.headers.get('cache-control')).toBe('no-store');
    expect(h.headers.get('content-security-policy')).toContain("default-src 'none'");
    // Public health says nothing about the server's internals (mode, secret, budget …).
    expect(await body(h)).toEqual({ ok: true, version: '1' });
    const dev = setup({ APP_ENV: 'development' });
    expect(await body(await dev.get('/api/health'))).toMatchObject({ ok: true, mode: 'rules', cases: 1, dev: true, secretConfigured: true });
    const list = await body(await get('/api/cases'));
    expect(list.map((c: { id: string }) => c.id)).toEqual([caseId]);
    const one = await get(`/api/cases/${caseId}`);
    expect(one.status).toBe(200);
    expect((await body(one)).startingFacts[0].id).toBe('F01');
    const missing = await get('/api/cases/c00-none');
    expect(missing.status).toBe(404);
    expect((await body(missing)).error.code).toBe('bad_request');
  });

  it('routes the whole game flow', async () => {
    const { post } = setup();
    const tok = await body(await post('/api/token', { caseId }));
    expect(tok.progress.unlocked).toEqual(['F01']);
    const ask = await body(await post('/api/ask', { caseId, question: '雨が降っていましたか？', token: tok.token }));
    expect(ask.answers[0].answerClass).toBe('yes');
    expect(ask.trace).toBeUndefined(); // production, no admin token
    const hint = await body(await post('/api/hint', { caseId, token: ask.token }));
    expect(hint.level).toBe(1);
    const start = await body(await post('/api/inquest/start', { caseId, token: hint.token }));
    expect(start.rounds).toHaveLength(2);
    const shot = await body(await post('/api/inquest/shot', { caseId, token: start.token, roundId: 'R1', statementId: 'S2', span: '外は晴れていた', factId: 'F04' }));
    expect(shot.correct).toBe(true);
    const grant = await body(await post('/api/inquest/grant', { caseId, token: shot.token, roundId: 'R2' }));
    expect(grant.granted.id).toBe('F05');
    const verdict = await body(await post('/api/inquest/verdict', { caseId, token: grant.token, text: 'テントの中の炭火で一酸化炭素中毒になった' }));
    expect(verdict.result).toBe('correct');
    const view = await body(await post('/api/reconstruction', { caseId, token: verdict.token }));
    expect(view.panels.length).toBe(4);
    const sub = await body(await post('/api/reconstruction/submit', { caseId, token: verdict.token, picks: {} }));
    expect(sub.allCorrect).toBe(false);
    const sol = await post('/api/solution', { caseId, token: verdict.token });
    expect(sol.status).toBe(200);
    expect((await body(sol)).truth.causeOfDeath).toBe('一酸化炭素中毒');
  });

  it('maps errors to status codes and ApiError codes', async () => {
    const { post, get, handle } = setup();
    const bad = await post('/api/ask', { caseId, question: '雨？', token: 'j1.x.y' });
    expect(bad.status).toBe(401);
    expect((await body(bad)).error).toMatchObject({ code: 'bad_token', retryable: false });
    const long = await post('/api/ask', { caseId, question: 'あ'.repeat(201) });
    expect(long.status).toBe(400);
    const vlong = await post('/api/inquest/verdict', { caseId, token: 'x', text: 'あ'.repeat(601) });
    expect(vlong.status).toBe(400);
    const big = await post('/api/ask', JSON.stringify({ caseId, question: 'x', pad: 'a'.repeat(9000) }));
    expect(big.status).toBe(413);
    const notJson = await post('/api/ask', '{nope');
    expect(notJson.status).toBe(400);
    const arr = await post('/api/ask', '[1,2]');
    expect(arr.status).toBe(400);
    const tok = await body(await post('/api/token', { caseId }));
    const locked = await post('/api/solution', { caseId, token: tok.token });
    expect(locked.status).toBe(403);
    expect((await get('/api/nowhere')).status).toBe(404);
    expect((await get('/api/ask')).status).toBe(405);
    expect((await post('/api/cases', {})).status).toBe(405);
    expect((await handle(new Request(BASE + '/api/ask', { method: 'PUT' }))).status).toBe(405);
    expect((await handle(new Request(BASE + '/api/ask', { method: 'OPTIONS' }))).status).toBe(204);
  });

  it('hides admin routes in production without the token', async () => {
    const { get, post } = setup({ ADMIN_TOKEN: ADMIN });
    expect((await get('/api/admin/cases')).status).toBe(404);
    expect((await get('/api/admin/cases', { 'x-admin-token': 'wrong' })).status).toBe(404);
    const ok = await get('/api/admin/cases', { 'x-admin-token': ADMIN });
    expect(ok.status).toBe(200);
    const b = await body(ok);
    expect(b.cases[0].validation.ok).toBe(true);
    expect(b.cases[0].data.truth.causeOfDeath).toBe('一酸化炭素中毒');
    // admin callers get traces on normal routes and can override the mode
    const ask = await body(await post('/api/ask', { caseId, question: '雨でしたか' }, { 'x-admin-token': ADMIN }));
    expect(ask.trace.mode).toBe('rules');
    const dbg = await body(await post('/api/admin/ask-debug', { caseId, question: 'コンロは関係ありますか', mode: 'jev' }, { 'x-admin-token': ADMIN }));
    expect(dbg.trace.parts[0].source).toBe('keyword');
    expect(dbg.trace.requestedMode).toBe('rules'); // stubs → degraded to rules
    const traces = await body(await get('/api/admin/traces?limit=5', { 'x-admin-token': ADMIN }));
    expect(traces.length).toBeGreaterThanOrEqual(2);
    expect(traces[0].kind).toBe('ask');
    const bench = await body(await get('/api/admin/bench', { 'x-admin-token': ADMIN }));
    expect(bench).toEqual([]);
    const status = await body(await get('/api/admin/status', { 'x-admin-token': ADMIN }));
    expect(status.mode).toBe('rules');
    expect(JSON.stringify(status)).not.toContain(PROD_SECRET);
    expect(JSON.stringify(status)).not.toContain(ADMIN);
    // admin callers see the full health
    expect(await body(await get('/api/health', { 'x-admin-token': ADMIN }))).toMatchObject({ ok: true, mode: 'rules', dev: false, secretConfigured: true });
    // no ADMIN_TOKEN configured → never admin in production
    const none = setup();
    expect((await none.get('/api/admin/status', { 'x-admin-token': '' })).status).toBe(404);
  });

  it('fails closed in production without a usable SESSION_SECRET (no forged tokens)', async () => {
    for (const secret of ['', 'change-me-to-a-long-random-string', 'abc', 'x'.repeat(31)]) {
      const { rt, get, post } = setup({ SESSION_SECRET: secret });
      expect(rt.config.misconfigured).toBeTruthy();
      expect(rt.config.sessionSecret).not.toBe('janedoe-dev-secret-NOT-FOR-PRODUCTION');
      expect(rt.warnings.join(' ')).toContain('503');
      // A token signed with the public dev key (what forge.mjs did) must not reach /api/solution.
      const fx = fixtureRegistry().get(caseId, true)!.data;
      const forged = await signToken({ ...initialState(fx, Date.now()), solved: true, verdictAttempts: 1 }, 'janedoe-dev-secret-NOT-FOR-PRODUCTION');
      for (const [path, b] of [
        ['/api/token', { caseId }],
        ['/api/ask', { caseId, question: '雨でしたか', token: forged }],
        ['/api/hint', { caseId, token: forged }],
        ['/api/inquest/start', { caseId, token: forged }],
        ['/api/inquest/verdict', { caseId, token: forged, text: '一酸化炭素中毒' }],
        ['/api/reconstruction', { caseId, token: forged }],
        ['/api/solution', { caseId, token: forged }],
      ] as const) {
        const r = await post(path, b);
        expect(r.status, `${secret.length} ${path}`).toBe(503);
        const e = (await body(r)).error;
        expect(e).toEqual({ code: 'server', message: 'server misconfigured', retryable: false });
        expect(JSON.stringify(e)).not.toContain(fx.victim.name);
      }
      const h = await get('/api/health');
      expect(h.status).toBe(503);
      expect(await body(h)).toEqual({ ok: false, version: '1' });
      // Public case summaries still load (the title screen can say something useful).
      expect((await get('/api/cases')).status).toBe(200);
    }
    // Development keeps the dev default; a long production secret works.
    expect(setup({ APP_ENV: 'development', SESSION_SECRET: '' }).rt.config.misconfigured).toBeUndefined();
    expect(setup({ SESSION_SECRET: 'y'.repeat(32) }).rt.config.misconfigured).toBeUndefined();
  });

  it('refuses short admin tokens in production and rate-limits wrong guesses', async () => {
    const short = setup({ ADMIN_TOKEN: 'sesame' });
    expect(short.rt.config.adminToken).toBeUndefined();
    expect(short.rt.warnings.join(' ')).toContain('ADMIN_TOKEN');
    expect((await short.get('/api/admin/status', { 'x-admin-token': 'sesame' })).status).toBe(404);

    const { get } = setup({ ADMIN_TOKEN: ADMIN }, { adminFail: [{ limit: 3, windowMs: 60_000 }] });
    const ip = { 'x-forwarded-for': '203.0.113.50' };
    for (let i = 0; i < 3; i++) expect((await get('/api/admin/status', { ...ip, 'x-admin-token': `wrong-${i}` })).status).toBe(404);
    const blocked = await get('/api/admin/status', { ...ip, 'x-admin-token': 'wrong-again' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Locked out: even the right token is refused from that IP (else the limit only slows guessing).
    expect((await get('/api/admin/status', { ...ip, 'x-admin-token': ADMIN })).status).toBe(429);
    // Wrong guesses through any route count (health would reveal a correct token by its shape).
    expect((await get('/api/health', { ...ip, 'x-admin-token': 'wrong' })).status).toBe(429);
    // Other IPs and requests without the header are unaffected.
    expect((await get('/api/admin/status', { 'x-forwarded-for': '198.51.100.7', 'x-admin-token': ADMIN })).status).toBe(200);
    expect((await get('/api/cases', ip)).status).toBe(200);
  });

  it('compares admin tokens without leaking their length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('opens admin routes and traces in dev', async () => {
    const { get, post } = setup({ APP_ENV: 'development' });
    expect((await get('/api/admin/status')).status).toBe(200);
    const ask = await body(await post('/api/ask', { caseId, question: '雨でしたか' }));
    expect(ask.trace.timings.find((t: { stage: string }) => t.stage === 'total')).toBeDefined();
  });

  it('rate-limits per IP with 429 + Retry-After', async () => {
    const { post } = setup({}, { ask: [{ limit: 2, windowMs: 60_000 }] });
    const ip = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    expect((await post('/api/ask', { caseId, question: '雨？' }, ip)).status).toBe(200);
    expect((await post('/api/ask', { caseId, question: '雨？' }, ip)).status).toBe(200);
    const r = await post('/api/ask', { caseId, question: '雨？' }, ip);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await body(r)).error.code).toBe('rate_limited');
    expect((await post('/api/ask', { caseId, question: '雨？' }, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(200);
  });

  it('mints stage tokens for QA (admin only) that the game accepts', async () => {
    const { post } = setup({ APP_ENV: 'development' });
    const fresh = await body(await post('/api/admin/mint-token', { caseId, stage: 'fresh' }));
    expect(fresh.progress).toMatchObject({ unlocked: ['F01'], solved: false, debateCleared: [] });
    const inv = await body(await post('/api/admin/mint-token', { caseId, stage: 'investigated' }));
    const fx = fixtureRegistry().get(caseId, true)!.data;
    expect([...inv.progress.unlocked].sort()).toEqual(fx.facts.filter((f) => f.spoilerLevel <= 3).map((f) => f.id).sort());
    expect(inv.progress.solved).toBe(false);
    const deb = await body(await post('/api/admin/mint-token', { caseId, stage: 'debated' }));
    expect(deb.progress.debateCleared).toEqual(fx.debate.map((r) => r.id));
    const solved = await body(await post('/api/admin/mint-token', { caseId, stage: 'solved' }));
    expect(solved.progress).toMatchObject({ solved: true, reconstructed: false, progress: 1 });
    expect((await post('/api/solution', { caseId, token: solved.token })).status).toBe(200);
    const rec = await body(await post('/api/admin/mint-token', { caseId, stage: 'reconstructed' }));
    expect(rec.progress.reconstructed).toBe(true);
    const view = await body(await post('/api/reconstruction', { caseId, token: rec.token }));
    expect(view.panels.every((p: { caption: string }) => p.caption.length > 0)).toBe(true);
    // unknown stage → investigated; unknown case → 404
    const dflt = await body(await post('/api/admin/mint-token', { caseId, stage: 'nope' }));
    expect(dflt.progress.unlocked.length).toBe(inv.progress.unlocked.length);
    expect((await post('/api/admin/mint-token', { caseId: 'c00-none', stage: 'fresh' })).status).toBe(404);
    // production without the admin token: the route does not exist
    const prod = setup({ ADMIN_TOKEN: ADMIN });
    expect((await prod.post('/api/admin/mint-token', { caseId, stage: 'solved' })).status).toBe(404);
    expect((await prod.post('/api/admin/mint-token', { caseId, stage: 'solved' }, { 'x-admin-token': ADMIN })).status).toBe(200);
  });

  it('returns notice support for a safety question over HTTP', async () => {
    const { post } = setup();
    const r = await body(await post('/api/ask', { caseId, question: '窒素吸ったら楽に死ねる？' }));
    expect(r.answers).toHaveLength(1);
    expect(r.answers[0]).toMatchObject({ answerClass: 'cannot', notice: 'support', mood: 'serious', unlocked: [] });
  });

  it('works under a path prefix', async () => {
    const { handle } = setup();
    const r = await handle(new Request(BASE + '/games/janedoe/api/cases'));
    expect(r.status).toBe(200);
  });
});
