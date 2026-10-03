/**
 * Save store: one versioned blob in localStorage (APP_CONFIG.SAVE_KEY).
 *
 * - `saveData` is a signal holding the whole immutable SaveData. Never mutate it in place;
 *   use the helpers below (they replace objects so signals/computeds update).
 * - Autosave: debounced 600 ms after any change + synchronous flush on pagehide /
 *   visibilitychange(hidden). Every storage access is wrapped in try/catch; if storage is
 *   unavailable the game keeps working in memory and `storageOk` becomes false.
 * - Migration: `migrate()` upgrades older blobs step by step (add a case per version bump).
 */
import { batch, computed, effect, signal } from '@preact/signals';
import { APP_CONFIG } from '../config/app';
import { caseHiddenByProto } from '../config/proto';
import { resultPoints } from '../features/rank/points';
import { sanitizeExamples } from '../features/examples/examples';
import { runModeOf } from './runMode';
import type { Difficulty, ProgressSnapshot, ProgressToken, PublicFact, ScienceMemoView } from '../../shared/api';
import { prefersReducedMotion, START_MUTED } from '../lib/env';
import {
  SAVE_VERSION,
  type CaseProgress,
  type CaseResult,
  type CaseStage,
  type CaseStatus,
  type FirstClear,
  type InquestState,
  type LogEntry,
  type Rank,
  type SaveData,
  type Settings,
  type TutorialState,
} from './types';

export const DEFAULT_SETTINGS: Settings = {
  bgmVolume: 0.6,
  sfxVolume: 0.8,
  voiceBlips: true,
  muted: false,
  textSpeed: 'normal',
  fontScale: 100,
  reduceMotion: false,
  pipelineMode: null,
};

function freshSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion(), muted: START_MUTED },
    meta: { prologueSeen: false, firstLaunchAt: Date.now(), launches: 0 },
    cases: {},
  };
}

