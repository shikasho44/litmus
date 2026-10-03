/**
 * VersusService — rooms for the online versus mode (docs/versus.md).
 *
 *   create  host picks case + difficulty + name → room code (6 chars) + seat (signed credential)
 *   join    code + name → seat (2–4 players; refused once the race started)
 *   start   host only, ≥ 2 players → startAt = now + 3.5 s (clients count down to it)
 *   state   the room as the requesting player may see it (aggregate progress only)
 *   run     after startAt: a fresh progress token for the room's case, BOUND to this room and
 *           player (token field `vs`, server/engine/room-binding.ts)
 *   progress  the player's latest token → progress / stage / question count derived from it;
 *           a solved bound token finishes the race (the first one wins, HSETNX)
 *   leave   lobby: frees the slot (the host closes the room) · after the start: marked 退出
 *   observeVerdict  called by the HTTP layer after every verdict: counts the attempt server-side
 *           (5 lights… 3 lights, the room difficulty's rule) and finishes / eliminates at once
 *
 * Anti-cheat: nothing the client says about its progress is trusted. Progress comes from signed
 * tokens; a win needs a valid signature, the room's case, the binding of THIS room instance
 * (code + nonce) and THIS player, the solved flag, and no more verdict attempts than the room's
 * lights (counted on the server as the verdicts happen). Seats are HMAC-signed with
 * SESSION_SECRET, so a player id alone is worth nothing.
 */
import { LIVES_BY_DIFFICULTY, type Difficulty, type ProgressSnapshot, type ProgressToken } from '../../shared/api.js';
import type { Case } from '../../shared/case-schema.js';
import {
  VERSUS_COUNTDOWN_MS, VERSUS_ERR, VERSUS_MAX_PLAYERS, VERSUS_MIN_PLAYERS, VERSUS_NAME_MAX,
  type VersusConfig, type VersusPlayerView, type VersusRoomResponse, type VersusRoomView, type VersusRunResponse,
  type VersusSeatResponse, type VersusStage, type VersusStatus,
} from '../../shared/versus.js';
import { EngineError, badRequest, forbidden, notFound } from '../engine/errors.js';
import type { ContentRegistry, LoadedCase } from '../engine/registry.js';
import { makeRoomBinding, parseRoomBinding } from '../engine/room-binding.js';
import { hmacSha256, sha256 } from '../engine/sha256.js';
import { initialState, sanitizeState, snapshot, type GameState } from '../engine/state.js';
import { b64urlEncode, signToken, verifyToken } from '../engine/token.js';
import { cryptoRandom, newRoomCode, normalizeRoomCode, randomId, sanitizeName, type RandomBytes } from './code.js';
import type { RoomStore } from './store.js';

/** A room lives this long after its last write… */
export const ROOM_TTL_SEC = 3 * 60 * 60;
/** …and never longer than this after its creation. */
export const ROOM_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** lastSeen is written at most this often per player (polls read far more often than that). */
export const SEEN_WRITE_MS = 8_000;
/** A player counts as online when seen within this window. */
export const ONLINE_MS = 25_000;
/** A run token may be fetched this much before startAt (clock jitter between devices). */
export const RUN_EARLY_MS = 400;
/** Run tokens per player per race (re-issued after a lost token; counters carry over). */
export const MAX_RUN_ISSUES = 6;

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const STAGES: readonly VersusStage[] = ['investigation', 'inquest', 'solved'];
const SEAT = /^([A-Z0-9]{6})\.([0-9][a-z0-9]{5})\.([A-Za-z0-9_-]{22})$/;
const utf8 = new TextEncoder();

export const roomKey = (code: string) => `jd:vs:${code}`;
const conflict = (msg: string) => new EngineError('bad_request', msg, 409);
const gone = (msg: string) => new EngineError('bad_request', msg, 410);

