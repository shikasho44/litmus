/**
 * Online versus — the client side of a room (docs/versus.md).
 *
 *   vsSession  this tab's seat in a room (sessionStorage: a reload rejoins, another tab does not)
 *   vsRoom     the latest room view from the server (poll ~2 s while visible, 1 s in the lobby,
 *              8 s while hidden; every call's `now` corrects the clock for the countdown)
 *   beginRun   at the synchronized start: fetch the room-bound run token, put the race in the
 *              save slot (slot.ts) and open the investigation (the intro is skipped: everyone
 *              starts asking at the same moment)
 *   progress   the race copy's token is sent after every change (a solve at once), the server
 *              derives the progress from it; the verdict itself is also seen by the server
 *   announce   the first solve: a cut-in for everyone, 「勝利！」 for the winner
 *
 * Init once (initVersus) — by the Versus scene, the title, or boot when a session exists.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import type { Difficulty } from '../../../shared/api';
import type { VersusRoomView } from '../../../shared/versus';
import { sceneForStage } from '../../app/flow';
import { CASE_SCENES, goto, route, transitioning } from '../../app/router';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { addFacts, freshCase, saveData } from '../../state/save';
import type { CaseRunMode } from '../../state/runMode';
import type { CaseProgress } from '../../state/types';
import { toast } from '../../ui/Toast';
import { loadCasePublic } from '../investigation/caseData';
import { errorText, isSessionGone, VersusError, vsApi } from './client';
import { dropSlot, enterSlot, readMirror, slotCase, suspendSlot } from './slot';

const SESSION_KEY = 'janedoe:vs:session';
const CID_KEY = 'janedoe:vs:cid';
const NAME_KEY = 'janedoe:vs:name';
const HIDE_KEY = 'janedoe:vs:hide';

export interface VsSession {
  code: string;
  seat: string;
  you: string;
  caseId: string;
  difficulty: Difficulty;
  /** this tab's run token was fetched (the race copy exists) */
  running?: boolean;
  /** announcements already played (a reload must not replay them) */
  seenWin?: string;
  seenOut?: boolean;
}

/* ------------------------------------------------------------------ storage */
function readSession(): VsSession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as VsSession | null;
    return s && typeof s.seat === 'string' && typeof s.code === 'string' && typeof s.caseId === 'string' ? s : null;
  } catch {
    return null;
  }
}
function writeSession(s: VsSession | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* the session then lasts until a reload */
  }
}

