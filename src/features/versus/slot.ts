/**
 * The versus save slot — how a race runs through the ordinary case scenes without touching the
 * player's own save (docs/versus.md §Saves).
 *
 * The case scenes read and write `saveData.cases[caseId]`. For a race, that entry is swapped
 * IN MEMORY for the race's own CaseProgress, while:
 *   - storage keeps receiving the player's single-player entry for that case (and the meta as it
 *     was — tutorial, last case), via setPersistFilter: a crash, a reload or a closed tab can
 *     never leave race data (or a race's completion, rank, 名探偵度数 points) in the real save;
 *   - the race's entry is mirrored to sessionStorage (this tab only) so a reload resumes it;
 *   - leaving the case scenes (title, files, another case) puts the player's entry back.
 * Records written by the ending scenes during a race (completeCase → best rank, clears,
 * points) land in the race copy and vanish with it.
 */
import { batch, effect, signal } from '@preact/signals';
import { saveData, setPersistFilter } from '../../state/save';
import { caseRunMode, type CaseRunMode } from '../../state/runMode';
import type { CaseProgress, SaveData, SaveMeta } from '../../state/types';

const RUN_KEY = 'janedoe:vs:run';

interface Stash {
  caseId: string;
  /** the player's own progress for the case (undefined = none) */
  single: CaseProgress | undefined;
  meta: SaveMeta;
}

/** The case whose race is in memory right now (null = none). */
export const slotCase = signal<string | null>(null);

let stash: Stash | null = null;
let stopMirror: (() => void) | null = null;
let mirrorTimer: ReturnType<typeof setTimeout> | undefined;

/** The save as storage must see it while a race is in memory. Pure (tests). */
export function maskSave(d: SaveData, st: { caseId: string; single: CaseProgress | undefined; meta: SaveMeta }): SaveData {
  const cases = { ...d.cases };
  if (st.single) cases[st.caseId] = st.single;
  else delete cases[st.caseId];
  return { ...d, meta: st.meta, cases };
}

interface Mirror {
  code: string;
  you: string;
  caseId: string;
  progress: CaseProgress;
}

function writeMirror(m: Mirror) {
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(m));
  } catch {
    /* a full or blocked sessionStorage only loses the reload-resume */
  }
}

/** The race copy saved for this tab, if it belongs to that room seat. */
export function readMirror(code: string, you: string): CaseProgress | null {
  try {
    const m = JSON.parse(sessionStorage.getItem(RUN_KEY) || 'null') as Mirror | null;
    if (!m || m.code !== code || m.you !== you || !m.progress || typeof m.progress !== 'object') return null;
    return m.progress;
  } catch {
    return null;
  }
}

export function clearMirror() {
  try {
    sessionStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

let seat: { code: string; you: string } | null = null;

function mirrorNow() {
  clearTimeout(mirrorTimer);
  mirrorTimer = undefined;
  const id = slotCase.peek();
  const c = id ? saveData.peek().cases[id] : undefined;
  if (id && c && seat) writeMirror({ ...seat, caseId: id, progress: c });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', mirrorNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mirrorNow();
  });
}

/**
 * Put the race's progress in memory for `caseId` (the player's own entry is stashed first).
 * Re-entering with the same case only replaces the race copy.
 */
export function enterSlot(caseId: string, run: CaseProgress, mode: CaseRunMode, owner: { code: string; you: string }) {
  if (stash && stash.caseId !== caseId) suspendSlot();
  const s = saveData.peek();
  if (!stash) {
    const st: Stash = { caseId, single: s.cases[caseId], meta: s.meta };
    stash = st;
    setPersistFilter((d) => maskSave(d, st));
  }
  seat = owner;
  batch(() => {
    // the coach-mark tutorial never runs inside a race (the stashed meta keeps its real state)
    saveData.value = { ...s, meta: { ...s.meta, tutorial: { state: 'done', step: 0 } }, cases: { ...s.cases, [caseId]: run } };
    caseRunMode.value = mode;
    slotCase.value = caseId;
  });
  writeMirror({ ...owner, caseId, progress: run });
  stopMirror ??= effect(() => {
    const id = slotCase.value;
    const c = id ? saveData.value.cases[id] : undefined;
    if (!c) return;
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(mirrorNow, 700);
  });
}

/** Put the player's own progress back (the race copy stays mirrored for this tab). */
export function suspendSlot() {
  if (!stash) return;
  mirrorNow();
  const st = stash;
  stash = null;
  stopMirror?.();
  stopMirror = null;
  batch(() => {
    saveData.value = maskSave(saveData.peek(), st);
    caseRunMode.value = null;
    slotCase.value = null;
  });
  setPersistFilter(null);
}

/** The race is over for this tab: put the player's progress back and forget the race copy. */
export function dropSlot() {
  suspendSlot();
  seat = null;
  clearMirror();
}