interface Meta {
  v: 1;
  code: string;
  nonce: string;
  caseId: string;
  difficulty: Difficulty;
  createdAt: number;
  host: string;
}
interface PlayerRec {
  id: string;
  name: string;
  at: number;
  /** hash of the client's per-tab id (a retried join gets the same seat back) */
  c?: string;
}
interface GameRec {
  p: number;
  st: VersusStage;
  q: number;
  /** questions counted against the budget (a re-issued run token keeps them; absent in older records → q) */
  b?: number;
  /** server time of the write */
  at: number;
  /** issue time of the token it was derived from (older tokens never overwrite newer ones) */
  t: number;
}
interface Slot {
  slot: number;
  player: PlayerRec;
  game?: GameRec;
  seen: number;
  finish?: number;
  out?: number;
  left?: number;
  attempts: number;
  issues: number;
}
interface Room {
  meta: Meta;
  start?: number;
  win?: { id: string; at: number };
  closed?: number;
  slots: Slot[];
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const obj = (v: string | undefined): Record<string, unknown> | undefined => {
  if (!v) return undefined;
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined;
  } catch {
    return undefined;
  }
};

/** Store hash → room, tolerant of junk fields (a bad field is ignored, a bad meta = no room). */
export function parseRoom(h: Record<string, string> | null): Room | null {
  const m = obj(h?.meta);
  if (!h || !m) return null;
  if (m.v !== 1 || typeof m.code !== 'string' || typeof m.nonce !== 'string' || typeof m.caseId !== 'string' || typeof m.host !== 'string') return null;
  if (!DIFFICULTIES.includes(m.difficulty as Difficulty) || typeof m.createdAt !== 'number') return null;
  const meta = m as unknown as Meta;
  const slots: Slot[] = [];
  for (let i = 0; i < VERSUS_MAX_PLAYERS; i++) {
    const p = obj(h[`p:${i}`]);
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.at !== 'number') continue;
    const g = obj(h[`g:${i}`]);
    const game: GameRec | undefined =
      g && typeof g.p === 'number' && typeof g.q === 'number' && STAGES.includes(g.st as VersusStage) && typeof g.at === 'number'
        ? { p: g.p, st: g.st as VersusStage, q: g.q, ...(typeof g.b === 'number' ? { b: g.b } : {}), at: g.at, t: typeof g.t === 'number' ? g.t : 0 }
        : undefined;
    slots.push({
      slot: i,
      player: { id: p.id, name: p.name, at: p.at, c: typeof p.c === 'string' ? p.c : undefined },
      game,
      seen: num(h[`s:${i}`]) ?? p.at,
      finish: num(h[`f:${i}`]),
      out: num(h[`x:${i}`]),
      left: num(h[`l:${i}`]),
      attempts: num(h[`a:${i}`]) ?? 0,
      issues: num(h[`k:${i}`]) ?? 0,
    });
  }
  const w = obj(h.win);
  return {
    meta,
    start: num(h.start),
    win: w && typeof w.id === 'string' && typeof w.at === 'number' ? { id: w.id, at: w.at } : undefined,
    closed: num(h.closed),
    slots,
  };
}

/** What the room may know about a run: aggregate progress, never which findings. */
export function deriveProgress(c: Case, s: GameState): { p: number; st: VersusStage; q: number; b: number } {
  const st: VersusStage = s.solved ? 'solved' : s.cleared.length > 0 || s.debateMisses > 0 || s.verdictAttempts > 0 || s.grants > 0 ? 'inquest' : 'investigation';
  return { p: Math.round(snapshot(c, s).progress * 1000) / 1000, st, q: s.asked, b: s.spent };
}

