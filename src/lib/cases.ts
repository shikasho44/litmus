/** Shared, cached list of case summaries (api.listCases). */
import { signal } from '@preact/signals';
import type { CaseSummary } from '../../shared/api';
import { api } from '../api';

export type LoadState = 'idle' | 'loading' | 'ok' | 'error';
export const caseList = signal<CaseSummary[] | null>(null);
export const caseListState = signal<LoadState>('idle');
export const caseListError = signal<string>('');

let inflight: Promise<CaseSummary[] | null> | null = null;

export function loadCases(force = false): Promise<CaseSummary[] | null> {
  if (!force && caseList.peek()) return Promise.resolve(caseList.peek());
  if (inflight) return inflight;
  caseListState.value = 'loading';
  inflight = api
    .listCases()
    .then((list) => {
      const sorted = [...list].sort((a, b) => a.number - b.number);
      caseList.value = sorted;
      caseListState.value = 'ok';
      return sorted;
    })
    .catch((e: unknown) => {
      caseListError.value = e instanceof Error ? e.message : String(e);
      caseListState.value = 'error';
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function caseTitle(id: string): string | undefined {
  return caseList.peek()?.find((c) => c.id === id)?.title;
}
