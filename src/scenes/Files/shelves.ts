/**
 * The tabs of the 事件ファイル screen (2026-10-04, docs/decisions.md 「事件ファイルを棚に分けた」):
 * すべて · くられ先生監修 · オリジナル · (リトマス・ラボ, only with ?proto=lab). Pure helpers, tested
 * in shelves.test.ts; the shelf of a case comes from shared/shelf.ts.
 */
import type { CaseSummary } from '../../../shared/api';
import { caseShelf, isOfficialCase, type ShelfId } from '../../../shared/shelf';

export type FilesTab = 'all' | ShelfId;

export interface ShelfMeta {
  jp: string;
  en: string;
  /** One line under the shelf heading. */
  note: string;
}

export const SHELF_META: Record<ShelfId, ShelfMeta> = {
  kurare: {
    jp: 'くられ先生監修',
    en: 'SUPERVISED',
    note: '科学の筋をくられ先生に見ていただくための事件です。いまは監修中で、AIによる点検までが済んでいます。',
  },
  original: {
    jp: 'オリジナル',
    en: 'ORIGINAL',
    note: '監修の対象ではない、リトマス審問オリジナルの事件です。入門編もここにあります。',
  },
  lab: {
    jp: 'リトマス・ラボ',
    en: 'LITMUS LAB',
    note: 'みんなが作った謎（AIと作った・未監修）。科学の点検はまだで、公式の事件とは別に数えます。',
  },
};

export const TAB_LABEL: Record<FilesTab, string> = {
  all: 'すべて',
  kurare: SHELF_META.kurare.jp,
  original: SHELF_META.original.jp,
  lab: SHELF_META.lab.jp,
};

/** The tabs in order. The lab tab only while the lab switch is on (?proto=lab). */
export function filesTabs(labOn: boolean): FilesTab[] {
  return labOn ? ['all', 'kurare', 'original', 'lab'] : ['all', 'kurare', 'original'];
}

/** A remembered tab that is still there, else すべて. */
export function resolveTab(stored: string | null | undefined, labOn: boolean): FilesTab {
  return (filesTabs(labOn) as string[]).includes(stored ?? '') ? (stored as FilesTab) : 'all';
}

/** The shelves a tab shows, in order (すべて: every shelf that has a case, as sections). */
export function tabShelves(tab: FilesTab): ShelfId[] {
  return tab === 'all' ? ['kurare', 'original', 'lab'] : [tab];
}

/** The cases of one shelf, in CASE number order (the list already comes sorted). */
export function shelfCases<T extends Pick<CaseSummary, 'shelf' | 'proto'>>(list: readonly T[], shelf: ShelfId): T[] {
  return list.filter((c) => caseShelf(c) === shelf);
}

/** The cases the header counters count (shared/shelf.ts isOfficialCase): the official 8 now. */
export function officialCases<T extends Pick<CaseSummary, 'shelf' | 'proto'>>(list: readonly T[]): T[] {
  return list.filter((c) => isOfficialCase(c));
}

/** The 監修 stamp of a case on the くられ先生監修 shelf: 監修中 until a person reviewed it. */
export function supervisionLabel(c: Pick<CaseSummary, 'shelf' | 'proto' | 'reviewStatus'>): string | null {
  if (caseShelf(c) !== 'kurare') return null;
  return c.reviewStatus === 'human-reviewed' ? '監修済み' : '監修中';
}

export const TAB_STORAGE_KEY = 'janedoe:files-tab';

export function readStoredTab(): string | null {
  try {
    return sessionStorage.getItem(TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeTab(tab: FilesTab): void {
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* blocked storage: this visit only */
  }
}
