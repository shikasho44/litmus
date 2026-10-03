/**
 * PROTOTYPE switch `seeds` (2026-10-04, docs/decisions.md 「事件の種 No.4『助けられた朝』を試作」):
 * a prototype case (case.json `proto: "seeds"`, c09) exists for a player only while the switch is
 * on — the registry, GameService, the HTTP handler (header x-janedoe-proto), the dev server, the
 * admin tools, online versus (never), the validator and the browser's copy (PROTO_CASES).
 * Without the switch everything is the eight public cases, exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { caseVisible, isProtoId, parseProtos, PROTO_CASES, PROTO_HEADER, PROTO_IDS } from '../../shared/proto';
import { ContentRegistry } from '../../server/engine/registry';
import { GameService } from '../../server/engine/game';
import { validateCase } from '../../server/engine/validate';
import { createApiHandler } from '../../server/http/handler';
import { createRuntime } from '../../server/http/runtime';
import { MemoryRoomStore } from '../../server/versus/store';
import { contentRegistry } from '../content/regression-harness';
import { SECRET, fixtureRaw } from './helpers';

const PROTO_ID = 'c09-rescued-morning';
const PUBLIC = [
  'c08-half-folded-towel', 'c05-tiptoe-milk-bottle', 'c06-snowman-below-zero', 'c07-thirst-beside-water',
  'c01-room-without-breath', 'c02-ball-at-dusk', 'c03-shed-in-snow', 'c04-white-flower-supper',
];
/** The I-001 ツクール samples (?proto=tsukuru, 2026-10-04): another switch, never shown with seeds. */
const TSUKURU = ['c10-shaken-bottle', 'c11-wet-window', 'c12-two-shadows'];
const reg = () => contentRegistry();
const ids = (xs: { data: { id: string } }[]) => xs.map((c) => c.data.id);

describe('shared/proto.ts', () => {
  it('reads the switches from a header / query / stored value', () => {
    expect(PROTO_IDS).toEqual(['i005', 'seeds', 'tsukuru']);
    expect(PROTO_HEADER).toBe('x-janedoe-proto');
    expect(parseProtos('seeds')).toEqual(['seeds']);
    expect(parseProtos('SEEDS, i005')).toEqual(['i005', 'seeds']);
    expect(parseProtos(['seeds', 'banana'])).toEqual(['seeds']);
    expect(parseProtos('banana')).toEqual([]);
    expect(parseProtos(undefined)).toEqual([]);
    expect(parseProtos(null)).toEqual([]);
    expect(isProtoId('seeds') && !isProtoId('evil')).toBe(true);
  });

  it('a prototype case only with its switch, whatever publish says; the catalogue view (no switches given) treats it as unpublished', () => {
    const proto = { publish: false, proto: 'seeds' };
    expect(caseVisible(proto, false, [])).toBe(false);
    expect(caseVisible(proto, true, [])).toBe(false); // dev / admin without the switch
    expect(caseVisible(proto, false, ['i005'])).toBe(false);
    expect(caseVisible(proto, false, ['seeds'])).toBe(true);
    expect(caseVisible({ publish: true, proto: 'seeds' }, false, [])).toBe(false);
    expect(caseVisible(proto, true)).toBe(true); // list(true): tools and tests see every case
    expect(caseVisible(proto, false)).toBe(false);
    // ordinary cases: unchanged
    expect(caseVisible({ publish: true }, false, [])).toBe(true);
    expect(caseVisible({ publish: false }, false, ['seeds'])).toBe(false);
    expect(caseVisible({ publish: false }, true, [])).toBe(true);
  });

  it('PROTO_CASES (the browser’s copy) equals the case files that carry `proto`', () => {
    const fromFiles = Object.fromEntries(reg().cases.filter((c) => c.data.proto).map((c) => [c.data.id, c.data.proto]));
    expect(fromFiles).toEqual({ ...PROTO_CASES });
    expect(fromFiles).toEqual({ [PROTO_ID]: 'seeds', ...Object.fromEntries(TSUKURU.map((id) => [id, 'tsukuru'])) });
  });
});

