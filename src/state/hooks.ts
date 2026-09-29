/** Preact hooks around the save store (for scene builders). */
import { useComputed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { addElapsed, caseStatus, saveData } from './save';
import type { CaseProgress, CaseStatus } from './types';

/** Reactive view of one case's progress (undefined until the case is started). */
export function useCaseProgress(caseId: string | undefined) {
  return useComputed<CaseProgress | undefined>(() => (caseId ? saveData.value.cases[caseId] : undefined));
}

export function useCaseStatus(caseId: string | undefined) {
  return useComputed<CaseStatus>(() => caseStatus(caseId ? saveData.value.cases[caseId] : undefined));
}

/** The running case timers' commit functions (commitCaseTimers flushes them all). */
const timerCommits = new Set<() => void>();

/** Write every running case timer's pending time now (before a clear time is read). */
export function commitCaseTimers() {
  timerCommits.forEach((f) => f());
}

/**
 * Advances CaseProgress.elapsedMs while the component is mounted and the tab is visible.
 * Writes every 5 s (and on unmount / hide / commitCaseTimers) to keep autosave cheap.
 */
export function useCaseTimer(caseId: string | undefined, active = true) {
  useEffect(() => {
    if (!caseId || !active) return;
    let last = performance.now();
    let pending = 0;
    const tick = () => {
      const now = performance.now();
      if (document.visibilityState === 'visible') pending += now - last;
      last = now;
    };
    const commit = () => {
      tick();
      if (pending >= 1) {
        addElapsed(caseId, Math.round(pending));
        pending = 0;
      }
    };
    const iv = setInterval(commit, 5000);
    timerCommits.add(commit);
    const onVis = () => {
      if (document.visibilityState === 'hidden') commit();
      else last = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      timerCommits.delete(commit);
      document.removeEventListener('visibilitychange', onVis);
      commit();
    };
  }, [caseId, active]);
}

/** 「12分34秒」 / 「1時間02分」 — a clear time in words (the result screen, the case tag). */
export function formatClearTime(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}時間${String(m).padStart(2, '0')}分` : `${m}分${String(sec).padStart(2, '0')}秒`;
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
