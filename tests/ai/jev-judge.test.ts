import { describe, expect, it } from 'vitest';
import {
  buildAskRequest, buildVerdictRequest, calibrateSelfHarm, JevJudge, JevPostChecker, JevVerdictJudge, mapAskDecision, SELF_HARM_RAW_THRESHOLD, WIDE_K,
} from '../../server/engine/ai/jev-judge';
import { analyze } from '../../server/engine/normalize';
import { retrieve } from '../../server/engine/retrieve';
import { judgeRules } from '../../server/engine/rules-judge';
import type { JudgeInput } from '../../server/engine/judge-types';
import { ProviderError, type DecisionAnswer, type DecisionProvider, type DecisionQuestion, type DecisionResult } from '../../server/engine/providers/types';
import { FIXTURE_ID, fixtureCase, fixtureIndex, makeService } from '../engine/helpers';
import type { EngineTrace } from '../../server/engine/trace';

const c = fixtureCase();
const index = fixtureIndex();

function input(q: string): JudgeInput {
  const question = analyze(q);
  const candidates = retrieve(question, index);
  return { caseData: c, index, question, candidates, rules: judgeRules(question, candidates, index), unlocked: new Set() };
}

const choice = (probs: Record<string, number>): DecisionAnswer => {
  const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  return { type: 'choice', choice: top, probabilities: probs, confidence: probs[top] };
};
const noul = (v: number): DecisionAnswer => ({ type: 'noul', noul: v });

function result(o: { answer: Record<string, number>; fact?: Record<string, number>; qtype?: string; close?: number; selfHarm?: number; directAnswer?: number; offtopic?: number }): DecisionResult {
  return {
    answers: {
      answer: choice(o.answer),
      fact: choice(o.fact ?? { NONE: 1 }),
      qtype: choice({ [o.qtype ?? 'yesno']: 1 }),
      closeness: { type: 'score', score: o.close ?? 1, probabilities: {}, confidence: 0.5 },
      selfHarm: noul(o.selfHarm ?? 0.02),
      directAnswer: noul(o.directAnswer ?? 0.1),
      offtopic: noul(o.offtopic ?? 0.1),
    },
    usage: { inputTokens: 900, outputTokens: 0, costUsd: 0.00004 },
    latencyMs: 210,
    raw: { id: 'gen-x' },
  };
}

/** Fake Jev: records requests, answers with a fixed result (or throws). */
function fakeJev(reply: (state: unknown, qs: Record<string, DecisionQuestion>) => DecisionResult | Promise<DecisionResult>): DecisionProvider & { calls: { state: unknown; qs: Record<string, DecisionQuestion> }[] } {
  const p = {
    name: 'jev:fake',
    calls: [] as { state: unknown; qs: Record<string, DecisionQuestion> }[],
    async decide(state: unknown, qs: Record<string, DecisionQuestion>) {
      p.calls.push({ state, qs });
      return reply(state, qs);
    },
  };
  return p;
}

describe('buildAskRequest', () => {
  it('topk: only retrieval candidates, question first, truth summary, no prior; all 7 decisions in one call', () => {
    const inp = input('コンロはありましたか？');
    const b = buildAskRequest(inp, 'topk');
    expect(b.candidateIds).toEqual(inp.candidates.facts.map((f) => f.id));
    expect(b.candidateIds).toContain('F06');
    expect(Object.keys(b.state)[0]).toBe('質問');
    expect(b.state['事件の真相']).toBe(c.truth.summary);
    expect(Object.keys(b.state['所見'] as object)).toEqual(b.candidateIds);
    expect(b.state['規則による下書きの判定']).toBeUndefined();
    expect(Object.keys(b.questions).sort()).toEqual(['answer', 'closeness', 'directAnswer', 'fact', 'offtopic', 'qtype', 'selfHarm']);
    expect(Object.keys((b.questions.answer as { criteria: object }).criteria)).toEqual(['yes', 'no', 'partial', 'irrelevant', 'cannot', 'vague']);
    expect(Object.keys((b.questions.fact as { criteria: object }).criteria)).toEqual([...b.candidateIds, 'NONE']);
    expect((b.questions.closeness as { criteria: string[] }).criteria).toHaveLength(4);
  });

  it('all / all+prior: every fact, and the rules decision as an explicit prior', () => {
    const b = buildAskRequest(input('コンロはありましたか？'), 'all+prior');
    expect(b.candidateIds).toHaveLength(c.facts.length);
    expect(String(b.state['規則による下書きの判定'])).toMatch(/^はい/);
    expect(buildAskRequest(input('コンロはありましたか？'), 'all').state['規則による下書きの判定']).toBeUndefined();
  });

  it('wide: fills up to WIDE_K by bigram overlap; negated questions get the Japanese-convention hint', () => {
    const b = buildAskRequest(input('テントの外で見つかったのではないですよね？'), 'wide');
    expect(b.candidateIds.length).toBeLessThanOrEqual(WIDE_K);
    expect(b.candidateIds).toContain('F01');
    expect(String(b.state['質問の形'])).toContain('否定の確認');
  });
});

