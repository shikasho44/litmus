/**
 * The versus save slot (src/features/versus/slot.ts): a race lives in memory under
 * cases[caseId] while storage keeps the player's own progress; nothing of the race (not even a
 * completion, rank or points) reaches the stored save.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../src/config/app';
import { completeCase, flushSave, freshCase, saveData, updateCase } from '../../src/state/save';
import { caseRunMode } from '../../src/state/runMode';
import type { CaseProgress, SaveData } from '../../src/state/types';
import { dropSlot, enterSlot, maskSave, readMirror, slotCase, suspendSlot } from '../../src/features/versus/slot';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

const single: CaseProgress = { ...freshCase('c01'), stage: 'investigation', token: 'solo-token', notes: 'mine', bestRank: 'A', clears: 2, completed: true };
const other: CaseProgress = { ...freshCase('c02'), stage: 'inquest', token: 'c02-token' };

let local: ReturnType<typeof fakeStorage>;
let session: ReturnType<typeof fakeStorage>;
const stored = () => JSON.parse(local.map.get(APP_CONFIG.SAVE_KEY) ?? '{}') as SaveData;

beforeEach(() => {
  local = fakeStorage();
  session = fakeStorage();
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });
  const s = saveData.peek();
  saveData.value = { ...s, meta: { ...s.meta, tutorial: { state: 'on', step: 2 }, lastCaseId: 'c02' }, cases: { c01: single, c02: other } };
});
afterEach(() => {
  dropSlot();
});

describe('versus save slot', () => {
  it('maskSave shows storage the player’s own entry and meta', () => {
    const race = { ...freshCase('c01'), token: 'race' };
    const d = { ...saveData.peek(), cases: { c01: race, c02: other } };
    const meta = { ...d.meta, lastCaseId: 'c02' };
    expect(maskSave(d, { caseId: 'c01', single, meta }).cases.c01).toBe(single);
    expect(maskSave(d, { caseId: 'c01', single: undefined, meta }).cases.c01).toBeUndefined();
    expect(maskSave(d, { caseId: 'c01', single, meta }).cases.c02).toBe(other);
  });

  it('a race never reaches storage, and leaving the race brings the player’s run back', () => {
    const race: CaseProgress = { ...freshCase('c01'), stage: 'investigation', difficulty: 'easy', token: 'race-token' };
    enterSlot('c01', race, { caseId: 'c01', lockDifficulty: true }, { code: 'ABC234', you: '1abcde' });
    expect(slotCase.peek()).toBe('c01');
    expect(caseRunMode.peek()?.caseId).toBe('c01');
    expect(saveData.peek().cases.c01.token).toBe('race-token');
    expect(saveData.peek().meta.tutorial?.state).toBe('done'); // no coach marks in a race

    // the scenes play the race as usual — including the ending that records a clear
    updateCase('c01', { notes: 'race notes' });
    completeCase('c01', { rank: 'S+', title: 't', at: 1, elapsedMs: 1000, stats: {} });
    updateCase('c02', { notes: 'another case, saved normally' });
    flushSave();
    const s = stored();
    expect(s.cases.c01).toEqual(single);
    expect(s.meta.tutorial).toEqual({ state: 'on', step: 2 });
    expect(s.cases.c02.notes).toBe('another case, saved normally');

    suspendSlot();
    expect(caseRunMode.peek()).toBeNull();
    expect(saveData.peek().cases.c01).toEqual(single);
    expect(saveData.peek().meta.tutorial).toEqual({ state: 'on', step: 2 });
    // the race copy is kept for this tab (reload / 捜査に戻る)
    const mirror = readMirror('ABC234', '1abcde');
    expect(mirror?.token).toBe('race-token');
    expect(mirror?.completed).toBe(true);
    expect(readMirror('ABC234', 'someone-else')).toBeNull();
    flushSave();
    expect(stored().cases.c01).toEqual(single);
  });

  it('a case with no single-player run stays absent from storage', () => {
    const s = saveData.peek();
    saveData.value = { ...s, cases: { c02: other } };
    enterSlot('c01', { ...freshCase('c01'), token: 'race' }, { caseId: 'c01' }, { code: 'ABC234', you: '1abcde' });
    updateCase('c01', { notes: 'x' });
    flushSave();
    expect(stored().cases.c01).toBeUndefined();
    dropSlot();
    expect(saveData.peek().cases.c01).toBeUndefined();
    expect(readMirror('ABC234', '1abcde')).toBeNull();
  });
});