/** Per-tab random id: a join retried after a lost response gets the same seat back. */
export function tabId(): string {
  try {
    let id = sessionStorage.getItem(CID_KEY);
    if (!id) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(CID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Per-viewer conveniences (localStorage): the last name used, the streamer code mask. */
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
export const hideCode = signal<boolean>(
  (() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  })(),
);
export function setHideCode(v: boolean) {
  hideCode.value = v;
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ state */
export const vsSession = signal<VsSession | null>(readSession());
export const vsRoom = signal<VersusRoomView | null>(null);
/** 'retrying' after a failed poll (the HUD shows a small mark). */
export const vsConn = signal<'ok' | 'retrying'>('ok');
/** Why the last session ended (shown once on the versus screen). */
export const vsEnded = signal<string | null>(null);
export const vsMe = computed(() => vsRoom.value?.players.find((p) => p.you) ?? null);

/** Server clock offset (server − client, ms), from the lowest-latency sample seen. */
let offset = 0;
let bestRtt = Infinity;
export const serverNow = () => Date.now() + offset;
/** Re-renders ticking clocks. */
export const clockTick = signal(0);

function patchSession(p: Partial<VsSession>) {
  const s = vsSession.peek();
  if (!s) return;
  const next = { ...s, ...p };
  vsSession.value = next;
  writeSession(next);
}

function applyRoom(room: VersusRoomView, sentAt: number, recvAt: number) {
  const rtt = recvAt - sentAt;
  if (rtt <= bestRtt + 40) {
    bestRtt = Math.min(bestRtt, rtt);
    offset = room.now - (sentAt + recvAt) / 2;
  }
  vsRoom.value = room;
  vsConn.value = 'ok';
  const s = vsSession.peek();
  if (!s) return;
  if (room.status === 'closed') {
    endSession('ホストが部屋を閉じました。');
    return;
  }
  if (room.winner && s.seenWin !== room.winner.id) {
    patchSession({ seenWin: room.winner.id });
    announceWinner(room);
  }
  const me = room.players.find((p) => p.you);
  if (me?.out && !s.seenOut) {
    patchSession({ seenOut: true });
    // the game-over screen says it when it happens in the inquest; elsewhere a toast does
    if (route.peek().scene !== 'inquest') toast('脱落しました。ここからは観戦です。', { tone: 'warn', duration: 5000 });
  }
}

async function timed<T extends { room: VersusRoomView }>(p: () => Promise<T>): Promise<T> {
  const sentAt = Date.now();
  const r = await p();
  applyRoom(r.room, sentAt, Date.now());
  return r;
}

/* ------------------------------------------------------------------ polling */
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let polling = false;

function interval(): number {
  if (failures > 0) return Math.min(10_000, 1000 * 2 ** failures);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 8000;
  const st = vsRoom.peek()?.status;
  if (!st || st === 'lobby' || st === 'countdown') return 1000;
  if (st === 'finished') return 5000;
  return 2000;
}

function schedulePoll(ms = interval()) {
  clearTimeout(pollTimer);
  if (!vsSession.peek()) return;
  pollTimer = setTimeout(() => void pollOnce(), ms);
}

export async function pollOnce(): Promise<void> {
  const s = vsSession.peek();
  if (!s || polling) return;
  polling = true;
  try {
    await timed(() => vsApi.state(s.seat));
    failures = 0;
  } catch (e) {
    if (isSessionGone(e)) {
      endSession(e instanceof VersusError && e.status === 404 ? '部屋が見つかりません（約3時間で消えます）。' : errorText(e));
      return;
    }
    failures = Math.min(failures + 1, 4);
    vsConn.value = 'retrying';
  } finally {
    polling = false;
    schedulePoll();
  }
}

/* ------------------------------------------------------------------ lobby actions */
export async function createRoom(caseId: string, difficulty: Difficulty, name: string): Promise<void> {
  const r = await vsApi.create({ caseId, difficulty, name, cid: tabId() || undefined });
  startSession({ code: r.room.code, seat: r.seat, you: r.room.you, caseId: r.room.caseId, difficulty: r.room.difficulty }, r.room);
  rememberName(name);
}

export async function joinRoom(code: string, name: string): Promise<void> {
  const r = await vsApi.join({ code, name, cid: tabId() || undefined });
  startSession({ code: r.room.code, seat: r.seat, you: r.room.you, caseId: r.room.caseId, difficulty: r.room.difficulty }, r.room);
  rememberName(name);
}

function startSession(s: VsSession, room: VersusRoomView) {
  dropAfterLeaving = false;
  dropSlot();
  batch(() => {
    vsEnded.value = null;
    vsSession.value = s;
    vsRoom.value = room;
  });
  writeSession(s);
  bestRtt = Infinity;
  void loadCasePublic(s.caseId).catch(() => undefined); // the race opens instantly at the start
  schedulePoll(800);
}

export async function startRace(): Promise<void> {
  const s = vsSession.peek();
  if (!s) return;
  await timed(() => vsApi.start(s.seat));
  schedulePoll(500);
}

/** Leave the room (after the start the row stays as 退出) and forget the race in this tab. */
export async function leaveRoom(): Promise<void> {
  const s = vsSession.peek();
  if (s) await vsApi.leave(s.seat).catch(() => undefined);
  endSession(null);
}

/** The race copy is dropped once the case scene showing it has unmounted (see initVersus). */
let dropAfterLeaving = false;

function endSession(reason: string | null) {
  clearTimeout(pollTimer);
  const wasInRace = !!slotCase.peek();
  const r = route.peek();
  const inRaceScene = wasInRace && CASE_SCENES.includes(r.scene);
  // Inside a race scene the copy must stay until that scene is gone: its unmount still writes
  // (play time), and that must land in the race copy, not in the player's own run.
  if (inRaceScene) dropAfterLeaving = true;
  else dropSlot();
  writeSession(null);
  batch(() => {
    vsSession.value = null;
    vsRoom.value = null;
    vsEnded.value = reason;
  });
  lastSubmitted = '';
  if (reason && wasInRace) toast(reason, { tone: 'warn', duration: 5000 });
  // a player inside a race case scene has nothing left to play there
  if (inRaceScene) goto('versus', {}, { replace: true });
}

/* ------------------------------------------------------------------ the race */
function runMode(s: VsSession): CaseRunMode {
  return {
    caseId: s.caseId,
    lockDifficulty: true,
    newToken: async () => {
      const r = await timed(() => vsApi.run(s.seat));
      return { token: r.token, progress: r.progress };
    },
    gameOver: {
      text: 'この対戦は、ここで脱落です。ほかの審問官がどこまで迫るか、見届けましょう。',
      action: '観戦する',
      en: 'SPECTATE',
      onExit: () => {
        audio.sfx('cancel');
        goto('versus', {}, { replace: true });
      },
    },
    release: () => suspendSlot(),
  };
}

/** The race copy of this tab (null before the start). */
export function raceProgress(): CaseProgress | null {
  const s = vsSession.peek();
  if (!s) return null;
  if (slotCase.peek() === s.caseId) return saveData.peek().cases[s.caseId] ?? null;
  return readMirror(s.code, s.you);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The synchronized start: the room-bound run token (retried while the server still counts
 * down), the race in the slot, then the investigation. Returns false if it could not start.
 */
export async function beginRun(): Promise<boolean> {
  const s = vsSession.peek();
  if (!s) return false;
  if (s.running) return resumeRun();
  let run: Awaited<ReturnType<typeof vsApi.run>> | undefined;
  for (let i = 0; i < 6 && !run; i++) {
    try {
      run = await timed(() => vsApi.run(s.seat));
    } catch (e) {
      if (e instanceof VersusError && e.status === 409) {
        const startAt = vsRoom.peek()?.startAt ?? serverNow() + 500;
        await sleep(Math.max(150, startAt - serverNow() + 120));
        continue;
      }
      toast(errorText(e), { tone: 'warn' });
      if (isSessionGone(e)) endSession(errorText(e));
      return false;
    }
  }
  if (!run || vsSession.peek()?.seat !== s.seat) return false;
  const progress: CaseProgress = { ...freshCase(s.caseId), stage: 'investigation', difficulty: s.difficulty, token: run.token, snapshot: run.progress };
  enterSlot(s.caseId, progress, runMode(s), { code: s.code, you: s.you });
  patchSession({ running: true });
  const pub = await loadCasePublic(s.caseId).catch(() => undefined);
  if (pub && slotCase.peek() === s.caseId) addFacts(s.caseId, pub.startingFacts);
  goto('investigation', { caseId: s.caseId }, { replace: true });
  return true;
}

/** Back into the race (from the versus screen, the title, or a reload): the slot, then the scene. */
export function resumeRun(navigate = true): boolean {
  const s = vsSession.peek();
  if (!s?.running) return false;
  const run = raceProgress();
  if (!run) return false;
  if (slotCase.peek() !== s.caseId) enterSlot(s.caseId, run, runMode(s), { code: s.code, you: s.you });
  if (navigate) goto(sceneForStage(run.stage === 'complete' ? 'result' : run.stage), { caseId: s.caseId });
  return true;
}

/* ------------------------------------------------------------------ progress submission */
let lastSubmitted = '';
let submitTimer: ReturnType<typeof setTimeout> | undefined;
let submitting = false;

async function submitNow(): Promise<void> {
  clearTimeout(submitTimer);
  const s = vsSession.peek();
  const id = slotCase.peek();
  if (!s || id !== s.caseId || submitting) return;
  const token = saveData.peek().cases[id]?.token;
  if (!token || token === lastSubmitted) return;
  submitting = true;
  try {
    await timed(() => vsApi.progress(s.seat, token));
    lastSubmitted = token;
  } catch (e) {
    if (isSessionGone(e)) endSession(errorText(e));
    else if (!(e instanceof VersusError) || e.code === 'network' || e.code === 'timeout' || e.code === 'server' || e.code === 'rate_limited') {
      submitTimer = setTimeout(() => void submitNow(), 3000);
    } else lastSubmitted = token; // refused (e.g. not bound): do not hammer the server with it
  } finally {
    submitting = false;
  }
  // a newer token arrived meanwhile
  const again = saveData.peek().cases[id]?.token;
  if (again && again !== lastSubmitted && vsSession.peek()) submitTimer = setTimeout(() => void submitNow(), 1200);
}

/* ------------------------------------------------------------------ announcements */
function announceWinner(room: VersusRoomView) {
  const w = room.winner!;
  const mine = w.id === room.you;
  const inCase = CASE_SCENES.includes(route.peek().scene);
  // the winner's own verdict staging plays first
  setTimeout(
    () => {
      audio.sfx('gavel');
      fx.flash(mine ? '#C6FF3D' : '#FF2E63', { opacity: 0.3, duration: 0.5 });
      void fx.cutIn(
        mine
          ? { lead: 'あなたが先に真相にたどり着いた！', text: '勝利！', en: 'VICTORY — FIRST TO THE TRUTH', tone: 'formalin', character: 'holma', mood: 'laugh', hold: 1.8 }
          : { text: `${w.name}が先に真相にたどり着いた！`, en: 'THE TRUTH HAS BEEN CLAIMED', tone: 'alarm', character: 'holma', mood: 'surprised', hold: 1.8 },
      );
    },
    mine && inCase ? 1400 : 250,
  );
}

/* ------------------------------------------------------------------ init */
let inited = false;

/** Idempotent. Wires the poller, the progress watcher, the slot guard; mounts the HUD. */
export function initVersus(mountHud?: () => void) {
  if (inited) return;
  inited = true;
  mountHud?.();
  // progress: every new token of the race copy goes to the room (a solve at once)
  effect(() => {
    const s = vsSession.value;
    const id = slotCase.value;
    if (!s || id !== s.caseId) return;
    const c = saveData.value.cases[id];
    if (!c?.token || c.token === lastSubmitted) return;
    clearTimeout(submitTimer);
    submitTimer = setTimeout(() => void submitNow(), c.snapshot?.solved ? 0 : 1500);
  });
  // the race copy leaves memory when the player leaves the race's scenes
  transitioning.subscribe((t) => {
    if (t) return;
    const id = slotCase.peek();
    if (!id) return;
    const r = route.peek();
    if (dropAfterLeaving && !CASE_SCENES.includes(r.scene)) {
      dropAfterLeaving = false;
      dropSlot();
      return;
    }
    if (r.scene === 'versus') return;
    if (!CASE_SCENES.includes(r.scene) || r.params.caseId !== id) suspendSlot();
  });
  // a visible tab polls at once
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && vsSession.peek()) schedulePoll(0);
  });
  setInterval(() => {
    if (vsSession.peek()) clockTick.value++;
  }, 250);
  if (vsSession.peek()) schedulePoll(0);
}