/** "Name" taken → "Name2" (still within the length limit). */
function uniqueName(name: string, taken: string[]): string {
  const low = new Set(taken.map((t) => t.toLowerCase()));
  if (!low.has(name.toLowerCase())) return name;
  for (let n = 2; n <= VERSUS_MAX_PLAYERS + 1; n++) {
    const suffix = String(n);
    const base = [...name].slice(0, VERSUS_NAME_MAX - suffix.length).join('');
    const cand = `${base}${suffix}`;
    if (!low.has(cand.toLowerCase())) return cand;
  }
  return name;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export interface VersusServiceOptions {
  store: RoomStore;
  /** SESSION_SECRET (the same key signs progress tokens and seats, domain-separated). */
  secret: string;
  content: () => ContentRegistry | Promise<ContentRegistry>;
  dev?: boolean;
  clock?: () => number;
  random?: RandomBytes;
}

export class VersusService {
  private readonly clock: () => number;
  private readonly rand: RandomBytes;
  private readonly seatKey: Uint8Array;

  constructor(private readonly o: VersusServiceOptions) {
    this.clock = o.clock ?? Date.now;
    this.rand = o.random ?? cryptoRandom;
    this.seatKey = utf8.encode(`vs-seat|${o.secret}`);
  }

  get store(): RoomStore {
    return this.o.store;
  }

  config(): VersusConfig {
    return {
      enabled: true,
      minPlayers: VERSUS_MIN_PLAYERS,
      maxPlayers: VERSUS_MAX_PLAYERS,
      nameMax: VERSUS_NAME_MAX,
      countdownMs: VERSUS_COUNTDOWN_MS,
      ...(this.o.dev ? { store: this.o.store.kind } : {}),
    };
  }

  /* ---------------------------------------------------------------- helpers */

  private seatSig(code: string, nonce: string, pid: string): string {
    return b64urlEncode(hmacSha256(this.seatKey, utf8.encode(`${code}|${nonce}|${pid}`)).slice(0, 16));
  }

  private seat(meta: Meta, pid: string): string {
    return `${meta.code}.${pid}.${this.seatSig(meta.code, meta.nonce, pid)}`;
  }

  private binding(meta: Meta, pid: string): string {
    return makeRoomBinding(meta.code, meta.nonce, pid, meta.difficulty);
  }

  private cidHash(cid: string | undefined): string | undefined {
    if (!cid) return undefined;
    return Array.from(sha256(utf8.encode(`vs-cid|${cid}`)).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * `forRoom`: a new room's case. Never a prototype case (shared/proto.ts: the guests may not have
   * its switch), so it is looked up with no switches on. Existing rooms and verdicts look the case
   * up in the whole catalogue (a room never holds a prototype case).
   */
  private async caseFor(caseId: unknown, visible: boolean, forRoom = false): Promise<LoadedCase> {
    if (typeof caseId !== 'string' || !caseId || caseId.length > 80) throw badRequest('caseId is required');
    const reg = await this.o.content();
    const c = forRoom ? reg.get(caseId, visible, []) : reg.get(caseId, visible);
    if (!c) throw notFound(`unknown case: ${caseId}`);
    return c;
  }

  private async load(code: string): Promise<Room | null> {
    const room = parseRoom(await this.o.store.hgetall(roomKey(code)));
    if (!room || room.meta.code !== code) return null;
    if (this.clock() - room.meta.createdAt > ROOM_MAX_AGE_MS) return null;
    return room;
  }

  /** Seat → room + the player's slot. The signature is checked against the room's nonce. */
  private async auth(seat: unknown): Promise<{ room: Room; slot: Slot }> {
    const m = typeof seat === 'string' ? SEAT.exec(seat) : null;
    if (!m) throw forbidden(VERSUS_ERR.seat);
    const [, code, pid, sig] = m;
    const room = await this.load(code);
    if (!room) throw notFound(VERSUS_ERR.notFound);
    if (!safeEqual(this.seatSig(room.meta.code, room.meta.nonce, pid), sig)) throw forbidden(VERSUS_ERR.seat);
    const slot = room.slots.find((s) => s.player.id === pid);
    if (!slot) throw gone(VERSUS_ERR.left);
    return { room, slot };
  }

  view(room: Room, you: string, now = this.clock()): VersusRoomView {
    const { meta, start } = room;
    const started = start !== undefined;
    // Rank: the winner (first HSETNX) is 1st, the other solvers follow by solve time.
    const solvers = room.slots
      .filter((s) => s.finish !== undefined)
      .sort((a, b) => (a.player.id === room.win?.id ? -1 : b.player.id === room.win?.id ? 1 : (a.finish ?? 0) - (b.finish ?? 0)));
    const rank = new Map(solvers.map((s, i) => [s.slot, i + 1]));
    const players: VersusPlayerView[] = room.slots.map((s) => {
      const last = Math.max(s.seen, s.player.at, s.game?.at ?? 0);
      const p: VersusPlayerView = {
        id: s.player.id,
        name: s.player.name,
        host: s.player.id === meta.host,
        you: s.player.id === you,
        online: !s.left && now - last < ONLINE_MS,
        stage: !started ? 'lobby' : s.finish !== undefined ? 'solved' : (s.game?.st ?? 'investigation'),
        progress: !started ? 0 : s.finish !== undefined ? 1 : (s.game?.p ?? 0),
        asked: started ? (s.game?.q ?? 0) : 0,
      };
      if (s.finish !== undefined && start !== undefined) p.finishMs = Math.max(0, s.finish - start);
      const r = rank.get(s.slot);
      if (r) p.rank = r;
      if (s.out !== undefined) p.out = true;
      if (s.left !== undefined) p.left = true;
      return p;
    });
    const active = room.slots.filter((s) => s.left === undefined);
    const done = active.every((s) => s.finish !== undefined || s.out !== undefined);
    const status: VersusStatus =
      room.closed !== undefined ? 'closed' : !started ? 'lobby' : now < start ? 'countdown' : done ? 'finished' : 'playing';
    const view: VersusRoomView = {
      code: meta.code,
      caseId: meta.caseId,
      difficulty: meta.difficulty,
      status,
      now,
      you,
      players,
      minPlayers: VERSUS_MIN_PLAYERS,
      maxPlayers: VERSUS_MAX_PLAYERS,
    };
    if (start !== undefined) view.startAt = start;
    const w = room.win && room.slots.find((s) => s.player.id === room.win!.id);
    if (w && room.win && start !== undefined) view.winner = { id: w.player.id, name: w.player.name, ms: Math.max(0, room.win.at - start) };
    return view;
  }

  /* ---------------------------------------------------------------- lobby */

  async create(input: { caseId?: unknown; difficulty?: unknown; name?: unknown; cid?: string }, o: { admin?: boolean } = {}): Promise<VersusSeatResponse> {
    const name = sanitizeName(input.name);
    if (!name) throw badRequest(VERSUS_ERR.badName);
    if (!DIFFICULTIES.includes(input.difficulty as Difficulty)) throw badRequest('difficulty must be easy, normal or hard');
    const difficulty = input.difficulty as Difficulty;
    const c = await this.caseFor(input.caseId, !!(this.o.dev || o.admin), true);
    const now = this.clock();
    for (let i = 0; i < 6; i++) {
      const code = newRoomCode(this.rand);
      const pid = `0${randomId(5, this.rand)}`;
      const meta: Meta = { v: 1, code, nonce: randomId(10, this.rand), caseId: c.data.id, difficulty, createdAt: now, host: pid };
      if (!(await this.o.store.hsetnx(roomKey(code), 'meta', JSON.stringify(meta), ROOM_TTL_SEC))) continue; // code taken
      const player: PlayerRec = { id: pid, name, at: now, ...(input.cid ? { c: this.cidHash(input.cid) } : {}) };
      await this.o.store.hset(roomKey(code), { 'p:0': JSON.stringify(player), 's:0': String(now) }, ROOM_TTL_SEC);
      const room: Room = { meta, slots: [{ slot: 0, player, seen: now, attempts: 0, issues: 0 }] };
      return { seat: this.seat(meta, pid), room: this.view(room, pid, now) };
    }
    throw new EngineError('server', 'could not allocate a room code', 503, true);
  }

  async join(input: { code?: unknown; name?: unknown; cid?: string }): Promise<VersusSeatResponse> {
    const code = normalizeRoomCode(input.code);
    if (!code) throw badRequest(VERSUS_ERR.badCode);
    const name = sanitizeName(input.name);
    if (!name) throw badRequest(VERSUS_ERR.badName);
    const room = await this.load(code);
    if (!room) throw notFound(VERSUS_ERR.notFound);
    if (room.closed !== undefined) throw gone(VERSUS_ERR.closed);
    const now = this.clock();
    // The same browser tab joining again (a retry after a lost response) gets its seat back.
    const cid = this.cidHash(input.cid);
    const mine = cid ? room.slots.find((s) => s.player.c === cid && s.left === undefined) : undefined;
    if (mine) return { seat: this.seat(room.meta, mine.player.id), room: this.view(room, mine.player.id, now) };
    if (room.start !== undefined) throw conflict(VERSUS_ERR.started);
    if (room.slots.length >= VERSUS_MAX_PLAYERS) throw conflict(VERSUS_ERR.full);
    const unique = uniqueName(name, room.slots.map((s) => s.player.name));
    for (let i = 1; i < VERSUS_MAX_PLAYERS; i++) {
      if (room.slots.some((s) => s.slot === i)) continue;
      const pid = `${i}${randomId(5, this.rand)}`;
      const player: PlayerRec = { id: pid, name: unique, at: now, ...(cid ? { c: cid } : {}) };
      // HSETNX: two players racing for the same free slot — one gets it, the other tries the next.
      if (!(await this.o.store.hsetnx(roomKey(code), `p:${i}`, JSON.stringify(player), ROOM_TTL_SEC))) continue;
      const fresh = (await this.load(code)) ?? { ...room, slots: [...room.slots, { slot: i, player, seen: now, attempts: 0, issues: 0 }] };
      return { seat: this.seat(room.meta, pid), room: this.view(fresh, pid, now) };
    }
    throw conflict(VERSUS_ERR.full);
  }

  async start(seat: unknown): Promise<VersusRoomResponse> {
    const { room, slot } = await this.auth(seat);
    if (room.closed !== undefined) throw gone(VERSUS_ERR.closed);
    if (slot.player.id !== room.meta.host) throw forbidden(VERSUS_ERR.notHost);
    const now = this.clock();
    if (room.start === undefined) {
      if (room.slots.filter((s) => s.left === undefined).length < VERSUS_MIN_PLAYERS) throw conflict(VERSUS_ERR.tooFew);
      await this.o.store.hsetnx(roomKey(room.meta.code), 'start', String(now + VERSUS_COUNTDOWN_MS), ROOM_TTL_SEC);
    }
    const fresh = (await this.load(room.meta.code)) ?? room;
    return { room: this.view(fresh, slot.player.id, now) };
  }

  async state(seat: unknown): Promise<VersusRoomResponse> {
    const { room, slot } = await this.auth(seat);
    const now = this.clock();
    if (slot.left === undefined && room.closed === undefined && now - slot.seen >= SEEN_WRITE_MS) {
      await this.o.store.hset(roomKey(room.meta.code), { [`s:${slot.slot}`]: String(now) }, ROOM_TTL_SEC);
      slot.seen = now;
    }
    return { room: this.view(room, slot.player.id, now) };
  }

  async leave(seat: unknown): Promise<{ ok: true }> {
    let found: { room: Room; slot: Slot };
    try {
      found = await this.auth(seat);
    } catch (e) {
      // already gone (expired room, freed slot): leaving is done
      if (e instanceof EngineError && (e.status === 404 || e.status === 410)) return { ok: true };
      throw e;
    }
    const { room, slot } = found;
    const key = roomKey(room.meta.code);
    const now = String(this.clock());
    if (room.start === undefined) {
      if (slot.player.id === room.meta.host) await this.o.store.hset(key, { closed: now }, ROOM_TTL_SEC);
      else await this.o.store.hdel(key, [`p:${slot.slot}`, `g:${slot.slot}`, `s:${slot.slot}`], ROOM_TTL_SEC);
    } else if (slot.left === undefined) {
      await this.o.store.hsetnx(key, `l:${slot.slot}`, now, ROOM_TTL_SEC);
    }
    return { ok: true };
  }

  /* ---------------------------------------------------------------- race */

  /** A fresh progress token for the room's case, bound to this room and player. */
  async run(seat: unknown): Promise<VersusRunResponse> {
    const { room, slot } = await this.auth(seat);
    const now = this.clock();
    if (room.closed !== undefined) throw gone(VERSUS_ERR.closed);
    if (room.start === undefined || now < room.start - RUN_EARLY_MS) throw conflict(VERSUS_ERR.notStarted);
    if (slot.left !== undefined) throw gone(VERSUS_ERR.left);
    if (slot.out !== undefined) throw forbidden(VERSUS_ERR.out);
    if (slot.issues >= MAX_RUN_ISSUES) throw new EngineError('rate_limited', VERSUS_ERR.issues, 429, false);
    const issues = await this.o.store.hincrby(roomKey(room.meta.code), `k:${slot.slot}`, 1, ROOM_TTL_SEC);
    if (issues > MAX_RUN_ISSUES) throw new EngineError('rate_limited', VERSUS_ERR.issues, 429, false);
    const c = await this.caseFor(room.meta.caseId, true);
    // A re-issued token (the first one was lost) keeps the counters the room already knows.
    const s: GameState = {
      ...initialState(c.data, now),
      room: this.binding(room.meta, slot.player.id),
      asked: slot.game?.q ?? 0,
      // the question budget already used is kept too (教授 rooms enforce it on the server)
      spent: Math.min(slot.game?.q ?? 0, slot.game?.b ?? slot.game?.q ?? 0),
      verdictAttempts: slot.attempts,
    };
    const token = await signToken(s, this.o.secret, now);
    return { token, progress: snapshot(c.data, s), room: this.view(room, slot.player.id, now) };
  }

  /** The player's latest token → derived progress; a solved bound token finishes the race. */
  async progress(seat: unknown, token: unknown): Promise<VersusRoomResponse> {
    const { room, slot } = await this.auth(seat);
    if (room.start === undefined) throw conflict(VERSUS_ERR.notStarted);
    if (slot.left !== undefined) throw gone(VERSUS_ERR.left);
    const c = await this.caseFor(room.meta.caseId, true);
    const now = this.clock();
    const s = sanitizeState(c.data, await verifyToken(token, this.o.secret, c.data.id, now));
    if (s.room !== this.binding(room.meta, slot.player.id)) throw forbidden(VERSUS_ERR.binding);
    await this.record(room, slot, c.data, s, now);
    const fresh = (await this.load(room.meta.code)) ?? room;
    return { room: this.view(fresh, slot.player.id, now) };
  }

  /**
   * After a verdict (HTTP layer, best effort): `before` / `after` are the request's and the
   * response's tokens. Counts a judged attempt of a bound run on the server, then records the
   * progress — the race is decided here, not by whatever the client reports later.
   */
  async observeVerdict(caseId: unknown, before: unknown, after: ProgressToken): Promise<void> {
    const c = await this.caseFor(caseId, true);
    const now = this.clock();
    let sa: GameState;
    try {
      sa = await verifyToken(after, this.o.secret, c.data.id, now);
    } catch {
      return;
    }
    const b = parseRoomBinding(sa.room);
    if (!b) return;
    const room = await this.load(b.code);
    if (!room || room.meta.nonce !== b.nonce || room.start === undefined) return;
    const slot = room.slots.find((s) => s.player.id === b.playerId);
    if (!slot || slot.left !== undefined || sa.room !== this.binding(room.meta, slot.player.id)) return;
    let sb: GameState | undefined;
    try {
      sb = await verifyToken(before, this.o.secret, c.data.id, now);
    } catch {
      sb = undefined;
    }
    if (sb && sa.verdictAttempts > sb.verdictAttempts) {
      slot.attempts = await this.o.store.hincrby(roomKey(room.meta.code), `a:${slot.slot}`, 1, ROOM_TTL_SEC);
    }
    await this.record(room, slot, c.data, sanitizeState(c.data, sa), now);
  }

  private async record(room: Room, slot: Slot, c: Case, s: GameState, now: number): Promise<void> {
    const key = roomKey(room.meta.code);
    const i = slot.slot;
    // A late submission of an older token must not move the bar backwards.
    if (!slot.game || s.issuedAt >= slot.game.t) {
      const g: GameRec = { ...deriveProgress(c, s), at: now, t: s.issuedAt };
      await this.o.store.hset(key, { [`g:${i}`]: JSON.stringify(g), [`s:${i}`]: String(now) }, ROOM_TTL_SEC);
    }
    if (slot.out !== undefined || slot.finish !== undefined) return;
    const lives = LIVES_BY_DIFFICULTY[room.meta.difficulty] ?? 3;
    const attempts = Math.max(slot.attempts, s.verdictAttempts);
    if (s.solved && attempts <= lives) {
      // First solve wins: HSETNX is atomic in Redis (and in the single-threaded memory store).
      await this.o.store.hsetnx(key, 'win', JSON.stringify({ id: slot.player.id, at: now }), ROOM_TTL_SEC);
      await this.o.store.hsetnx(key, `f:${i}`, String(now), ROOM_TTL_SEC);
    } else if (attempts >= lives) {
      // the lights ran out (or a solve arrived after they had): 脱落
      await this.o.store.hsetnx(key, `x:${i}`, String(now), ROOM_TTL_SEC);
    }
  }

  /**
   * DEV ONLY (server/http/versus-routes.ts refuses it outside the dev server): binds a token
   * minted by /api/admin/mint-token to the seat's run, so QA can jump to a stage of a race.
   */
  async devBind(seat: unknown, token: unknown): Promise<{ token: ProgressToken; progress: ProgressSnapshot }> {
    if (!this.o.dev) throw notFound('not found');
    const { room, slot } = await this.auth(seat);
    const c = await this.caseFor(room.meta.caseId, true);
    const now = this.clock();
    const s = { ...sanitizeState(c.data, await verifyToken(token, this.o.secret, c.data.id, now)), room: this.binding(room.meta, slot.player.id) };
    return { token: await signToken(s, this.o.secret, now), progress: snapshot(c.data, s) };
  }
}
