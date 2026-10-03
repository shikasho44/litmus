/**
 * 質問枠 (question budget, shared/budget.ts): the numbers, what counts, the token field and the
 * server-side hard limit (client-declared for single player, the room's for versus 教授 runs).
 */
import { describe, expect, it } from 'vitest';
import { BUDGET_TUNING, budgetView, casePar, isCharged, overBudgetPoints, questionBudget } from '../../shared/budget';
import { b64urlDecode, b64urlEncode, signToken, verifyToken } from '../../server/engine/token';
import { hmacSha256 } from '../../server/engine/sha256';
import { initialState } from '../../server/engine/state';
import { makeRoomBinding } from '../../server/engine/room-binding';
import { BUDGET_CLOSED_LINE } from '../../server/engine/game';
import { FIXTURE_ID, SECRET, fixtureCase, makeService } from './helpers';

const caseId = FIXTURE_ID;
const now = 1_800_000_000_000;
const enc = new TextEncoder();
function signRaw(payload: Record<string, unknown>): string {
  const msg = `j1.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  return `${msg}.${b64urlEncode(hmacSha256(enc.encode(SECRET), enc.encode(msg)))}`;
}

describe('budget numbers (shared/budget.ts)', () => {
  it('par and the default budgets per case difficulty and play difficulty', () => {
    expect([1, 2, 3].map(casePar)).toEqual([22, 30, 38]);
    expect([1, 2, 3].map((d) => questionBudget(d, 'easy'))).toEqual([29, 39, 49]);
    expect([1, 2, 3].map((d) => questionBudget(d, 'normal'))).toEqual([22, 30, 38]);
    expect([1, 2, 3].map((d) => questionBudget(d, 'hard'))).toEqual([18, 24, 30]);
    // junk difficulties fall back (case 1..3 clamped, play → normal)
    expect(questionBudget(9, undefined)).toBe(38);
    expect(questionBudget(Number.NaN, 'hard')).toBe(18);
  });

  it('a case override wins per difficulty and is clamped to the minimum', () => {
    expect(questionBudget(1, 'hard', { hard: 8 })).toBe(8);
    expect(questionBudget(1, 'normal', { hard: 8 })).toBe(22);
    expect(questionBudget(1, 'easy', { easy: 1 })).toBe(BUDGET_TUNING.minBudget);
  });

  it('view states: ok → low → zero / over (guide, soft) or closed (hard)', () => {
    expect(budgetView(0, 29, 'normal').state).toBe('ok');
    expect(budgetView(20, 29, 'normal')).toMatchObject({ state: 'ok', left: 9 });
    expect(budgetView(21, 29, 'normal')).toMatchObject({ state: 'low', left: 8 });
    expect(budgetView(29, 29, 'normal')).toMatchObject({ state: 'zero', left: 0, over: 0 });
    expect(budgetView(31, 29, 'normal')).toMatchObject({ state: 'over', over: 2 });
    expect(budgetView(40, 35, 'easy')).toMatchObject({ state: 'over', kind: 'guide' });
    expect(budgetView(24, 24, 'hard')).toMatchObject({ state: 'closed', kind: 'hard' });
    expect(budgetView(23, 24, 'hard').state).toBe('low');
  });

  it('over-budget points follow the rule and its cap', () => {
    expect(overBudgetPoints(29, 29, 1.5, 24)).toBe(0);
    expect(overBudgetPoints(33, 29, 1.5, 24)).toBe(6);
    expect(overBudgetPoints(99, 29, 1.5, 24)).toBe(24);
    expect(overBudgetPoints(50, 29, 0, 0)).toBe(0);
  });

  it('only polar / irrelevant answers without a meta kind count', () => {
    for (const c of ['yes', 'no', 'partial', 'irrelevant'] as const) expect(isCharged(c)).toBe(true);
    for (const c of ['cannot', 'vague'] as const) expect(isCharged(c)).toBe(false);
    expect(isCharged('irrelevant', 'offtopic')).toBe(false);
    expect(isCharged('irrelevant', 'aboutHolma')).toBe(false);
    expect(isCharged('vague', 'open')).toBe(false);
  });
});

describe('counting against the budget (server)', () => {
  it('counts case questions, not hint requests, small talk, vague or safety answers', async () => {
    const { svc } = makeService();
    let r = await svc.ask({ caseId, question: 'テントの中にコンロがありましたか？' });
    expect(r.answers[0].free).toBeUndefined();
    expect(r.progress).toMatchObject({ asked: 1, spent: 1 });
    for (const q of ['ヒントをください', 'ホルマは何歳ですか？', 'どこで見つかったの？', '死にたい']) {
      r = await svc.ask({ caseId, question: q, token: r.token });
      expect(r.answers.every((a) => a.free === true), q).toBe(true);
      expect(r.answers.every((a) => a.unlocked.length === 0), q).toBe(true);
    }
    expect(r.progress.asked).toBe(5);
    expect(r.progress.spent).toBe(1);
    // the counter survives the token round trip
    const s = await verifyToken(r.token, SECRET, caseId);
    expect(s).toMatchObject({ asked: 5, spent: 1 });
  });

  it('multi-question messages count per charged part', async () => {
    const { svc } = makeService();
    const r = await svc.ask({ caseId, question: 'コンロはありましたか？ヒントをください？雨でしたか？' });
    expect(r.answers).toHaveLength(3);
    expect(r.answers.map((a) => !!a.free)).toEqual([false, true, false]);
    expect(r.progress).toMatchObject({ asked: 3, spent: 2 });
  });
});

describe('the token field q', () => {
  it('is omitted while spent = asked, written otherwise, and older tokens read spent = asked', async () => {
    const c = fixtureCase();
    const same = await signToken({ ...initialState(c, now), asked: 4, spent: 4 }, SECRET, now);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(same.split('.')[1]))).q).toBeUndefined();
    expect((await verifyToken(same, SECRET, caseId, now)).spent).toBe(4);
    const diff = await signToken({ ...initialState(c, now), asked: 4, spent: 2 }, SECRET, now);
    expect((await verifyToken(diff, SECRET, caseId, now)).spent).toBe(2);
    const legacy = signRaw({ v: 1, c: caseId, u: ['F01'], m: [], n: [6, 0, 0, 0, 0], rm: {}, r: [], f: 0, t: Math.floor(now / 1000) });
    expect((await verifyToken(legacy, SECRET, caseId, now)).spent).toBe(6);
  });

  it('a spent larger than asked is a bad token', async () => {
    const t = signRaw({ v: 1, c: caseId, u: [], m: [], n: [2, 0, 0, 0, 0], q: 3, rm: {}, r: [], f: 0, t: Math.floor(now / 1000) });
    await expect(verifyToken(t, SECRET, caseId, now)).rejects.toMatchObject({ code: 'bad_token' });
  });
});

describe('hard limit', () => {
  it('a declared limit cuts a multi-question message at the last counted part it allows', async () => {
    const { svc } = makeService();
    const m = await svc.mintToken(caseId, 'fresh', { admin: true }, 3);
    expect(m.progress).toMatchObject({ asked: 3, spent: 3 });
    const r = await svc.ask({ caseId, question: 'ヒントをください？コンロはありましたか？雨でしたか？', token: m.token, limit: 4 }, { withTrace: true });
    expect(r.answers.map((a) => a.question)).toEqual(['ヒントをください？', 'コンロはありましたか？']);
    expect(r.progress).toMatchObject({ asked: 5, spent: 4 });
    expect(r.trace?.fallback).toContain('budget-dropped:1');
    // used up: Holma declines, nothing is judged or counted
    const closed = await svc.ask({ caseId, question: '雨でしたか？', token: r.token, limit: 4 });
    expect(closed.answers).toEqual([expect.objectContaining({ answerClass: 'cannot', line: BUDGET_CLOSED_LINE, free: true, unlocked: [] })]);
    expect(closed.progress).toMatchObject({ asked: 5, spent: 4 });
    // no limit declared (見習い / 審問官, or an old client): the same token keeps asking
    const open = await svc.ask({ caseId, question: '雨でしたか？', token: r.token });
    expect(open.progress.spent).toBe(5);
  });

  it('a room-bound 教授 run is limited by its room whatever the client sends', async () => {
    const { svc } = makeService();
    const c = fixtureCase();
    const hardBudget = questionBudget(c.difficulty, 'hard');
    const bind = (d: 'hard' | 'normal') => makeRoomBinding('ABC234', 'nonce12345', '1abcde', d);
    const at = Date.now();
    const hard = await signToken({ ...initialState(c, at), room: bind('hard'), asked: hardBudget, spent: hardBudget }, SECRET, at);
    const r = await svc.ask({ caseId, question: '雨でしたか？', token: hard, limit: 999 });
    expect(r.answers[0].line).toBe(BUDGET_CLOSED_LINE);
    expect(r.progress.spent).toBe(hardBudget);
    expect((await verifyToken(r.token, SECRET, caseId)).room).toBe(bind('hard'));
    // one below: the last question is answered, a second part is dropped
    const last = await signToken({ ...initialState(c, at), room: bind('hard'), asked: hardBudget - 1, spent: hardBudget - 1 }, SECRET, at);
    const r2 = await svc.ask({ caseId, question: 'コンロはありましたか？雨でしたか？', token: last });
    expect(r2.answers).toHaveLength(1);
    expect(r2.progress.spent).toBe(hardBudget);
    // a 審問官 room has no hard limit (its budget is a soft one, scored in the browser)
    const normal = await signToken({ ...initialState(c, at), room: bind('normal'), asked: 60, spent: 60 }, SECRET, at);
    const r3 = await svc.ask({ caseId, question: '雨でしたか？', token: normal, limit: 1 });
    expect(r3.answers[0].answerClass).toBe('yes');
    expect(r3.progress.spent).toBe(61);
  });
});

describe('free answers never unlock a finding (every real case, every probe, rules mode)', () => {
  it('holds for all authored probes asked on a fully open investigation', async () => {
    const { loadRegistry, resolveContentRoot } = await import('../../server/node/content-fs');
    const { GameService } = await import('../../server/engine/game');
    const { PROTO_IDS } = await import('../../shared/proto');
    const registry = loadRegistry(resolveContentRoot({}));
    const svc = new GameService({ content: () => registry, secret: SECRET, components: { mode: 'rules', warnings: [] }, dev: true });
    let checked = 0;
    for (const loaded of registry.list(true)) {
      // every switch on: the prototype cases (?proto=seeds) are checked too
      const o = { protos: PROTO_IDS };
      const t0 = await svc.newToken(loaded.data.id, o);
      for (const p of loaded.data.probes) {
        const r = await svc.ask({ caseId: loaded.data.id, question: p.q, token: t0.token }, o);
        const counted = r.answers.filter((a) => !a.free).length;
        expect((r.progress.spent ?? -1) - (t0.progress.spent ?? 0), p.q).toBe(counted);
        for (const a of r.answers) if (a.free) expect(a.unlocked, `${loaded.data.id}: ${p.q}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);
});