describe('the registry with the real content', () => {
  it('the default list is exactly the eight public cases, in number order', () => {
    expect(ids(reg().list())).toEqual(PUBLIC);
    expect(ids(reg().list(false, []))).toEqual(PUBLIC);
    expect(ids(reg().list(true, []))).toEqual(PUBLIC); // the dev server without the switch
    expect(ids(reg().list(false, ['i005']))).toEqual(PUBLIC);
  });

  it('with ?proto=seeds the prototype case joins as number 9; the catalogue (list(true)) always has it', () => {
    expect(ids(reg().list(false, ['seeds']))).toEqual([...PUBLIC, PROTO_ID]);
    expect(ids(reg().list(false, ['i005', 'seeds']))).toEqual([...PUBLIC, PROTO_ID]);
    expect(ids(reg().list(true))).toEqual([...PUBLIC, PROTO_ID, ...TSUKURU]);
    expect(reg().get(PROTO_ID)).toBeUndefined();
    expect(reg().get(PROTO_ID, true, [])).toBeUndefined();
    expect(reg().get(PROTO_ID, false, ['seeds'])?.data.number).toBe(9);
    const c = reg().get(PROTO_ID, true)!.data;
    expect(c.publish).toBe(false); // stays out of the public list if the proto field is ever dropped
    expect(c.victim.codename).toBe('ジェーン・ドゥ #09');
  });
});

describe('GameService', () => {
  for (const dev of [false, true]) {
    it(`${dev ? 'dev server' : 'production'}: hidden without the switch, playable with it`, async () => {
      const svc = new GameService({ content: () => reg(), secret: SECRET, components: { mode: 'rules', warnings: [] }, dev });
      expect((await svc.listCases()).map((c) => c.id)).toEqual(PUBLIC);
      expect((await svc.listCases({ protos: ['i005'] })).map((c) => c.id)).toEqual(PUBLIC);
      const withSeeds = await svc.listCases({ protos: ['seeds'] });
      expect(withSeeds.map((c) => c.id)).toEqual([...PUBLIC, PROTO_ID]);
      expect(withSeeds.at(-1)).toMatchObject({ id: PROTO_ID, number: 9, proto: 'seeds' });
      expect(withSeeds.slice(0, 8).every((c) => c.proto === undefined)).toBe(true);
      await expect(svc.getCase(PROTO_ID)).rejects.toMatchObject({ code: 'bad_request', status: 404 });
      await expect(svc.newToken(PROTO_ID)).rejects.toMatchObject({ status: 404 });
      const o = { protos: ['seeds'] as const };
      const t = await svc.newToken(PROTO_ID, o);
      const a = await svc.ask({ caseId: PROTO_ID, question: '助け出したのは兄ですか？', token: t.token }, o);
      expect(a.answers[0].answerClass).toBe('yes');
      // the same token without the switch: the case is not there
      await expect(svc.ask({ caseId: PROTO_ID, question: '助け出したのは兄ですか？', token: a.token })).rejects.toMatchObject({ status: 404 });
    });
  }
});

