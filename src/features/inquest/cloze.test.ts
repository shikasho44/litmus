import { describe, expect, it } from 'vitest';
import { canChangeDifficulty } from '../difficulty/meta';
import type { CaseProgress } from '../../state/types';
import { parseCloze } from './cloze';

describe('parseCloze', () => {
  it('splits text and blanks in order', () => {
    expect(parseCloze('深夜、{{event}}、{{ body }}。')).toEqual([{ text: '深夜、' }, { blank: 'event' }, { text: '、' }, { blank: 'body' }, { text: '。' }]);
  });
  it('handles a template that starts or ends with a blank, and plain text', () => {
    expect(parseCloze('{{a}}と{{b}}')).toEqual([{ blank: 'a' }, { text: 'と' }, { blank: 'b' }]);
    expect(parseCloze('空欄なし')).toEqual([{ text: '空欄なし' }]);
    expect(parseCloze('{{壊れた}}')).toEqual([{ text: '{{壊れた}}' }]);
  });
});

describe('canChangeDifficulty', () => {
  const p = (over: Partial<CaseProgress>) => ({ caseId: 'c01-x', stage: 'investigation', log: [], ...over }) as CaseProgress;
  it('is open until the inquest starts', () => {
    expect(canChangeDifficulty(undefined)).toBe(true);
    expect(canChangeDifficulty(p({ stage: 'intro' }))).toBe(true);
    expect(canChangeDifficulty(p({ stage: 'investigation' }))).toBe(true);
  });
  it('locks once the inquest has opened (even back in the investigation) or the case is solved', () => {
    expect(canChangeDifficulty(p({ stage: 'inquest' }))).toBe(false);
    expect(canChangeDifficulty(p({ stage: 'investigation', inquest: { phase: 'debate', roundIndex: 0, composure: 5, cleared: [], misses: 0, grants: 0, verdictAttempts: 0, suspensions: 1 } }))).toBe(false);
    expect(canChangeDifficulty(p({ stage: 'resolution' }))).toBe(false);
  });
});