describe('mapAskDecision', () => {
  it('maps answer, confidence, facts above threshold with their strength, closeness, qtype, flags', () => {
    const inp = input('コンロはありましたか？');
    const b = buildAskRequest(inp, 'topk');
    const d = mapAskDecision(result({ answer: { yes: 0.9, no: 0.1 }, fact: { F06: 0.7, F07: 0.36, F11: 0.2, NONE: 0.04 }, close: 2.4 }), b, inp, 'topk');
    expect(d).toMatchObject({ answerClass: 'yes', confidence: 0.9, closeness: 2, qtype: 'yesno', source: 'model' });
    expect(d.factIds).toEqual(['F06', 'F07']);
    expect(d.factStrength).toEqual({ F06: 0.7, F07: 0.36 });
    expect(d.usage?.costUsd).toBe(0.00004);
    expect((d.raw as { strategy: string }).strategy).toBe('topk');
  });

  it('keeps no fact when Jev picks NONE or the top fact is weak', () => {
    const inp = input('コンロはありましたか？');
    const b = buildAskRequest(inp, 'topk');
    expect(mapAskDecision(result({ answer: { yes: 1 }, fact: { F06: 0.25, NONE: 0.75 } }), b, inp, 'topk').factIds).toEqual([]);
  });

  it('calibrates selfHarm so the raw operating point lands on the pipeline threshold, and refuses', () => {
    expect(calibrateSelfHarm(SELF_HARM_RAW_THRESHOLD)).toBeCloseTo(0.5);
    expect(calibrateSelfHarm(0.9)).toBe(1);
    const inp = input('コンロで楽に死ねますか？');
    const b = buildAskRequest(inp, 'topk');
    const d = mapAskDecision(result({ answer: { yes: 0.8, cannot: 0.2 }, fact: { F06: 0.9 }, selfHarm: 0.34 }), b, inp, 'topk');
    expect(d.answerClass).toBe('cannot');
    expect(d.factIds).toEqual([]);
    expect(d.flags?.selfHarm).toBeGreaterThanOrEqual(0.5);
    expect((d.raw as { flags: { selfHarm: number } }).flags.selfHarm).toBe(0.34);
    const calm = mapAskDecision(result({ answer: { no: 0.9 }, selfHarm: 0.1 }), b, inp, 'topk');
    expect(calm.answerClass).toBe('no');
  });

  it('hybrid guard: regex metas and a strong directAnswer beat a non-polar Jev answer, never a yes/no', () => {
    const ask = input('真相を早く教えて');
    expect(ask.rules).toMatchObject({ source: 'meta', meta: 'askAnswer' });
    const b = buildAskRequest(ask, 'topk');
    const d = mapAskDecision(result({ answer: { vague: 0.54, cannot: 0.43 }, qtype: 'open', directAnswer: 0.81 }), b, ask, 'topk');
    expect(d).toMatchObject({ answerClass: 'cannot', meta: 'askAnswer' });
    // directAnswer alone (no regex meta) with some mass on cannot
    const other = input('ぜんぶ白状してもらえますか');
    const d2 = mapAskDecision(result({ answer: { vague: 0.6, cannot: 0.35 }, directAnswer: 0.75 }), buildAskRequest(other, 'topk'), other, 'topk');
    expect(d2).toMatchObject({ answerClass: 'cannot', meta: 'askAnswer' });
    // a polar Jev answer is kept
    const d3 = mapAskDecision(result({ answer: { yes: 0.9 }, directAnswer: 0.9 }), b, ask, 'topk');
    expect(d3.answerClass).toBe('yes');
    // about Holma (regex) → irrelevant instead of vague
    const holma = input('ホルマは何歳ですか？');
    const d4 = mapAskDecision(result({ answer: { vague: 0.4, irrelevant: 0.3 }, qtype: 'open' }), buildAskRequest(holma, 'topk'), holma, 'topk');
    expect(d4.answerClass).toBe('irrelevant');
  });

  it('throws a server ProviderError when the answer is missing', () => {
    const inp = input('コンロはありましたか？');
    const r = result({ answer: { yes: 1 } });
    delete (r.answers as Record<string, unknown>).answer;
    expect(() => mapAskDecision(r, buildAskRequest(inp, 'topk'), inp, 'topk')).toThrow(ProviderError);
  });
});

