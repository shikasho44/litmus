import { describe, expect, it } from 'vitest';
import { filesTabs, officialCases, resolveTab, shelfCases, supervisionLabel, tabShelves } from './shelves';

const list = [
  { id: 'c08', shelf: 'kurare' as const, reviewStatus: 'ai-reviewed' as const },
  { id: 'c05', shelf: 'original' as const },
  { id: 'c09', shelf: 'original' as const, proto: 'seeds' },
  { id: 'c10', proto: 'lab' }, // no shelf field: the lab by default
];

describe('事件ファイルの棚 (tabs)', () => {
  it('the lab tab exists only with ?proto=lab', () => {
    expect(filesTabs(false)).toEqual(['all', 'kurare', 'original']);
    expect(filesTabs(true)).toEqual(['all', 'kurare', 'original', 'lab']);
  });

  it('remembers a tab only while it is there (else すべて)', () => {
    expect(resolveTab(null, false)).toBe('all');
    expect(resolveTab('kurare', false)).toBe('kurare');
    expect(resolveTab('lab', false)).toBe('all');
    expect(resolveTab('lab', true)).toBe('lab');
    expect(resolveTab('junk', true)).toBe('all');
  });

  it('すべて shows every shelf as sections; a shelf tab only its own', () => {
    expect(tabShelves('all')).toEqual(['kurare', 'original', 'lab']);
    expect(tabShelves('original')).toEqual(['original']);
    expect(shelfCases(list, 'original').map((c) => c.id)).toEqual(['c05', 'c09']);
    expect(shelfCases(list, 'lab').map((c) => c.id)).toEqual(['c10']);
  });

  it('counts only the official cases (no prototype, no lab)', () => {
    expect(officialCases(list).map((c) => c.id)).toEqual(['c08', 'c05']);
  });

  it('says 監修中 on the くられ先生監修 shelf until a person reviewed the case', () => {
    expect(supervisionLabel(list[0])).toBe('監修中');
    expect(supervisionLabel({ shelf: 'kurare', reviewStatus: 'human-reviewed' })).toBe('監修済み');
    expect(supervisionLabel(list[1])).toBeNull();
  });
});
