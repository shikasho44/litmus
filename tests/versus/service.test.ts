/**
 * Online versus service (server/versus/service.ts) on the memory store: room lifecycle, token
 * binding and forgery, first-solve atomicity, derived progress, elimination.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api';
import { VERSUS_COUNTDOWN_MS, VERSUS_ERR } from '../../shared/versus';
import { initialState, type GameState } from '../../server/engine/state';
import { signToken, verifyToken } from '../../server/engine/token';
import { makeRoomBinding } from '../../server/engine/room-binding';
import { verdictBlankOrder } from '../../server/engine/public-view';
import { MemoryRoomStore } from '../../server/versus/store';
import { deriveProgress, MAX_RUN_ISSUES, ROOM_TTL_SEC, VersusService } from '../../server/versus/service';
import { FIXTURE_ID, SECRET, fixtureCase, fixtureRegistry, makeService } from '../engine/helpers';

const caseId = FIXTURE_ID;

function setup(opts: { difficulty?: 'easy' | 'normal' | 'hard' } = {}) {
  let now = 1_800_000_000_000;
  const clock = () => now;
  const store = new MemoryRoomStore(clock);
  const registry = fixtureRegistry();
  const vs = new VersusService({ store, secret: SECRET, content: () => registry, clock });
  const { svc } = makeService({ clock });
  const advance = (ms: number) => (now += ms);
  const host = () => vs.create({ caseId, difficulty: opts.difficulty ?? 'easy', name: 'ホスト' });
  return { vs, svc, store, clock, advance, host, registry };
}

async function err(p: Promise<unknown>): Promise<{ code: string; status?: number; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, status: (e as ApiError & { status?: number }).status, message: e.message };
    throw e;
  }
}

/** Host + n joiners, started and past the countdown. */
async function startedRoom(n = 1, opts: { difficulty?: 'easy' | 'normal' | 'hard' } = {}) {
  const t = setup(opts);
  const h = await t.host();
  const others = [];
  for (let i = 0; i < n; i++) others.push(await t.vs.join({ code: h.room.code, name: `P${i + 1}` }));
  await t.vs.start(h.seat);
  t.advance(VERSUS_COUNTDOWN_MS + 10);
  return { ...t, h, others };
}

