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
import type { ProgressSnapshot, ProgressToken, PublicFact, ScienceMemoView } from '../../shared/api';
import { prefersReducedMotion, START_MUTED } from '../lib/env';
import {
  SAVE_VERSION,
  type CaseProgress,
  type CaseResult,
  type CaseStage,
  type CaseStatus,
  type InquestState,
  type LogEntry,
  type Rank,
  type SaveData,
  type Settings,
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
const RANKS: readonly Rank[] = ['S', 'A', 'B', 'C'];

function sanitizeCase(id: string, c: unknown): CaseProgress | null {
  if (!isObj(c)) return null;
  const base = freshCase(id);
  return {
    ...base,
    ...c,
    caseId: id,
    stage: oneOf(c.stage, STAGES, 'new'),
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
    completed: bool(c.completed, false),
    clears: num(c.clears, 0, 0),
    bestRank: RANKS.includes(c.bestRank) ? c.bestRank : undefined,
    lastResult: isObj(c.lastResult) ? (c.lastResult as CaseResult) : undefined,
  };
}

function sanitize(raw: unknown): SaveData {
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
  return {
    version: SAVE_VERSION,
    settings: sanitizeSettings(m.settings),
    meta: {
      prologueSeen: bool(meta.prologueSeen, false),
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

export function flushSave() {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!dirty) return;
  dirty = false;
  try {
    localStorage.setItem(APP_CONFIG.SAVE_KEY, JSON.stringify(saveData.peek()));
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

const RANK_ORDER: Rank[] = ['S', 'A', 'B', 'C'];
export const betterRank = (a: Rank | undefined, b: Rank | undefined): Rank | undefined =>
  !a ? b : !b ? a : RANK_ORDER.indexOf(a) <= RANK_ORDER.indexOf(b) ? a : b;

export function completeCase(caseId: string, result: CaseResult) {
  updateCase(caseId, (c) => ({
    ...c,
    stage: 'complete',
    completed: true,
    clears: c.clears + 1,
    bestRank: betterRank(c.bestRank, result.rank),
    lastResult: result,
  }));
}

/** Start the case over (keeps best rank & clear count). */
export function resetCase(caseId: string) {
  updateCase(caseId, (c) => ({ ...freshCase(caseId), bestRank: c.bestRank, clears: c.clears, completed: c.completed, lastResult: c.lastResult }));
}

export function addElapsed(caseId: string, ms: number) {
  if (ms <= 0) return;
  const c = saveData.value.cases[caseId];
  if (!c) return;
  updateCase(caseId, { elapsedMs: c.elapsedMs + ms });
}

/** Wipe everything except settings. */
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

/** The case the 「続きから」 button resumes, or null. */
export const resumableCaseId = computed<string | null>(() => {
  const s = saveData.value;
  const active = Object.values(s.cases).filter((c) => c.stage !== 'new' && c.stage !== 'complete');
  if (!active.length) return null;
  const last = s.meta.lastCaseId && active.find((c) => c.caseId === s.meta.lastCaseId);
  if (last) return last.caseId;
  return active.sort((a, b) => b.updatedAt - a.updatedAt)[0].caseId;
});

/** Dev-only pipeline override for the API client (null = server default). */
export function getDevPipelineMode() {
  return saveData.peek().settings.pipelineMode;
}
