import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api';
import { evaluateVerdict } from '../../server/engine/verdict';
import { optionOrder } from '../../server/engine/public-view';
import { fixtureCase, FIXTURE_ID, makeService } from './helpers';

const caseId = FIXTURE_ID;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiError ? e.code : 'unknown';
  }
}

describe('public views', () => {
  it('lists and describes cases without secrets', async () => {
    const { svc } = makeService();
    const list = await svc.listCases();
    expect(list.map((c) => c.id)).toEqual([caseId]);
    const pub = await svc.getCase(caseId);
    const json = JSON.stringify(pub);
    for (const secret of ['試験 花子', '一酸化炭素', 'judgeNote', 'probes', 'answerElements', 'the answer itself']) expect(json).not.toContain(secret);
    expect(pub.startingFacts.map((f) => f.id)).toEqual(['F01']);
    expect(pub.totalFacts).toBe(17);
    expect(pub.shardWeights.F15).toBeUndefined();
    expect(pub.hintCount).toBe(3);
    expect(await code(svc.getCase('c00-nope'))).toBe('bad_request');
  });
});

describe('ask', () => {
  it('answers, unlocks, counts and re-signs', async () => {
    const { svc, traces } = makeService();
    const t0 = await svc.newToken(caseId);
    const r = await svc.ask({ caseId, question: 'テントの中にコンロがありましたか？', token: t0.token });
    expect(r.answers).toHaveLength(1);
    expect(r.answers[0].answerClass).toBe('yes');
    expect(r.answers[0].unlocked.map((f) => f.id)).toEqual(['F06']);
    expect(r.answers[0].memos.map((m) => m.id)).toEqual(['M01']);
    expect(r.answers[0].line.length).toBeGreaterThan(0);
    expect(r.progress.unlocked).toEqual(['F01', 'F06']);
    expect(r.progress.asked).toBe(1);
    expect(r.trace).toBeUndefined(); // not dev, not requested
    expect(traces.list()).toHaveLength(1);
    // the same token replayed yields the same answer (idempotent from the client's view)
    const again = await svc.ask({ caseId, question: 'テントの中にコンロがありましたか？', token: t0.token });
    expect(again.progress.asked).toBe(1);
  });

  it('splits multi-questions (max 3) and lets later parts see earlier unlocks', async () => {
    const { svc } = makeService();
    const r = await svc.ask({ caseId, question: 'コンロはありましたか？炭は燃え尽きていましたか？雨でしたか？あと外傷は？' }, { withTrace: true });
    expect(r.answers.map((a) => a.answerClass)).toEqual(['yes', 'yes', 'yes']);
    expect(r.answers[1].unlocked.map((f) => f.id)).toEqual(['F07']); // requires F06 from part 1
    expect(r.progress.asked).toBe(3);
    expect(r.trace?.fallback).toContain('dropped:1');
  });

  it('confirms level-4 guesses without a card and flags nearCore', async () => {
    const { svc } = makeService();
    const r = await svc.ask({ caseId, question: '中毒死ですか' });
    expect(r.answers[0].answerClass).toBe('yes');
    expect(r.answers[0].unlocked).toEqual([]);
    expect(r.progress.nearCore).toBe(true);
    expect(r.answers[0].mood).toBe('surprised');
  });

  it('does not count empty / over-long input and enforces the per-token cap', async () => {
    const { svc } = makeService({ questionCap: 2 });
    const e = await svc.ask({ caseId, question: '？？' });
    expect(e.answers[0].answerClass).toBe('vague');
    expect(e.progress.asked).toBe(0);
    const long = await svc.ask({ caseId, question: 'あ'.repeat(260) });
    expect(long.answers).toHaveLength(1);
    expect(long.progress.asked).toBe(0);
    let t = (await svc.ask({ caseId, question: '雨でしたか' })).token;
    t = (await svc.ask({ caseId, question: '雨でしたか', token: t })).token;
    expect(await code(svc.ask({ caseId, question: '雨でしたか', token: t }))).toBe('rate_limited');
  });

  it('rejects tokens from another case or tampered ones', async () => {
    const { svc } = makeService();
    const t = await svc.newToken(caseId);
    expect(await code(svc.ask({ caseId, question: '雨？', token: t.token.slice(0, -3) + 'abc' }))).toBe('bad_token');
    expect(await code(svc.hint({ caseId, token: '' }))).toBe('bad_token');
  });
});

