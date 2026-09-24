/**
 * Shared loader for the ending scenes (Resolution / Science / Quiz / Result).
 *
 * api.solution() only answers for a solved token, so every ending scene goes through here:
 * one request per (case, token), cached in memory for the session, plus the public case
 * summary (number, title, difficulty…) from the shared case list.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { ApiError, type CaseSummary, type SolutionResponse } from '../../../shared/api';
import { api } from '../../api';
import { loadCases } from '../../lib/cases';
import type { CaseStage } from '../../state/types';
import { getCaseProgress, setStage } from '../../state/save';

export type SolutionError = 'unsolved' | 'network' | 'bad_token' | 'server';

export type SolutionState =
  | { status: 'loading' }
  | { status: 'ok'; sol: SolutionResponse; summary: CaseSummary | null }
  | { status: 'error'; reason: SolutionError; message: string };

const cache = new Map<string, { token: string; sol: SolutionResponse }>();

export async function fetchSolution(caseId: string): Promise<SolutionResponse> {
  const token = getCaseProgress(caseId)?.token;
  if (!token) throw new ApiError('bad_request', 'no token for this case', false);
  const hit = cache.get(caseId);
  if (hit && hit.token === token) return hit.sol;
  const sol = await api.solution({ caseId, token });
  cache.set(caseId, { token, sol });
  return sol;
}

/** Synchronous cache peek (lets a scene render immediately when coming from the previous one). */
export function cachedSolution(caseId: string): SolutionResponse | null {
  const token = getCaseProgress(caseId)?.token;
  const hit = cache.get(caseId);
  return hit && token && hit.token === token ? hit.sol : null;
}

function reasonOf(e: unknown): SolutionError {
  if (e instanceof ApiError) {
    if (e.code === 'bad_request') return 'unsolved';
    if (e.code === 'bad_token') return 'bad_token';
    if (e.code === 'network' || e.code === 'timeout' || e.code === 'rate_limited') return 'network';
  }
  return 'server';
}

export function summaryFor(caseId: string, list: CaseSummary[] | null): CaseSummary | null {
  return list?.find((c) => c.id === caseId) ?? null;
}

export function useSolution(caseId: string): [SolutionState, () => void] {
  const [state, setState] = useState<SolutionState>(() => {
    const sol = cachedSolution(caseId);
    return sol ? { status: 'ok', sol, summary: null } : { status: 'loading' };
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    if (state.status !== 'ok') setState({ status: 'loading' });
    Promise.all([fetchSolution(caseId), loadCases().catch(() => null)])
      .then(([sol, list]) => alive && setState({ status: 'ok', sol, summary: summaryFor(caseId, list) }))
      .catch((e: unknown) => alive && setState({ status: 'error', reason: reasonOf(e), message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [caseId, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return [state, retry];
}

/* ------------------------------------------------------------------ */
/* Case helpers                                                        */
/* ------------------------------------------------------------------ */

const STAGE_ORDER: CaseStage[] = ['new', 'intro', 'investigation', 'inquest', 'resolution', 'science', 'quiz', 'result', 'complete'];

/** Move the case forward to `stage` (never backwards — revisiting an earlier ending screen keeps progress). */
export function advanceStage(caseId: string, stage: CaseStage) {
  const cur = getCaseProgress(caseId)?.stage ?? 'new';
  if (STAGE_ORDER.indexOf(cur) < STAGE_ORDER.indexOf(stage)) setStage(caseId, stage);
}

export function stageAtLeast(caseId: string, stage: CaseStage): boolean {
  const cur = getCaseProgress(caseId)?.stage ?? 'new';
  return STAGE_ORDER.indexOf(cur) >= STAGE_ORDER.indexOf(stage);
}

/** 'c02-ball-at-dusk' → 2 (fallback when the case list is unavailable). */
export function caseNumber(caseId: string, summary: CaseSummary | null): number {
  if (summary) return summary.number;
  const m = caseId.match(/^c(\d+)/);
  return m ? Number(m[1]) : 0;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