export function freshCase(caseId: string): CaseProgress {
  const now = Date.now();
  return {
    caseId,
    stage: 'new',
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    log: [],
    facts: {},
    factOrder: [],
    seenFacts: [],
    memos: {},
    hints: [],
    notes: '',
    completed: false,
    clears: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Load / migrate / sanitize                                           */
/* ------------------------------------------------------------------ */
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const oneOf = <T extends string | number>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Upgrade older save blobs. Add `if (v === N) { ...; v = N + 1 }` steps when the shape changes. */
function migrate(raw: Record<string, any>): Record<string, any> {
  let v = typeof raw.version === 'number' ? raw.version : 0;
  if (v < 1) {
    // pre-release blobs had no version; keep settings/cases if they look right
    raw = { settings: raw.settings, meta: raw.meta, cases: raw.cases };
    v = 1;
  }
  raw.version = v;
  return raw;
}

function sanitizeSettings(s: unknown): Settings {
  const d = { ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion() };
  if (!isObj(s)) return d;
  return {
    bgmVolume: num(s.bgmVolume, d.bgmVolume, 0, 1),
    sfxVolume: num(s.sfxVolume, d.sfxVolume, 0, 1),
    voiceBlips: bool(s.voiceBlips, d.voiceBlips),
    muted: bool(s.muted, d.muted) || START_MUTED,
    textSpeed: oneOf(s.textSpeed, ['slow', 'normal', 'fast', 'instant'] as const, d.textSpeed),
    fontScale: oneOf(s.fontScale, [100, 115, 130] as const, d.fontScale),
    reduceMotion: bool(s.reduceMotion, d.reduceMotion),
    pipelineMode: PIPELINE_MODES.includes(s.pipelineMode) ? s.pipelineMode : null,
  };
}

const PIPELINE_MODES: readonly unknown[] = ['rules', 'jev', 'jev+llm', 'jev+llm+check', 'llm'];
const STAGES: readonly CaseStage[] = ['new', 'intro', 'investigation', 'inquest', 'resolution', 'science', 'quiz', 'result', 'complete'];
const RANKS: readonly Rank[] = ['S+', 'S', 'A', 'B', 'C'];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
/** The recommended difficulty (審問官) — also what a save without a choice plays on. */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

function sanitizeCase(id: string, c: unknown): CaseProgress | null {
  if (!isObj(c)) return null;
  const base = freshCase(id);
  const completed = bool(c.completed, false);
  const gameOvers = num(c.gameOvers, 0, 0);
  const lastResult = isObj(c.lastResult) ? (c.lastResult as CaseResult) : undefined;
  return {
    ...base,
    ...c,
    caseId: id,
    stage: oneOf(c.stage, STAGES, 'new'),
    difficulty: DIFFICULTIES.includes(c.difficulty) ? c.difficulty : undefined,
    gameOvers,
    // A save from before 2026-09-27 has no mark: a completed case's game overs all predate its clear.
    gameOversAtClear: typeof c.gameOversAtClear === 'number' || completed ? num(c.gameOversAtClear, gameOvers, 0, gameOvers) : undefined,
    startedAt: num(c.startedAt, base.startedAt),
    updatedAt: num(c.updatedAt, base.updatedAt),
    elapsedMs: num(c.elapsedMs, 0, 0),
    token: typeof c.token === 'string' ? c.token : undefined,
    snapshot: isObj(c.snapshot) ? (c.snapshot as ProgressSnapshot) : undefined,
    log: Array.isArray(c.log) ? (c.log.filter((e: unknown) => isObj(e) && typeof e.kind === 'string') as LogEntry[]).slice(-600) : [],
    facts: isObj(c.facts) ? (c.facts as Record<string, PublicFact>) : {},
    factOrder: Array.isArray(c.factOrder) ? c.factOrder.filter((x: unknown) => typeof x === 'string') : [],
    seenFacts: Array.isArray(c.seenFacts) ? c.seenFacts.filter((x: unknown) => typeof x === 'string') : [],
    memos: isObj(c.memos) ? (c.memos as Record<string, ScienceMemoView>) : {},
    hints: Array.isArray(c.hints) ? c.hints.filter((h: unknown) => isObj(h) && typeof h.text === 'string') : [],
    notes: str(c.notes),
    inquest: isObj(c.inquest) ? (c.inquest as InquestState) : undefined,
    completed,
    clears: num(c.clears, 0, 0),
    bestRank: RANKS.includes(c.bestRank) ? c.bestRank : undefined,
    bestPoints: sanitizeBestPoints(c.bestPoints, completed ? lastResult : undefined),
    lastResult,
    restored:
      isObj(c.restored) && typeof c.restored.name === 'string' && c.restored.name
        ? { name: c.restored.name.slice(0, 40), kana: str(c.restored.kana).slice(0, 60) }
        : undefined,
    examples: sanitizeExamples(c.examples),
    clearMs: typeof c.clearMs === 'number' && Number.isFinite(c.clearMs) ? Math.max(0, c.clearMs) : undefined,
    firstClear: sanitizeFirstClear(c.firstClear),
    ownWords: c.ownWords === true ? true : undefined,
  };
}

/** A stored first-clear record, or undefined (never invented for older saves). */
function sanitizeFirstClear(v: unknown): FirstClear | undefined {
  if (!isObj(v) || !RANKS.includes(v.rank) || !DIFFICULTIES.includes(v.difficulty)) return undefined;
  if (typeof v.clearMs !== 'number' || !Number.isFinite(v.clearMs) || v.clearMs < 0) return undefined;
  return {
    at: num(v.at, 0, 0),
    difficulty: v.difficulty,
    clearMs: v.clearMs,
    spent: num(v.spent, 0, 0),
    ...(typeof v.budget === 'number' && Number.isFinite(v.budget) ? { budget: v.budget } : {}),
    rank: v.rank,
  };
}

/**
 * A number ≥ 0 (rounded). A completed case saved before 2026-09-27 has none: its last run's
 * 獲得度数 stands in (the best run itself was not kept).
 */
function sanitizeBestPoints(v: unknown, legacy: CaseResult | undefined): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (legacy && RANKS.includes(legacy.rank)) return resultPoints(legacy).total;
  return undefined;
}

/** Exported for tests. */
export function sanitize(raw: unknown): SaveData {
  const fresh = freshSave();
  if (!isObj(raw)) return fresh;
  const m = migrate(raw);
  const cases: Record<string, CaseProgress> = {};
  if (isObj(m.cases)) {
    for (const [id, c] of Object.entries(m.cases)) {
      const s = sanitizeCase(id, c);
      if (s) cases[id] = s;
    }
  }
  const meta = isObj(m.meta) ? m.meta : {};
  const tut = isObj(meta.tutorial) ? meta.tutorial : null;
  const tutorial: TutorialState | undefined = tut
    ? { state: oneOf(tut.state, ['off', 'on', 'done'] as const, 'off'), step: num(tut.step, 0, 0, 99), ...(tut.anyCase === true ? { anyCase: true } : {}) }
    : undefined;
  return {
    version: SAVE_VERSION,
    settings: sanitizeSettings(m.settings),
    meta: {
      prologueSeen: bool(meta.prologueSeen, false),
      ...(tutorial ? { tutorial } : {}),
      firstLaunchAt: num(meta.firstLaunchAt, fresh.meta.firstLaunchAt),
      lastCaseId: typeof meta.lastCaseId === 'string' ? meta.lastCaseId : undefined,
      launches: num(meta.launches, 0, 0),
    },
    cases,
  };
}

/** false when localStorage is unavailable (private mode, quota, blocked cookies). */
export const storageOk = signal(true);

function readStorage(): SaveData {
  try {
    const txt = localStorage.getItem(APP_CONFIG.SAVE_KEY);
    if (!txt) return freshSave();
    return sanitize(JSON.parse(txt));
  } catch {
    storageOk.value = false;
    return freshSave();
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
export const saveData = signal<SaveData>(freshSave());
export const settings = computed(() => saveData.value.settings);

let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let initialised = false;
/** What is written to storage instead of the in-memory save (see setPersistFilter). */
let persistFilter: ((d: SaveData) => SaveData) | null = null;

/**
 * While a run that must not touch the stored save is in memory (online versus keeps its race
 * in `cases[caseId]`: src/features/versus/slot.ts), storage gets `filter(save)` instead — the
 * player's own progress for that case, untouched. null restores normal saving.
 */
export function setPersistFilter(filter: ((d: SaveData) => SaveData) | null) {
  persistFilter = filter;
  scheduleSave();
}

export function flushSave() {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!dirty) return;
  dirty = false;
  try {
    const d = saveData.peek();
    localStorage.setItem(APP_CONFIG.SAVE_KEY, JSON.stringify(persistFilter ? persistFilter(d) : d));
    if (!storageOk.peek()) storageOk.value = true;
  } catch {
    storageOk.value = false;
  }
}

function scheduleSave() {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSave, 600);
}

/** Load from storage and start autosave. Call once at boot. */
export function initSave() {
  if (initialised) return;
  initialised = true;
  const loaded = readStorage();
  loaded.meta = { ...loaded.meta, launches: loaded.meta.launches + 1 };
  saveData.value = loaded;
  let first = true;
  effect(() => {
    void saveData.value;
    if (first) {
      first = false;
      return;
    }
    scheduleSave();
  });
  dirty = true;
  flushSave();
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

/* ------------------------------------------------------------------ */
/* Mutators                                                            */
/* ------------------------------------------------------------------ */
export function updateSettings(patch: Partial<Settings>) {
  const s = saveData.value;
  saveData.value = { ...s, settings: { ...s.settings, ...patch } };
}

export function updateMeta(patch: Partial<SaveData['meta']>) {
  const s = saveData.value;
  saveData.value = { ...s, meta: { ...s.meta, ...patch } };
}

export function getCaseProgress(caseId: string): CaseProgress | undefined {
  return saveData.value.cases[caseId];
}

/**
 * Update one case. `patch` may be a partial object or a function returning the next value.
 * Creates the case entry if missing. Always bumps updatedAt.
 */
export function updateCase(caseId: string, patch: Partial<CaseProgress> | ((c: CaseProgress) => CaseProgress)) {
  const s = saveData.value;
  const cur = s.cases[caseId] ?? freshCase(caseId);
  const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
  saveData.value = { ...s, cases: { ...s.cases, [caseId]: { ...next, updatedAt: Date.now() } } };
}

let logSeq = 0;
export const newLogId = () => `${Date.now().toString(36)}-${(logSeq++).toString(36)}`;

/** Append chat-log entries (ids/timestamps filled in if missing). Log is capped at 600. */
export function appendLog(caseId: string, entries: (Omit<LogEntry, 'id' | 'at'> & { id?: string; at?: number })[]) {
  updateCase(caseId, (c) => ({
    ...c,
    log: [...c.log, ...entries.map((e) => ({ ...e, id: e.id ?? newLogId(), at: e.at ?? Date.now() }) as LogEntry)].slice(-600),
  }));
}

export function addFacts(caseId: string, facts: PublicFact[]) {
  if (!facts.length) return;
  updateCase(caseId, (c) => {
    const f = { ...c.facts };
    const order = c.factOrder.slice();
    for (const fact of facts) {
      if (!f[fact.id]) order.push(fact.id);
      f[fact.id] = fact;
    }
    return { ...c, facts: f, factOrder: order };
  });
}

export function addMemos(caseId: string, memos: ScienceMemoView[]) {
  if (!memos.length) return;
  updateCase(caseId, (c) => {
    const m = { ...c.memos };
    for (const memo of memos) m[memo.id] = memo;
    return { ...c, memos: m };
  });
}

export function addHint(caseId: string, level: number, text: string) {
  updateCase(caseId, (c) => ({ ...c, hints: [...c.hints.filter((h) => h.level !== level), { level, text }].sort((a, b) => a.level - b.level) }));
}

export function setToken(caseId: string, token: ProgressToken, snapshot?: ProgressSnapshot) {
  updateCase(caseId, (c) => ({ ...c, token, snapshot: snapshot ?? c.snapshot }));
}

export function markFactsSeen(caseId: string, ids: string[]) {
  updateCase(caseId, (c) => {
    const seen = new Set(c.seenFacts);
    let changed = false;
    for (const id of ids) if (!seen.has(id)) (seen.add(id), (changed = true));
    return changed ? { ...c, seenFacts: [...seen] } : c;
  });
}

export function setStage(caseId: string, stage: CaseStage) {
  batch(() => {
    updateCase(caseId, { stage });
    updateMeta({ lastCaseId: caseId });
  });
}

export function setInquest(caseId: string, patch: Partial<InquestState>) {
  updateCase(caseId, (c) => ({
    ...c,
    inquest: {
      phase: 'debate',
      roundIndex: 0,
      composure: 5,
      cleared: [],
      misses: 0,
      grants: 0,
      verdictAttempts: 0,
      suspensions: 0,
      ...c.inquest,
      ...patch,
    },
  }));
}

const RANK_ORDER: Rank[] = ['S+', 'S', 'A', 'B', 'C'];
export const betterRank = (a: Rank | undefined, b: Rank | undefined): Rank | undefined =>
  !a ? b : !b ? a : RANK_ORDER.indexOf(a) <= RANK_ORDER.indexOf(b) ? a : b;

/**
 * Seal a run: best rank, best 獲得度数 (a replay only ever raises it, so the 名探偵度数 total
 * cannot be farmed), and the game-over mark (the next run's game overs are counted from here).
 *
 * The FIRST clear (2026-09-29) is written once and never overwritten: only when the case had no
 * clear before (a case cleared before the record existed gets none) and never by a special run
 * (online versus — its copy is thrown away anyway, but the result must not say 「初見」).
 */
export function completeCase(caseId: string, result: CaseResult) {
  const points = resultPoints(result).total;
  const special = !!runModeOf(caseId);
  updateCase(caseId, (c) => {
    const first = !special && !c.firstClear && c.clears === 0 && !c.completed && typeof result.clearMs === 'number';
    const firstClear: FirstClear | undefined = first
      ? {
          at: result.at,
          difficulty: result.playDifficulty ?? 'normal',
          clearMs: result.clearMs!,
          spent: result.stats?.spent ?? result.stats?.asked ?? 0,
          ...(typeof result.stats?.budget === 'number' ? { budget: result.stats.budget } : {}),
          rank: result.rank,
        }
      : c.firstClear;
    return {
      ...c,
      stage: 'complete',
      completed: true,
      clears: c.clears + 1,
      bestRank: betterRank(c.bestRank, result.rank),
      bestPoints: Math.max(c.bestPoints ?? 0, points),
      gameOversAtClear: c.gameOvers ?? 0,
      ...(firstClear ? { firstClear } : {}),
      ...(c.ownWords || result.stats?.examplesUsed === 0 ? { ownWords: true } : {}),
      lastResult: { ...result, stats: { ...result.stats, points }, prevBest: c.bestRank, prevBestPoints: c.bestPoints, ...(first ? { firstClear: true } : {}) },
    };
  });
}

/** The verdict was accepted: the run's clear time is the play time so far (kept once set). */
export function markCleared(caseId: string) {
  const c = saveData.peek().cases[caseId];
  if (!c || typeof c.clearMs === 'number') return;
  updateCase(caseId, { clearMs: c.elapsedMs });
}

/** Remember the restored victim identity (the ceremony has revealed it). */
export function setRestored(caseId: string, name: string, kana: string) {
  const cur = saveData.value.cases[caseId]?.restored;
  if (cur && cur.name === name && cur.kana === kana) return;
  updateCase(caseId, (c) => ({ ...c, restored: { name, kana } }));
}

/** Start the case over (keeps best rank / points, clear count, the first clear, the restored name, the chosen difficulty and the game-over counters; the 質問の例 cards and the clear time start over). */
export function resetCase(caseId: string) {
  updateCase(caseId, (c) => ({
    ...freshCase(caseId),
    bestRank: c.bestRank,
    clears: c.clears,
    completed: c.completed,
    lastResult: c.lastResult,
    restored: c.restored,
    ...(c.bestPoints !== undefined ? { bestPoints: c.bestPoints } : {}),
    ...(c.difficulty ? { difficulty: c.difficulty } : {}),
    ...(c.gameOvers ? { gameOvers: c.gameOvers } : {}),
    ...(c.gameOversAtClear ? { gameOversAtClear: c.gameOversAtClear } : {}),
    ...(c.firstClear ? { firstClear: c.firstClear } : {}),
    ...(c.ownWords ? { ownWords: true } : {}),
  }));
}

/** The difficulty a case is played on (default 審問官). */
export function caseDifficulty(caseId: string | undefined): Difficulty {
  return (caseId && saveData.value.cases[caseId]?.difficulty) || DEFAULT_DIFFICULTY;
}

export function setCaseDifficulty(caseId: string, difficulty: Difficulty) {
  updateCase(caseId, { difficulty });
}

export function addElapsed(caseId: string, ms: number) {
  if (ms <= 0) return;
  const c = saveData.value.cases[caseId];
  if (!c) return;
  updateCase(caseId, { elapsedMs: c.elapsedMs + ms });
}

/** Wipe everything except settings (the 名探偵度数 lives in the cases, so it goes too). */
export function resetAll() {
  const s = saveData.value.settings;
  saveData.value = { ...freshSave(), settings: s };
  flushSave();
}

/* ------------------------------------------------------------------ */
/* Derived                                                             */
/* ------------------------------------------------------------------ */
export function caseStatus(c: CaseProgress | undefined): CaseStatus {
  if (!c) return 'new';
  if (c.stage === 'complete') return 'complete';
  if (c.stage === 'new') return c.completed ? 'complete' : 'new';
  if (c.snapshot?.solved || ['resolution', 'science', 'quiz', 'result'].includes(c.stage)) return 'solved';
  return 'active';
}

/**
 * The saved cases this tab may show: without its switch (?proto=…, src/config/proto.ts) a
 * prototype case's save stays out of 「続きから」, the 名探偵度数 and the counts. It is kept, not
 * deleted: with the switch on again the case picks up where it was.
 */
export function shownCases<T>(cases: Record<string, T>): Record<string, T> {
  const ids = Object.keys(cases);
  if (!ids.some((id) => caseHiddenByProto(id))) return cases;
  return Object.fromEntries(ids.filter((id) => !caseHiddenByProto(id)).map((id) => [id, cases[id]]));
}

/** The case the 「続きから」 button resumes, or null. */
export const resumableCaseId = computed<string | null>(() => {
  const s = saveData.value;
  const active = Object.values(shownCases(s.cases)).filter((c) => c.stage !== 'new' && c.stage !== 'complete');
  if (!active.length) return null;
  const last = s.meta.lastCaseId && active.find((c) => c.caseId === s.meta.lastCaseId);
  if (last) return last.caseId;
  return active.sort((a, b) => b.updatedAt - a.updatedAt)[0].caseId;
});

/** Dev-only pipeline override for the API client (null = server default). */
export function getDevPipelineMode() {
  return saveData.peek().settings.pipelineMode;
}
