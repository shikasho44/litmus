/**
 * PROTOTYPE switch `lab` (2026-10-04, docs/decisions.md 「I-001 ツクールの見本3問」 and 「ツクール →
 * リトマス・ラボ（仮）に改名」): the three sample puzzles of the I-001 リトマス・ラボ (c10–c12, case.json
 * `proto: "lab"`), made from a one-line ending the way the future AI drafter would make them, without
 * hand-made art. Same visibility rules as the seeds prototype (tests/engine/proto-seeds.test.ts): they
 * exist for a player only with ?proto=lab (or the old ?proto=tsukuru, an alias), never in online
 * versus, and never next to ?proto=seeds alone.
 */
import { describe, expect, it } from 'vitest';
import { PROTO_CASES, PROTO_HEADER, parseProtos } from '../../shared/proto';
import { validateCase } from '../../server/engine/validate';
import { evaluateVerdict } from '../../server/engine/verdict';
import { toSummary } from '../../server/engine/public-view';
import { createApiHandler } from '../../server/http/handler';
import { createRuntime } from '../../server/http/runtime';
import { MemoryRoomStore } from '../../server/versus/store';
import { contentRegistry } from '../content/regression-harness';
import { fixtureRaw } from './helpers';

const LAB = ['c10-shaken-bottle', 'c11-wet-window', 'c12-two-shadows'];
/** The ending each creator typed: the answer the drafted puzzle must accept as it is. */
const CREATOR_ANSWER: Record<string, string> = { 'c10-shaken-bottle': '過冷却', 'c11-wet-window': '結露', 'c12-two-shadows': '光源がふたつ' };
const reg = () => contentRegistry();
const ids = (xs: { data: { id: string } }[]) => xs.map((c) => c.data.id);

describe('the リトマス・ラボ samples behind ?proto=lab', () => {
  it('are mirrored in PROTO_CASES and join the list only with their switch, as numbers 10–12', () => {
    for (const id of LAB) expect(PROTO_CASES[id], id).toBe('lab');
    const plain = ids(reg().list(false, []));
    expect(plain).toHaveLength(8);
    expect(ids(reg().list(false, ['seeds'])).some((id) => LAB.includes(id))).toBe(false);
    expect(ids(reg().list(true, ['i005', 'seeds'])).some((id) => LAB.includes(id))).toBe(false); // dev without the switch
    const on = reg().list(false, ['lab']);
    expect(ids(on)).toEqual([...plain, ...LAB]);
    expect(on.slice(8).map((c) => c.data.number)).toEqual([10, 11, 12]);
    for (const id of LAB) {
      expect(reg().get(id), id).toBeUndefined();
      expect(reg().get(id, false, ['lab'])?.data.publish, id).toBe(false);
      expect(toSummary(reg().get(id, true)!.data).proto, id).toBe('lab'); // the case card says 「ラボの見本」
    }
  });

  it('the old switch name ?proto=tsukuru still turns them on, as `lab` (an alias for old links)', () => {
    expect(parseProtos('tsukuru')).toEqual(['lab']);
    expect(parseProtos('seeds,tsukuru')).toEqual(['seeds', 'lab']);
    expect(parseProtos(['tsukuru', 'lab'])).toEqual(['lab']);
    expect(ids(reg().list(false, parseProtos('tsukuru'))).slice(-3)).toEqual(LAB);
  });

  it('pass the validator clean (rules self-consistency 100 %, no warnings)', () => {
    for (const id of LAB) {
      const v = validateCase(reg().get(id, true)!.data, { skipGeneralization: true });
      expect(v.errors, id).toEqual([]);
      expect(v.warnings, id).toEqual([]);
      expect(v.stats?.selfConsistency.rate, id).toBe(1);
    }
  });

  it('use no hand-made art: no portrait, background or panel images; the shard portrait draws the outline', () => {
    for (const id of LAB) {
      const c = reg().get(id, true)!.data;
      expect(c.victim.portrait, id).toBe('');
      expect(c.assets.background, id).toBe('');
      expect(c.victim.silhouette, id).toMatch(/^M/);
      expect(c.reconstruction.panels.every((p) => !p.image), id).toBe(true);
    }
    // a case without portrait art must give an outline (else the fallback would be a person's bust)
    const raw = fixtureRaw() as Record<string, any>;
    raw.victim.portrait = '';
    delete raw.victim.silhouette;
    expect(validateCase(raw).warnings.some((w) => w.includes('victim.portrait is empty'))).toBe(true);
  });

  it("accept the creator's own one-line answer as a correct verdict", () => {
    for (const id of LAB) expect(evaluateVerdict(reg().get(id, true)!.data, CREATOR_ANSWER[id]).result, id).toBe('correct');
  });

  it('are served over HTTP only with the x-janedoe-proto header, and never in online versus', async () => {
    const rt = createRuntime({
      env: { APP_ENV: 'production', SESSION_SECRET: 'proto-lab-test-secret-0123456789abcdef', PIPELINE_MODE: 'rules' },
      content: () => reg(),
      roomStore: new MemoryRoomStore(),
    });
    const handle = createApiHandler(rt);
    const call = async (path: string, headers: Record<string, string> = {}, body?: unknown) => {
      const r = await handle(
        new Request(`http://game.test${path}`, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
      );
      return { status: r.status, body: (await r.json()) as any };
    };
    const on = { [PROTO_HEADER]: 'lab' };
    expect((await call('/api/cases')).body).toHaveLength(8);
    expect((await call('/api/cases', { [PROTO_HEADER]: 'seeds' })).body).toHaveLength(9);
    const listed = (await call('/api/cases', on)).body.map((c: { id: string }) => c.id);
    expect(listed.slice(-3)).toEqual(LAB);
    expect((await call('/api/cases', { [PROTO_HEADER]: 'tsukuru' })).body.map((c: { id: string }) => c.id).slice(-3)).toEqual(LAB); // the old name
    expect((await call(`/api/cases/${LAB[0]}`)).status).toBe(404);
    expect((await call(`/api/cases/${LAB[0]}`, on)).status).toBe(200);
    const tok = await call('/api/token', on, { caseId: LAB[1] });
    expect(tok.status).toBe(200);
    const ask = await call('/api/ask', on, { caseId: LAB[1], question: '雨が降りましたか？', token: tok.body.token });
    expect(ask.body.answers[0].answerClass).toBe('no');
    expect((await call('/api/versus/create', on, { caseId: LAB[2], difficulty: 'normal', name: '審問官' })).status).toBe(404);
  });
});