describe('versus rooms', () => {
  it('create → join → start → countdown → playing', async () => {
    const t = setup();
    const h = await t.host();
    expect(h.room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(h.room.status).toBe('lobby');
    expect(h.room.players).toEqual([expect.objectContaining({ name: 'ホスト', host: true, you: true, stage: 'lobby' })]);
    expect(h.seat.startsWith(`${h.room.code}.`)).toBe(true);

    // lower-case / spaced code works; the joiner sees both, the host marked
    const j = await t.vs.join({ code: h.room.code.toLowerCase().replace(/(...)/, '$1 '), name: 'ゲスト' });
    expect(j.room.players.map((p) => [p.name, p.host, p.you])).toEqual([
      ['ホスト', true, false],
      ['ゲスト', false, true],
    ]);
    // a second player with the same name gets a suffix
    const j2 = await t.vs.join({ code: h.room.code, name: 'ゲスト' });
    expect(j2.room.players.find((p) => p.you)?.name).toBe('ゲスト2');

    // only the host starts
    expect(await err(t.vs.start(j.seat))).toMatchObject({ status: 403, message: VERSUS_ERR.notHost });
    const s = await t.vs.start(h.seat);
    expect(s.room.status).toBe('countdown');
    expect(s.room.startAt).toBe(t.clock() + VERSUS_COUNTDOWN_MS);
    // starting twice is harmless (startAt does not move)
    t.advance(500);
    expect((await t.vs.start(h.seat)).room.startAt).toBe(s.room.startAt);
    // no joins after the start
    expect(await err(t.vs.join({ code: h.room.code, name: 'late' }))).toMatchObject({ status: 409, message: VERSUS_ERR.started });
    t.advance(VERSUS_COUNTDOWN_MS);
    const st = await t.vs.state(j.seat);
    expect(st.room.status).toBe('playing');
    expect(st.room.players.every((p) => p.stage === 'investigation' && p.progress === 0)).toBe(true);
    expect(st.room.now).toBe(t.clock());
  });

  it('holds 2..4 players and refuses unknown or malformed rooms', async () => {
    const t = setup();
    const h = await t.host();
    expect(await err(t.vs.start(h.seat))).toMatchObject({ status: 409, message: VERSUS_ERR.tooFew });
    for (const n of ['a', 'b', 'c']) await t.vs.join({ code: h.room.code, name: n });
    expect(await err(t.vs.join({ code: h.room.code, name: 'd' }))).toMatchObject({ status: 409, message: VERSUS_ERR.full });
    expect(await err(t.vs.join({ code: 'ZZZZZZ', name: 'x' }))).toMatchObject({ status: 404, message: VERSUS_ERR.notFound });
    expect(await err(t.vs.join({ code: 'ABC', name: 'x' }))).toMatchObject({ status: 400, message: VERSUS_ERR.badCode });
    expect(await err(t.vs.join({ code: h.room.code, name: '   ' }))).toMatchObject({ status: 400, message: VERSUS_ERR.badName });
    expect(await err(t.vs.create({ caseId, difficulty: 'easy', name: 'x'.repeat(13) }))).toMatchObject({ message: VERSUS_ERR.badName });
    expect(await err(t.vs.create({ caseId, difficulty: 'expert', name: 'x' }))).toMatchObject({ status: 400 });
    expect(await err(t.vs.create({ caseId: 'c00-none', difficulty: 'easy', name: 'x' }))).toMatchObject({ status: 404 });
  });

  it('a retried join from the same tab gets the same seat back', async () => {
    const t = setup();
    const h = await t.host();
    const cid = 'tab-id-0123456789abcdef';
    const a = await t.vs.join({ code: h.room.code, name: 'ゲスト', cid });
    const b = await t.vs.join({ code: h.room.code, name: 'ゲスト', cid });
    expect(b.seat).toBe(a.seat);
    expect(b.room.players).toHaveLength(2);
  });

  it('seats are signed: a forged or foreign seat is refused', async () => {
    const t = setup();
    const h = await t.host();
    const [code, pid, sig] = h.seat.split('.');
    expect(await err(t.vs.state(`${code}.${pid}.${'A'.repeat(22)}`))).toMatchObject({ status: 403, message: VERSUS_ERR.seat });
    // flip the last character to a DIFFERENT one (a pid that already ends in z must still be forged)
    const forged = pid.replace(/.$/, (c) => (c === 'z' ? 'y' : 'z'));
    expect(await err(t.vs.state(`${code}.${forged}.${sig}`))).toMatchObject({ status: 403 });
    expect(await err(t.vs.state('garbage'))).toMatchObject({ status: 403 });
    // the same seat string against another server secret
    const other = new VersusService({ store: t.store, secret: 'another-secret-0123456789', content: () => t.registry, clock: t.clock });
    expect(await err(other.state(h.seat))).toMatchObject({ status: 403 });
  });

  it('leaving: a guest frees the slot in the lobby, the host closes the room, after the start it is 退出', async () => {
    const t = setup();
    const h = await t.host();
    const g = await t.vs.join({ code: h.room.code, name: 'g' });
    await t.vs.leave(g.seat);
    expect((await t.vs.state(h.seat)).room.players).toHaveLength(1);
    expect(await err(t.vs.state(g.seat))).toMatchObject({ status: 410 });
    await t.vs.leave(g.seat); // idempotent
    await t.vs.leave(h.seat);
    expect((await t.vs.state(h.seat)).room.status).toBe('closed');
    expect(await err(t.vs.join({ code: h.room.code, name: 'x' }))).toMatchObject({ status: 410, message: VERSUS_ERR.closed });

    const r = await startedRoom(1);
    await r.vs.leave(r.others[0].seat);
    const v = (await r.vs.state(r.h.seat)).room;
    expect(v.players.find((p) => p.name === 'P1')).toMatchObject({ left: true, online: false });
    expect(await err(r.vs.run(r.others[0].seat))).toMatchObject({ status: 410, message: VERSUS_ERR.left });
    // everyone still in is… the host alone, not done yet
    expect(v.status).toBe('playing');
  });

  it('rooms expire', async () => {
    const t = setup();
    const h = await t.host();
    t.advance(ROOM_TTL_SEC * 1000 + 1);
    expect(await err(t.vs.state(h.seat))).toMatchObject({ status: 404, message: VERSUS_ERR.notFound });
  });
});

describe('versus runs and anti-cheat', () => {
  it('run tokens only after the start, bound to this room and player', async () => {
    const t = setup();
    const h = await t.host();
    const g = await t.vs.join({ code: h.room.code, name: 'g' });
    expect(await err(t.vs.run(h.seat))).toMatchObject({ status: 409, message: VERSUS_ERR.notStarted });
    await t.vs.start(h.seat);
    expect(await err(t.vs.run(h.seat))).toMatchObject({ status: 409 }); // still counting down
    t.advance(VERSUS_COUNTDOWN_MS - 200); // within the jitter allowance
    const run = await t.vs.run(g.seat);
    const s = await verifyToken(run.token, SECRET, caseId, t.clock());
    expect(s.room).toMatch(new RegExp(`^${h.room.code}\\.[^.]+\\.${g.room.you}\\.e$`));
    expect(run.progress.asked).toBe(0);
    // the room binding survives ordinary game calls
    const ask = await t.svc.ask({ caseId, question: '雨が降っていましたか？', token: run.token });
    expect((await verifyToken(ask.token, SECRET, caseId, t.clock())).room).toBe(s.room);
    const hint = await t.svc.hint({ caseId, token: ask.token });
    expect((await verifyToken(hint.token, SECRET, caseId, t.clock())).room).toBe(s.room);
  });

  it('progress is derived from the token, never from the client', async () => {
    const r = await startedRoom(1);
    const run = await r.vs.run(r.h.seat);
    const a1 = await r.svc.ask({ caseId, question: '雨が降っていましたか？', token: run.token });
    r.advance(1000);
    const a2 = await r.svc.ask({ caseId, question: 'テントの中で火を使っていましたか？', token: a1.token });
    r.advance(1000);
    const v = (await r.vs.progress(r.h.seat, a2.token)).room;
    const me = v.players.find((p) => p.you)!;
    expect(me.asked).toBe(2);
    expect(me.stage).toBe('investigation');
    expect(me.progress).toBe(Math.round(a2.progress.progress * 1000) / 1000);
    // the view carries no fact ids / case text, only aggregates
    expect(JSON.stringify(v)).not.toMatch(/F0\d|F1\d|テント/);
    // an older token submitted late does not move the bar back
    r.advance(1000);
    const back = (await r.vs.progress(r.h.seat, a1.token)).room.players.find((p) => p.you)!;
    expect(back.asked).toBe(2);
  });

  it('refuses tokens that are not this run: unbound, other room, other player, forged, other case', async () => {
    const r = await startedRoom(1);
    const hostRun = await r.vs.run(r.h.seat);
    const guestSeat = r.others[0].seat;
    // a single-player token, even solved
    const solo = await r.svc.mintToken(caseId, 'solved');
    expect(await err(r.vs.progress(guestSeat, solo.token))).toMatchObject({ status: 403, message: VERSUS_ERR.binding });
    // the host's bound token submitted from the guest's seat
    expect(await err(r.vs.progress(guestSeat, hostRun.token))).toMatchObject({ status: 403, message: VERSUS_ERR.binding });
    // a token bound to the same code but another room instance (nonce)
    const fake = makeRoomBinding(r.h.room.code, 'othernonce1', r.others[0].room.you, 'easy');
    const stale = await signToken({ ...initialState((await r.registry.get(caseId, true))!.data, r.clock()), solved: true, verdictAttempts: 1, room: fake }, SECRET, r.clock());
    expect(await err(r.vs.progress(guestSeat, stale))).toMatchObject({ status: 403, message: VERSUS_ERR.binding });
    // forged: right binding, wrong key
    const guestRun = await r.vs.run(guestSeat);
    const bound = (await verifyToken(guestRun.token, SECRET, caseId, r.clock())).room!;
    const forged = await signToken({ ...initialState(fixtureCase(), r.clock()), solved: true, verdictAttempts: 1, room: bound }, 'not-the-server-secret', r.clock());
    expect(await err(r.vs.progress(guestSeat, forged))).toMatchObject({ code: 'bad_token' });
    // tampered payload
    const [p, body, sig] = guestRun.token.split('.');
    expect(await err(r.vs.progress(guestSeat, `${p}.${body}x.${sig}`))).toMatchObject({ code: 'bad_token' });
    // nobody won
    expect((await r.vs.state(r.h.seat)).room.winner).toBeUndefined();
  });

  it('the first solve wins atomically; later solvers are ranked by time', async () => {
    const r = await startedRoom(3);
    const seats = [r.h.seat, ...r.others.map((o) => o.seat)];
    const runs = await Promise.all(seats.map((s) => r.vs.run(s)));
    // every player gets a solved token of their own run (dev-bound, as QA does)
    const minted = await Promise.all(runs.map(() => r.svc.mintToken(caseId, 'solved')));
    const bound = await Promise.all(seats.map((s, i) => new VersusService({ store: r.store, secret: SECRET, content: () => r.registry, clock: r.clock, dev: true }).devBind(s, minted[i].token)));
    r.advance(60_000);
    // three submit at the same moment
    const res = await Promise.all([0, 1, 2].map((i) => r.vs.progress(seats[i], bound[i].token)));
    const winners = new Set(res.map((x) => x.room.winner?.id).filter(Boolean));
    expect(winners.size).toBe(1);
    const v = (await r.vs.state(r.h.seat)).room;
    const ranks = v.players.filter((p) => p.rank).map((p) => p.rank).sort();
    expect(ranks).toEqual([1, 2, 3]);
    expect(v.players.find((p) => p.rank === 1)!.id).toBe(v.winner!.id);
    expect(v.winner!.ms).toBe(60_000 + 10);
    expect(v.status).toBe('playing'); // the 4th player is still at it
    r.advance(5_000);
    const last = await r.vs.progress(seats[3], bound[3].token);
    expect(last.room.players.find((p) => p.you)).toMatchObject({ rank: 4, finishMs: 65_000 + 10, stage: 'solved', progress: 1 });
    expect(last.room.status).toBe('finished');
    // submitting again changes nothing
    r.advance(5_000);
    const again = await r.vs.progress(seats[0], bound[0].token);
    expect(again.room.winner).toEqual(v.winner);
  });

  it('counts verdict attempts on the server: out of lights → 脱落, no win afterwards', async () => {
    const r = await startedRoom(1, { difficulty: 'normal' }); // 3 lights, cloze verdict
    const seat = r.h.seat;
    const run = await r.vs.run(seat);
    let token = run.token;
    // the room fixes the format: a choice verdict is refused for a 審問官 room
    expect(await err(r.svc.verdict({ caseId, token, mode: 'choice', choice: 'co' }))).toMatchObject({ code: 'bad_request' });
    expect(await err(r.svc.verdictSetup({ caseId, token, mode: 'choice' }))).toMatchObject({ code: 'bad_request' });
    // out-of-range picks are a bad request (not an attempt)
    expect(await err(r.svc.verdict({ caseId, token, mode: 'cloze', blanks: { place: 9, source: 9, cause: 9 } }))).toMatchObject({ code: 'bad_request' });
    for (let i = 0; i < 3; i++) {
      const before = token;
      const res = await r.svc.verdict({ caseId, token, mode: 'cloze', blanks: { place: wrong('place'), source: wrong('source'), cause: wrong('cause') } });
      expect(res.result).not.toBe('correct');
      await r.vs.observeVerdict(caseId, before, res.token);
      token = res.token;
    }
    const me = (await r.vs.state(seat)).room.players.find((p) => p.you)!;
    expect(me.out).toBe(true);
    expect(me.stage).toBe('inquest');
    // a later solved token (e.g. from a modified client) does not win, and no new run is issued
    const minted = await r.svc.mintToken(caseId, 'solved');
    const bound = await new VersusService({ store: r.store, secret: SECRET, content: () => r.registry, clock: r.clock, dev: true }).devBind(seat, minted.token);
    await r.vs.progress(seat, bound.token);
    expect((await r.vs.state(seat)).room.winner).toBeUndefined();
    expect(await err(r.vs.run(seat))).toMatchObject({ status: 403, message: VERSUS_ERR.out });
  });

  it('a verdict accepted within the lights wins at once (observeVerdict)', async () => {
    const r = await startedRoom(1, { difficulty: 'easy' });
    const seat = r.others[0].seat;
    const run = await r.vs.run(seat);
    const wrongRes = await r.svc.verdict({ caseId, token: run.token, mode: 'choice', choice: 'poison' });
    await r.vs.observeVerdict(caseId, run.token, wrongRes.token);
    r.advance(2000);
    const ok = await r.svc.verdict({ caseId, token: wrongRes.token, mode: 'choice', choice: 'co' });
    expect(ok.result).toBe('correct');
    await r.vs.observeVerdict(caseId, wrongRes.token, ok.token);
    const v = (await r.vs.state(r.h.seat)).room;
    expect(v.winner).toMatchObject({ name: 'P1', ms: 2010 });
    expect(v.players.find((p) => p.name === 'P1')).toMatchObject({ rank: 1, stage: 'solved', progress: 1 });
    // an unbound verdict is ignored by the observer
    const solo = await r.svc.newToken(caseId);
    await r.vs.observeVerdict(caseId, solo.token, (await r.svc.verdict({ caseId, token: solo.token, mode: 'choice', choice: 'co' })).token);
    expect((await r.vs.state(r.h.seat)).room.winner?.name).toBe('P1');
  });

  it('re-issues a lost run token a few times, keeping the counters', async () => {
    const r = await startedRoom(1);
    const first = await r.vs.run(r.h.seat);
    const asked = await r.svc.ask({ caseId, question: '雨が降っていましたか？', token: first.token });
    await r.vs.progress(r.h.seat, asked.token);
    const again = await r.vs.run(r.h.seat);
    expect(again.progress.asked).toBe(1);
    for (let i = 2; i < MAX_RUN_ISSUES; i++) await r.vs.run(r.h.seat);
    expect(await err(r.vs.run(r.h.seat))).toMatchObject({ code: 'rate_limited' });
  });
});

describe('deriveProgress', () => {
  const c = fixtureCase();
  const base = (): GameState => initialState(c, 0);
  it('maps the token to stage / progress / questions', () => {
    expect(deriveProgress(c, base())).toEqual({ p: expect.any(Number), st: 'investigation', q: 0, b: 0 });
    expect(deriveProgress(c, { ...base(), asked: 7 }).q).toBe(7);
    expect(deriveProgress(c, { ...base(), asked: 7, spent: 5 }).b).toBe(5);
    expect(deriveProgress(c, { ...base(), cleared: ['R1'] }).st).toBe('inquest');
    expect(deriveProgress(c, { ...base(), debateMisses: 1 }).st).toBe('inquest');
    expect(deriveProgress(c, { ...base(), verdictAttempts: 1 }).st).toBe('inquest');
    expect(deriveProgress(c, { ...base(), solved: true })).toMatchObject({ st: 'solved', p: 1 });
    const more = deriveProgress(c, { ...base(), unlocked: ['F01', 'F04', 'F06', 'F10'] }).p;
    expect(more).toBeGreaterThan(deriveProgress(c, base()).p);
    expect(more).toBeLessThanOrEqual(1);
  });
});

/** A wrong option index of the fixture's cloze blank as displayed (display order is shuffled). */
function wrong(blank: 'place' | 'source' | 'cause'): number {
  const c = fixtureCase();
  const b = c.verdictModes!.cloze.blanks.find((x) => x.id === blank)!;
  return verdictBlankOrder(c, b).indexOf(b.answer) === 0 ? 1 : 0;
}
