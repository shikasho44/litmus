/**
 * Case public data (api.getCase) with a per-case cache, plus the token bootstrap shared by
 * the Intro and Investigation scenes.
 */
import { batch } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { CasePublic } from '../../../shared/api';
import { api } from '../../api';
import { addFacts, getCaseProgress, resetCase, setStage, setToken, updateCase } from '../../state/save';
import { runModeOf } from '../../state/runMode';
import type { PreviousAttempt } from '../../state/types';

const cache = new Map<string, CasePublic>();
const inflight = new Map<string, Promise<CasePublic>>();

export function loadCasePublic(caseId: string, force = false): Promise<CasePublic> {
  if (!force && cache.has(caseId)) return Promise.resolve(cache.get(caseId)!);
  let p = inflight.get(caseId);
  if (!p) {
    p = api
      .getCase(caseId)
      .then((c) => {
        cache.set(caseId, c);
        return c;
      })
      .finally(() => inflight.delete(caseId));
    inflight.set(caseId, p);
  }
  return p;
}

export function cachedCasePublic(caseId: string): CasePublic | undefined {
  return cache.get(caseId);
}

export type LoadStatus = 'loading' | 'ok' | 'error';

/** Hook: the case's public data. `retry()` re-fetches after an error. */
export function useCasePublic(caseId: string | undefined) {
  const [data, setData] = useState<CasePublic | undefined>(() => (caseId ? cache.get(caseId) : undefined));
  const [status, setStatus] = useState<LoadStatus>(data ? 'ok' : 'loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    if (!cache.has(caseId)) setStatus('loading');
    loadCasePublic(caseId, attempt > 0)
      .then((c) => {
        if (!alive) return;
        setData(c);
        setStatus('ok');
      })
      .catch(() => alive && setStatus(cache.has(caseId) ? 'ok' : 'error'));
    return () => {
      alive = false;
    };
  }, [caseId, attempt]);
  return { data, status, retry: () => setAttempt((n) => n + 1) };
}

/* ------------------------------------------------------------------ */
/* Token bootstrap                                                     */
/* ------------------------------------------------------------------ */
const tokenInflight = new Map<string, Promise<boolean>>();

/**
 * A fresh progress token for the case: api.newToken, or — during a special run such as an
 * online versus race (src/state/runMode.ts) — the token that run is played with.
 */
export function freshToken(caseId: string) {
  const mode = runModeOf(caseId);
  return mode?.newToken ? mode.newToken() : api.newToken(caseId);
}

/**
 * Makes sure the case has a progress token. New tokens come with the starting facts
 * (visible from the start), which are copied into the notebook. Never throws.
 */
export function ensureToken(caseId: string, pub?: CasePublic): Promise<boolean> {
  if (getCaseProgress(caseId)?.token) return Promise.resolve(true);
  let p = tokenInflight.get(caseId);
  if (!p) {
    p = (async () => {
      try {
        const [res, c] = await Promise.all([freshToken(caseId), pub ? Promise.resolve(pub) : loadCasePublic(caseId).catch(() => undefined)]);
        // Another tab/flow may have created one meanwhile; keep the first.
        if (getCaseProgress(caseId)?.token) return true;
        batch(() => {
          setToken(caseId, res.token, res.progress);
          if (c) addFacts(caseId, c.startingFacts);
        });
        return true;
      } catch {
        return false;
      } finally {
        tokenInflight.delete(caseId);
      }
    })();
    tokenInflight.set(caseId, p);
  }
  return p;
}

/**
 * The server rejected the saved token (tampered / expired / different secret) and the player
 * chose to start over: back the attempt up as `previousAttempt` (read-only 「前回の記録」 in the
 * notebook), then start this case over with a fresh token. Keeps best rank & clear count
 * (resetCase). An attempt with no questions is not worth a backup (an older one is kept).
 */
export async function restartCaseAfterBadToken(caseId: string, pub?: CasePublic): Promise<boolean> {
  const old = getCaseProgress(caseId);
  const asked = old?.log.some((e) => e.kind === 'question');
  const backup: PreviousAttempt | undefined =
    old && asked
      ? { at: Date.now(), log: old.log, facts: old.facts, factOrder: old.factOrder, hints: old.hints }
      : old?.previousAttempt;
  batch(() => {
    resetCase(caseId);
    if (backup) updateCase(caseId, { previousAttempt: backup });
    setStage(caseId, 'investigation');
  });
  return ensureToken(caseId, pub);
}

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

/** 0..1 — share of shard weight unlocked (same formula as the server's progress). */
export function shardProgress(pub: CasePublic | undefined, factIds: Iterable<string>, fallback = 0): number {
  if (!pub) return fallback;
  const w = pub.shardWeights;
  let total = 0;
  for (const v of Object.values(w)) total += v;
  if (!total) return fallback;
  let got = 0;
  for (const id of new Set(factIds)) got += w[id] ?? 0;
  return Math.min(1, got / total);
}

export const SHARD_COUNT = 34;
export const shardsLit = (p: number) => Math.max(0, Math.min(SHARD_COUNT, Math.round(p * SHARD_COUNT)));

/** CASE 01 */
export const caseNo = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