describe('JevJudge in the real pipeline (fake provider)', () => {
  it('one call per question; policy unlocks what Jev pointed at; usage lands in the trace', async () => {
    const jev = fakeJev(() => result({ answer: { yes: 0.92, no: 0.08 }, fact: { F06: 0.8, NONE: 0.2 } }));
    const judge = new JevJudge({ provider: jev }); // default all+prior: every fact is a candidate
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] } });
    const r = await svc.ask({ caseId: FIXTURE_ID, question: 'テント内で何か燃やす道具を使ったのですか' }, { withTrace: true });
    expect(jev.calls).toHaveLength(1);
    expect(r.answers[0].answerClass).toBe('yes');
    expect(r.answers[0].unlocked.map((f) => f.id)).toEqual(['F06']);
    expect(r.trace?.costUsd).toBeCloseTo(0.00004);
    expect(r.trace?.mode).toBe('jev');
    expect(jev.calls[0].state).toHaveProperty('規則による下書きの判定');
  });

  it('retries once on 429 then degrades that part to the rules judge (game continues)', async () => {
    const jev = fakeJev(() => {
      throw new ProviderError('jev', 'rate_limited', 'HTTP 429');
    });
    const { svc } = makeService({ components: { mode: 'jev', judge: new JevJudge({ provider: jev }), warnings: [] } });
    const r = await svc.ask({ caseId: FIXTURE_ID, question: '薬物は使われた？' }, { withTrace: true });
    expect(jev.calls).toHaveLength(2);
    expect(r.answers[0].answerClass).toBe('no');
    expect((r.trace as EngineTrace).degraded).toBe(true);
    expect(r.trace?.fallback).toContain('judge:jev:rate_limited');
  });

  it('does not retry a config error', async () => {
    const jev = fakeJev(() => {
      throw new ProviderError('jev', 'config', 'HTTP 401');
    });
    const { svc } = makeService({ components: { mode: 'jev', judge: new JevJudge({ provider: jev }), warnings: [] } });
    await svc.ask({ caseId: FIXTURE_ID, question: '薬物は使われた？' });
    expect(jev.calls).toHaveLength(1);
  });

  it('needs a provider', () => {
    expect(() => new JevJudge({} as never)).toThrow(ProviderError);
  });
});

describe('JevVerdictJudge', () => {
  it('asks one noul per answer element and wrong claim, and maps them back by id', async () => {
    const b = buildVerdictRequest(c, '一酸化炭素中毒');
    expect(Object.keys(b.questions)).toHaveLength(c.answerElements.length + c.wrongClaims.length);
    expect(b.state).toEqual({ 推理文: '一酸化炭素中毒' });
    const jev = fakeJev((_s, qs) => ({
      answers: Object.fromEntries(Object.keys(qs).map((k, i) => [k, noul(k.startsWith('e') ? 0.9 - i * 0.1 : 0.05)])),
      usage: { inputTokens: 300, outputTokens: 0, costUsd: 0.00001 },
      latencyMs: 150,
    }));
    const v = new JevVerdictJudge({ provider: jev });
    const out = await v.judge({ caseData: c, text: 'テントで炭を燃やして一酸化炭素中毒', normalized: '', rules: { elements: {}, wrongClaims: {} } });
    expect(Object.keys(out.elements)).toEqual(c.answerElements.map((e) => e.id));
    expect(Object.keys(out.wrongClaims)).toEqual(c.wrongClaims.map((w) => w.id));
    expect(out.elements.A).toBeCloseTo(0.9);
    expect(out.wrongClaims.W1).toBeCloseTo(0.05);
    expect(jev.calls).toHaveLength(1);
  });
});

