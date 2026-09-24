import { describe, expect, it } from 'vitest';
import { createApiHandler } from '../../server/http/handler';
import { createRuntime } from '../../server/http/runtime';
import { FIXTURE_ID, fixtureRegistry } from './helpers';

const caseId = FIXTURE_ID;
const BASE = 'http://game.test';

function setup(env: Record<string, string> = {}, rateRules?: Parameters<typeof createRuntime>[0]['rateRules']) {
  const registry = fixtureRegistry();
  const rt = createRuntime({ env: { APP_ENV: 'production', SESSION_SECRET: 'handler-test-secret', ...env }, content: () => registry, rateRules });
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
    const hb = await body(h);
    expect(hb).toMatchObject({ ok: true, mode: 'rules', cases: 1, dev: false, secretConfigured: true });
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
    const { get, post } = setup({ ADMIN_TOKEN: 'sesame' });
    expect((await get('/api/admin/cases')).status).toBe(404);
    expect((await get('/api/admin/cases', { 'x-admin-token': 'wrong' })).status).toBe(404);
    const ok = await get('/api/admin/cases', { 'x-admin-token': 'sesame' });
    expect(ok.status).toBe(200);
    const b = await body(ok);
    expect(b.cases[0].validation.ok).toBe(true);
    expect(b.cases[0].data.truth.causeOfDeath).toBe('一酸化炭素中毒');
    // admin callers get traces on normal routes and can override the mode
    const ask = await body(await post('/api/ask', { caseId, question: '雨でしたか' }, { 'x-admin-token': 'sesame' }));
    expect(ask.trace.mode).toBe('rules');
    const dbg = await body(await post('/api/admin/ask-debug', { caseId, question: 'コンロは関係ありますか', mode: 'jev' }, { 'x-admin-token': 'sesame' }));
    expect(dbg.trace.parts[0].source).toBe('keyword');
    expect(dbg.trace.requestedMode).toBe('rules'); // stubs → degraded to rules
    const traces = await body(await get('/api/admin/traces?limit=5', { 'x-admin-token': 'sesame' }));
    expect(traces.length).toBeGreaterThanOrEqual(2);
    expect(traces[0].kind).toBe('ask');
    const bench = await body(await get('/api/admin/bench', { 'x-admin-token': 'sesame' }));
    expect(bench).toEqual([]);
    const status = await body(await get('/api/admin/status', { 'x-admin-token': 'sesame' }));
    expect(status.mode).toBe('rules');
    expect(JSON.stringify(status)).not.toContain('handler-test-secret');
    // no ADMIN_TOKEN configured → never admin in production
    const none = setup();
    expect((await none.get('/api/admin/status', { 'x-admin-token': '' })).status).toBe(404);
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

  it('works under a path prefix', async () => {
    const { handle } = setup();
    const r = await handle(new Request(BASE + '/games/janedoe/api/cases'));
    expect(r.status).toBe(200);
  });
});
