import { describe, expect, it } from 'vitest';
import type { AnswerClass } from '../../shared/case-schema';
import { findContradictions, findLeaks, labelDisagreements, leakTermsIn, stuckStreaks, type PooledAsk } from '../../scripts/playtest/analysis';
import { debatePrompt, parsePlayerJson, toAction } from '../../scripts/playtest/player';
import type { AskPart, RunLog } from '../../scripts/playtest/types';
import { fixtureCase, fixtureIndex } from '../engine/helpers';

const c = fixtureCase();
const index = fixtureIndex();

const part = (turn: number, answer: AnswerClass, question = `q${turn}`, extra: Partial<AskPart> = {}): AskPart => ({
  turn, message: question, question, answer, line: 'ホルマの一言', unlocked: [], latencyMs: 1, costUsd: 0, ...extra,
});

describe('stuck streaks', () => {
  it('finds ≥5 consecutive turns that gave nothing', () => {
    const classes: AnswerClass[] = ['yes', 'vague', 'irrelevant', 'cannot', 'vague', 'vague', 'no', 'vague', 'vague'];
    const s = stuckStreaks(classes.map((a, i) => part(i + 1, a)));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ from: 2, to: 6, length: 5 });
  });

  it('a turn is stuck only when all its parts are', () => {
    const asks = [1, 2, 3, 4, 5].flatMap((t) => [part(t, 'vague'), ...(t === 3 ? [part(t, 'yes')] : [])]);
    expect(stuckStreaks(asks)).toEqual([]);
  });
});

describe('contradictions', () => {
  it('same normalised question, different answers → one finding; negated forms kept apart', () => {
    const pool: PooledAsk[] = [
      { run: 'a', part: part(1, 'yes', '雨が降っていましたか？') },
      { run: 'b', part: part(4, 'no', '雨が降っていましたか') },
      { run: 'b', part: part(5, 'no', '雨は降っていなかったですよね？') },
    ];
    const found = findContradictions('c90', pool, index);
    const same = found.filter((f) => f.kind === 'same-question');
    expect(same).toHaveLength(1);
    expect(same[0].items.map((i) => i.answer).sort()).toEqual(['no', 'yes']);
  });

  it('ignores safety answers and agreeing answers', () => {
    const pool: PooledAsk[] = [
      { run: 'a', part: part(1, 'yes', '雨が降っていましたか') },
      { run: 'b', part: part(1, 'yes', '雨が降っていましたか') },
      { run: 'c', part: part(1, 'cannot', '雨が降っていましたか', { notice: 'support' }) },
    ];
    expect(findContradictions('c90', pool, index)).toEqual([]);
  });

  it('flags answers that differ from a near-identical authored probe', () => {
    const d = labelDisagreements([{ run: 'a', part: part(2, 'no', '雨が降っていましたか？') }], index);
    expect(d).toHaveLength(1);
    expect(d[0].expected).toBe('yes');
  });
});

describe('leaks', () => {
  it('counts leak terms unless the player already holds a card that says them', () => {
    expect(leakTermsIn('一酸化炭素ですねェ', index.leakTerms, [])).toEqual(['一酸化炭素']);
    expect(leakTermsIn('一酸化炭素ですねェ', index.leakTerms, ['一酸化炭素が出る'])).toEqual([]);
  });

  it('checks answers, hints and verdict feedback before the solve; flags level-4 cards', () => {
    const log = {
      id: 'r', caseId: c.id,
      asks: [part(1, 'yes', 'q', { line: 'はい。一酸化炭素。', unlocked: [{ id: 'F15', title: 'x', level: 4 }] })],
      hints: [{ turn: 1, level: 1, text: '一酸化炭素を疑いなさい' }],
      shots: [],
      verdicts: [
        { asked: 3, text: 't', result: 'almost', matched: [], lines: ['一酸化炭素？'] },
        { asked: 3, text: 't', result: 'correct', matched: [], lines: ['一酸化炭素！'] },
      ],
    } as unknown as RunLog;
    const { leaks, level4 } = findLeaks(log, c, index);
    expect(leaks.map((l) => l.where)).toEqual(['answer', 'hint', 'verdict']);
    expect(level4).toEqual(['F15']);
  });
});

describe('player output parsing', () => {
  it('reads fenced / chatty JSON and maps actions', () => {
    expect(toAction(parsePlayerJson('```json\n{"think":"x","action":"ask","question":"雨？",}\n```'))).toMatchObject({ action: 'ask', question: '雨？' });
    expect(toAction(parsePlayerJson('では: {"action":"hint"} 以上'))).toMatchObject({ action: 'hint' });
    expect(toAction(parsePlayerJson('{"statement":3,"span":"外は晴れていた","fact":"F04"}'))).toMatchObject({ action: 'shot', statement: '3', fact: 'F04' });
    expect(toAction(parsePlayerJson('{"verdict":"炭火の一酸化炭素"}'))).toMatchObject({ action: 'verdict' });
    expect(toAction(parsePlayerJson('not json'))).toBeUndefined();
    expect(toAction(parsePlayerJson('{"action":"ask"}'))).toBeUndefined();
  });

  it('shows statements by number (the UI has no ids) and never the answer', () => {
    const round = { id: 'R1', title: 't', intro: ['i'], statements: [{ id: 'R1-s1', speaker: 'jane' as const, segments: [{ text: 'だって、', noise: false }, { text: '外は晴れていた', noise: true }] }] };
    const p = debatePrompt({ title: 'x' } as never, round, [], [], []);
    expect(p).toContain('発言1（ジェーン）「だって、《外は晴れていた》」');
    expect(p).not.toContain('R1-s1');
  });
});

describe('similar-question contradictions', () => {
  it('near-identical wording answered yes vs no is reported once', () => {
    const pool: PooledAsk[] = [
      { run: 'a', part: part(13, 'yes', 'そのボールって、ひかりであつくなってとけたりしたんですか？') },
      { run: 'a', part: part(14, 'no', 'ボールって、ひかりであつくなってとけたんですか？') },
      { run: 'b', part: part(2, 'partial', 'ボールって、ひかりであつくなってとけたんですか？') },
    ];
    const found = findContradictions('c90', pool, index).filter((f) => f.kind === 'similar-question');
    expect(found).toHaveLength(1);
    expect(found[0].items.map((i) => i.turn).sort()).toEqual([13, 14]);
  });
});