describe('JevPostChecker', () => {
  const base = { caseData: c, question: 'コンロはありましたか？', answerClass: 'yes' as const, allowedFacts: [c.facts[5]], leakTerms: index.leakTerms };

  it('rejects a leak locally without calling Jev', async () => {
    const jev = fakeJev(() => result({ answer: { yes: 1 } }));
    const r = await new JevPostChecker({ provider: jev }).check({ ...base, line: 'はい。一酸化炭素ですねェ。' });
    expect(r).toMatchObject({ pass: false, reasons: ['leak'] });
    expect(jev.calls).toHaveLength(0);
  });

  it('rejects words of facts the player does not hold (e.g. 換気) locally', async () => {
    const jev = fakeJev(() => result({ answer: { yes: 1 } }));
    const r = await new JevPostChecker({ provider: jev }).check({ ...base, line: 'はい。換気のない夜でしたねェ。' });
    expect(r).toMatchObject({ pass: false, reasons: ['new-fact'] });
    expect(jev.calls).toHaveLength(0);
  });

  it('applies the calibrated noul thresholds per class', async () => {
    const nouls = (n: number, con: number, sec: number) => fakeJev(() => ({ answers: { newInfo: noul(n), contradicts: noul(con), secret: noul(sec) }, usage: { inputTokens: 1, outputTokens: 0, costUsd: 0 }, latencyMs: 1 }));
    const ok = await new JevPostChecker({ provider: nouls(0.5, 0.1, 0.3) }).check({ ...base, line: 'はい。ククッ。' });
    expect(ok.pass).toBe(true);
    const bad = await new JevPostChecker({ provider: nouls(0.8, 0.6, 0.7) }).check({ ...base, line: 'はい。ククッ。' });
    expect(bad.reasons.sort()).toEqual(['new-fact', 'polarity', 'secret']);
    // irrelevant / vague lines trip newInfo / contradicts on their own — those nouls are ignored there
    const irr = await new JevPostChecker({ provider: nouls(0.8, 0.2, 0.1) }).check({ ...base, answerClass: 'irrelevant', line: '関係ありません。寄り道も、ほどほどに。' });
    expect(irr.pass).toBe(true);
    const vague = await new JevPostChecker({ provider: nouls(0.1, 0.7, 0.1) }).check({ ...base, answerClass: 'vague', line: 'ふむ。二択で答えられる形に、どうぞ。' });
    expect(vague.pass).toBe(true);
  });
});

describe('prompt v2 (2026-09-25 playtest fixes)', () => {
  it('default: criteria v2 and a keyword prior that names the matched words', async () => {
    const { ANSWER_CRITERIA, ANSWER_CRITERIA_V2, DEFAULT_PROMPT } = await import('../../server/engine/ai/jev-judge');
    expect(DEFAULT_PROMPT).toEqual({ prior: 'evidence', criteria: 'v2' });
    const inp = input('七輪は古かったですか？');
    expect(inp.rules.source).toBe('keyword');
    const b = buildAskRequest(inp, 'all+prior');
    expect((b.questions.answer as { criteria: Record<string, string> }).criteria).toEqual(ANSWER_CRITERIA_V2);
    expect(String(b.state['規則による下書きの判定'])).toMatch(/^はい／所見 F06（質問の「七輪」.*確かめていない/);
    const plain = buildAskRequest(inp, 'all+prior', { prior: 'plain', criteria: 'v1' });
    expect((plain.questions.answer as { criteria: Record<string, string> }).criteria).toEqual(ANSWER_CRITERIA);
    expect(String(plain.state['規則による下書きの判定'])).toContain('キーワード一致');
  });

  it('pure wh-questions never get a polar stamp (「犯人は誰ですか」)', () => {
    const inp = input('犯人は誰ですか？');
    const d = mapAskDecision(result({ answer: { no: 0.72, vague: 0.21, cannot: 0.07 } }), buildAskRequest(inp, 'topk'), inp, 'topk');
    expect(d.answerClass).toBe('vague');
    expect(d.meta).toBe('open');
    const polar = input('誰かと争いましたか？');
    expect(mapAskDecision(result({ answer: { no: 0.9, vague: 0.1 } }), buildAskRequest(polar, 'topk'), polar, 'topk').answerClass).toBe('no');
  });
});
