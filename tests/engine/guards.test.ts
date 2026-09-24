import { describe, expect, it } from 'vitest';
import { secretNamesIn, secretNamesOf } from '../../server/engine/case-index';
import { detectMeta, normalize } from '../../server/engine/normalize';
import { FIXTURE_ID, makeService } from './helpers';

const caseId = FIXTURE_ID;

describe('victim-name guard (identity is secret until solved)', () => {
  it('builds name forms without bare kana parts', () => {
    const names = secretNamesOf({ victim: { name: '白石 澪', nameKana: 'しらいし みお' } } as never);
    expect(names).toEqual(expect.arrayContaining(['白石澪', 'しらいしみお', '白石', '澪さん', 'みおさん', 'しらいしさん']));
    expect(names).not.toContain('みお');
    expect(names).not.toContain('しらいし');
    const c3 = secretNamesOf({ victim: { name: '椎名 遥', nameKana: 'しいな はるか' } } as never);
    // ordinary words must not trip it
    for (const q of ['おかしいな、何か変ですか', 'はるかに寒かったですか']) expect(secretNamesIn(normalize(q), c3)).toEqual([]);
    for (const q of ['彼女は椎名さんですか', 'はるかさんですか？', 'シイナハルカですか']) expect(secretNamesIn(normalize(q), c3).length).toBeGreaterThan(0);
  });

  it('answers cannot without calling the model judge', async () => {
    let calls = 0;
    const judge = {
      name: 'stub',
      async judge() {
        calls++;
        return { answerClass: 'yes' as const, factIds: [], confidence: 0.9, closeness: 0 as const, qtype: 'yesno' as const, source: 'model' as const };
      },
    };
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] } });
    const r = await svc.ask({ caseId, question: '彼女は試験花子さんですか？' }, { withTrace: true });
    expect(r.answers[0].answerClass).toBe('cannot');
    expect(r.answers[0].unlocked).toEqual([]);
    expect(calls).toBe(0);
    expect(JSON.stringify(r.trace)).toContain('skipped:secretName');
    // other questions still reach the model
    const ok = await svc.ask({ caseId, question: 'テントは緑色でしたか' });
    expect(ok.answers[0].answerClass).toBe('yes');
    expect(calls).toBe(1);
  });
});

describe('game-help questions → askHint (points at the hint button, not 「具体的に」)', () => {
  it.each([
    ['あと何問で解けますか？', false],
    ['あと何回質問できますか？', false],
    ['あといくつ所見がありますか？', false],
    ['審問はいつ開けばいいですか？', false],
    ['もう審問を開いてもいいですか？', false],
    ['このゲームの遊び方を教えて', false],
    ['質問の仕方を教えてください', false],
  ])('%s', (q, signal) => {
    expect(detectMeta(q, normalize(q), signal)).toBe('askHint');
  });

  it('leaves case questions alone', () => {
    expect(detectMeta('安全のルールは守られていましたか', normalize('安全のルールは守られていましたか'), true)).toBeUndefined();
    expect(detectMeta('何回倒れましたか', normalize('何回倒れましたか'), true)).toBeUndefined();
  });
});

describe('judge wake-up on case start', () => {
  it('warms the judge once per interval, never blocks newToken, adds the cost to the budget', async () => {
    let now = 1_000_000;
    let warms = 0;
    let added = 0;
    const judge = {
      name: 'stub',
      async judge() {
        return { answerClass: 'yes' as const, factIds: [], confidence: 0.9, closeness: 0 as const, qtype: 'yesno' as const, source: 'model' as const };
      },
      async warm() {
        warms++;
        return { inputTokens: 10, outputTokens: 1, costUsd: 0.000002 };
      },
    };
    const budget = { exceeded: () => false, add: (u: number) => void (added += u), spent: () => added } as never;
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] }, clock: () => now, budget });
    await svc.newToken(caseId);
    await svc.warming;
    await svc.newToken(caseId);
    expect(warms).toBe(1);
    now += 121_000;
    await svc.newToken(caseId);
    await svc.warming;
    expect(warms).toBe(2);
    expect(added).toBeCloseTo(0.000004, 9);
  });

  it('JevJudge.warm swallows provider errors', async () => {
    const { JevJudge } = await import('../../server/engine/ai/jev-judge');
    const failing = { name: 'x', async decide() { throw new Error('boom'); } };
    await expect(new JevJudge({ provider: failing as never }).warm()).resolves.toBeUndefined();
  });
});