describe('hints', () => {
  it('goes 1 → 2 → 3 and stays at 3', async () => {
    const { svc } = makeService();
    let t = (await svc.newToken(caseId)).token;
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      const h = await svc.hint({ caseId, token: t });
      levels.push(h.level);
      t = h.token;
      expect(h.text.length).toBeGreaterThan(0);
    }
    expect(levels).toEqual([1, 2, 3, 3]);
    const last = await svc.hint({ caseId, token: t });
    expect(last.progress.hintsUsed).toBe(3);
  });
});

describe('inquest', () => {
  async function withFacts(questions: string[]) {
    const { svc } = makeService();
    let t = (await svc.newToken(caseId)).token;
    for (const q of questions) t = (await svc.ask({ caseId, question: q, token: t })).token;
    return { svc, t };
  }

  it('starts with segmented statements and evidence', async () => {
    const { svc, t } = await withFacts(['雨が降っていましたか', 'お茶は関係ありますか']);
    const s = await svc.inquestStart({ caseId, token: t });
    expect(s.rounds.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(s.rounds[0].statements[1].segments).toEqual([
      { text: 'だって、', noise: false },
      { text: '外は晴れていた', noise: true },
      { text: 'もの。', noise: false },
    ]);
    expect(s.evidence.map((f) => f.id)).toEqual(['F01', 'F04']); // importance ≥ 1 only
  });

  it('handles correct shots, misses with hint after 2, and idempotent clears', async () => {
    const { svc, t } = await withFacts(['雨が降っていましたか']);
    const miss1 = await svc.shot({ caseId, token: t, roundId: 'R1', statementId: 'S1', span: '誰かに襲われた', factId: 'F04' });
    expect(miss1.correct).toBe(false);
    expect(miss1.hint).toBeUndefined();
    const miss2 = await svc.shot({ caseId, token: miss1.token, roundId: 'R1', statementId: 'S2', span: '外は晴れていた', factId: 'F01' });
    expect(miss2.correct).toBe(false);
    expect(miss2.hint).toBe('天気の所見を見直してご覧なさい。');
    expect(miss2.progress.debateMisses).toBe(2);
    // the full noise segment and the exact answer span are both accepted
    const hit = await svc.shot({ caseId, token: miss2.token, roundId: 'R1', statementId: 'S2', span: '外は晴れていた', factId: 'F04' });
    expect(hit.correct).toBe(true);
    expect(hit.progress.debateCleared).toEqual(['R1']);
    const hit2 = await svc.shot({ caseId, token: miss2.token, roundId: 'R1', statementId: 'S2', span: '晴れていた', factId: 'F04' });
    expect(hit2.correct).toBe(true);
    const again = await svc.shot({ caseId, token: hit.token, roundId: 'R1', statementId: 'S1', span: 'x', factId: 'F04' });
    expect(again.correct).toBe(true);
    expect(again.progress.debateMisses).toBe(2);
    // evidence not held → bad request
    expect(await code(svc.shot({ caseId, token: t, roundId: 'R2', statementId: 'S1', span: '入口は開けていた', factId: 'F05' }))).toBe('bad_request');
  });

  it('grants the needed evidence once (with penalty) and accepts alsoAccept facts', async () => {
    const { svc, t } = await withFacts([]);
    const g = await svc.grant({ caseId, token: t, roundId: 'R2' });
    expect(g.granted?.id).toBe('F05');
    expect(g.progress.unlocked).toContain('F05');
    const g2 = await svc.grant({ caseId, token: g.token, roundId: 'R2' });
    expect(g2.granted?.id).toBe('F05');
    const shot = await svc.shot({ caseId, token: g2.token, roundId: 'R2', statementId: 'S1', span: '入口は開けていた', factId: 'F05' });
    expect(shot.correct).toBe(true);
  });

  it('classifies verdicts without revealing the answer', async () => {
    const c = fixtureCase();
    expect(evaluateVerdict(c, 'テントの中で炭火を燃やして一酸化炭素中毒になった').result).toBe('correct');
    expect(evaluateVerdict(c, '一酸化炭素中毒').result).toBe('almost');
    expect(evaluateVerdict(c, 'テントの中の七輪が原因').result).toBe('missing');
    expect(evaluateVerdict(c, '心臓発作').result).toBe('wrong');
    expect(evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒。犯人に殺された').result).toBe('almost');
    expect(evaluateVerdict(c, 'テントの炭火で一酸化炭素中毒。殺されたのではない').result).toBe('correct');

    const { svc } = makeService();
    let t = (await svc.newToken(caseId)).token;
    expect(await code(svc.reconstruction({ caseId, token: t }))).toBe('bad_request');
    expect(await code(svc.solution({ caseId, token: t }))).toBe('bad_request');
    const wrong = await svc.verdict({ caseId, token: t, text: '心臓発作で死んだ' });
    expect(wrong.result).toBe('wrong');
    expect(wrong.matched).toEqual([]);
    expect(wrong.labels).toEqual({ A: '直接死因', B: '原因となった出来事', C: '科学的な仕組み' });
    expect(wrong.lines.join('')).not.toContain('一酸化炭素');
    const almost = await svc.verdict({ caseId, token: wrong.token, text: '一酸化炭素中毒' });
    expect(almost.result).toBe('almost');
    expect(almost.lines).toContain('その気体は、どこから来たのでしょう？');
    expect(almost.progress.verdictAttempts).toBe(2);
    const ok = await svc.verdict({ caseId, token: almost.token, text: 'テントの中で七輪を使い、換気できずに一酸化炭素中毒' });
    expect(ok.result).toBe('correct');
    expect(ok.progress.solved).toBe(true);
    t = ok.token;

    // reconstruction: correctness hidden in the view, options shuffled deterministically
    const view = await svc.reconstruction({ caseId, token: t });
    const blank = view.panels.find((p) => p.id === 'P2')!;
    expect(blank.caption).toBe('');
    expect(blank.image).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"correct"');
    const bad = await svc.submitReconstruction({ caseId, token: t, picks: { P2: 0, P4: 0 } });
    const orderP2 = optionOrder(caseId, 'P2', 3);
    const orderP4 = optionOrder(caseId, 'P4', 4);
    const right = { P2: orderP2.indexOf(0), P4: orderP4.indexOf(1) };
    expect(bad.allCorrect).toBe(right.P2 === 0 && right.P4 === 0);
    const good = await svc.submitReconstruction({ caseId, token: t, picks: right });
    expect(good.allCorrect).toBe(true);
    expect(good.correct).toEqual({ P2: true, P4: true });
    expect(good.finale?.length).toBeGreaterThan(0);
    expect(good.progress.reconstructed).toBe(true);
    const full = await svc.reconstruction({ caseId, token: good.token });
    expect(full.panels.find((p) => p.id === 'P2')!.caption).toContain('炭火');

    const sol = await svc.solution({ caseId, token: good.token });
    expect(sol.victim.name).toBe('試験 花子');
    expect(sol.truth.causeOfDeath).toBe('一酸化炭素中毒');
    expect(sol.allFacts.find((f) => f.id === 'F15')?.unlocked).toBe(false);
    expect(sol.quiz).toHaveLength(2);
  });
});