describe('HTTP (x-janedoe-proto) and online versus', () => {
  const setup = (env: Record<string, string> = {}) => {
    const rt = createRuntime({
      env: { APP_ENV: 'production', SESSION_SECRET: 'proto-seeds-test-secret-0123456789abcdef', PIPELINE_MODE: 'rules', ...env },
      content: () => reg(),
      roomStore: new MemoryRoomStore(),
    });
    const handle = createApiHandler(rt);
    const get = async (path: string, headers: Record<string, string> = {}) => {
      const r = await handle(new Request(`http://game.test${path}`, { headers }));
      return { status: r.status, body: (await r.json()) as any };
    };
    const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
      const r = await handle(new Request(`http://game.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
      return { status: r.status, body: (await r.json()) as any };
    };
    return { get, post };
  };
  const seeds = { [PROTO_HEADER]: 'seeds' };

  it('lists and serves the prototype case only to requests with the switch', async () => {
    const { get, post } = setup();
    expect((await get('/api/cases')).body.map((c: { id: string }) => c.id)).toEqual(PUBLIC);
    expect((await get('/api/cases', { [PROTO_HEADER]: 'i005' })).body.map((c: { id: string }) => c.id)).toEqual(PUBLIC);
    expect((await get('/api/cases', { [PROTO_HEADER]: 'bogus' })).body).toHaveLength(8);
    expect((await get('/api/cases', seeds)).body.map((c: { id: string }) => c.id)).toEqual([...PUBLIC, PROTO_ID]);
    expect((await get('/api/cases', { [PROTO_HEADER]: 'i005,seeds' })).body).toHaveLength(9);
    expect((await get(`/api/cases/${PROTO_ID}`)).status).toBe(404);
    expect((await get(`/api/cases/${PROTO_ID}`, seeds)).status).toBe(200);
    expect((await post('/api/token', { caseId: PROTO_ID })).status).toBe(404);
    const tok = await post('/api/token', { caseId: PROTO_ID }, seeds);
    expect(tok.status).toBe(200);
    expect((await post('/api/ask', { caseId: PROTO_ID, question: '毒は見つかりましたか？', token: tok.body.token })).status).toBe(404);
    const ask = await post('/api/ask', { caseId: PROTO_ID, question: '毒は見つかりましたか？', token: tok.body.token }, seeds);
    expect(ask.body.answers[0].answerClass).toBe('no');
  });

  it('the dev server hides it too (the default QA sees eight cases); the admin tools reach it', async () => {
    const { get, post } = setup({ APP_ENV: 'development' });
    expect((await get('/api/cases')).body).toHaveLength(8);
    expect((await get('/api/health')).body.cases).toBe(8);
    expect((await get('/api/health', seeds)).body.cases).toBe(9);
    const minted = await post('/api/admin/mint-token', { caseId: PROTO_ID, stage: 'investigated' });
    expect(minted.status).toBe(200);
    const admin = await get('/api/admin/cases');
    expect(admin.body.cases.find((c: { id: string }) => c.id === PROTO_ID)).toMatchObject({ publish: false, proto: 'seeds' });
  });

  it('online versus never opens a room on a prototype case, switch or not', async () => {
    const { post } = setup();
    const r = await post('/api/versus/create', { caseId: PROTO_ID, difficulty: 'normal', name: '審問官' }, seeds);
    expect(r.status).toBe(404);
    const ok = await post('/api/versus/create', { caseId: PUBLIC[0], difficulty: 'normal', name: '審問官' }, seeds);
    expect(ok.status).toBe(200);
  });
});

describe('validator', () => {
  it('a prototype case is checked like a published one and must be mirrored in PROTO_CASES', () => {
    const raw = fixtureRaw();
    raw.proto = 'seeds';
    raw.publish = false;
    const v = validateCase(raw);
    expect(v.errors.some((e) => e.includes('PROTO_CASES'))).toBe(true);
    raw.publish = true;
    expect(validateCase(raw).warnings.some((w) => w.includes('keep publish: false'))).toBe(true);
    const bad = fixtureRaw();
    bad.proto = 'banana';
    expect(validateCase(bad).ok).toBe(false);
    // the real prototype case passes clean
    const real = validateCase(reg().get(PROTO_ID, true)!.data, { skipGeneralization: true });
    expect(real.errors).toEqual([]);
    expect(real.warnings).toEqual([]);
  });

  it('ContentRegistry keeps a prototype case out of the public list even when it says publish: true', () => {
    const raw = fixtureRaw();
    raw.proto = 'seeds';
    raw.publish = true;
    const r = ContentRegistry.fromRaw({ cases: [{ dir: raw.id as string, path: 'x', data: raw }] });
    expect(r.list()).toEqual([]);
    expect(r.list(false, ['seeds'])).toHaveLength(1);
  });
});
