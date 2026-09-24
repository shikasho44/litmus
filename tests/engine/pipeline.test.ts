import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../server/engine/providers/types';
import type { Judge, PostChecker, Renderer, JudgeDecision } from '../../server/engine/judge-types';
import { BudgetGuard } from '../../server/engine/budget';
import { callModel, findLeaks } from '../../server/engine/pipeline';
import { createComponents } from '../../server/engine/factory';
import type { EngineTrace } from '../../server/engine/trace';
import { FIXTURE_ID, fixtureCase, makeService } from './helpers';

const usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.001 };
const caseId = FIXTURE_ID;

function judgeReturning(fn: (n: number) => JudgeDecision | Promise<JudgeDecision>): Judge & { calls: number } {
  const j = {
    name: 'fake-judge',
    calls: 0,
    async judge() {
      j.calls++;
      return fn(j.calls);
    },
  };
  return j;
}

describe('model pipeline', () => {
  it('uses a model judge decision (policy still applies)', async () => {
    const judge = judgeReturning(() => ({ answerClass: 'yes', factIds: ['F04', 'F15', 'F404'], confidence: 0.9, closeness: 1, qtype: 'yesno', source: 'model', usage, raw: { ok: 1 } }));
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] } });
    const r = await svc.ask({ caseId, question: 'ぴよぴよは雨と関係ある？' }, { withTrace: true });
    expect(judge.calls).toBe(1);
    expect(r.answers[0].answerClass).toBe('yes');
    expect(r.answers[0].unlocked.map((f) => f.id)).toEqual(['F04']); // F15 is level 4, F404 unknown
    expect(r.progress.nearCore).toBe(true);
    expect(r.trace?.mode).toBe('jev');
    expect(r.trace?.costUsd).toBeCloseTo(0.001);
    expect(r.trace?.tokens).toEqual({ input: 10, output: 5 });
  });

  it('skips the model on authored probe matches and hard metas', async () => {
    const judge = judgeReturning(() => ({ answerClass: 'no', factIds: [], confidence: 1, closeness: 0, qtype: 'yesno', source: 'model' }));
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] } });
    const r = await svc.ask({ caseId, question: '雨が降っていましたか' });
    expect(r.answers[0].answerClass).toBe('yes');
    await svc.ask({ caseId, question: '？？' });
    expect(judge.calls).toBe(0);
  });

  it('retries once on a retryable error, then degrades to rules with the degraded line', async () => {
    const judge = judgeReturning(() => {
      throw new ProviderError('fake', 'server', '502');
    });
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] } });
    const r = await svc.ask({ caseId, question: '薬物は使われた？' }, { withTrace: true });
    expect(judge.calls).toBe(2);
    expect(r.answers[0].answerClass).toBe('no'); // rules keyword answer
    expect(r.answers[0].line).toContain('簡易判定');
    expect(r.answers[0].notice).toBe('degraded');
    expect((r.trace as EngineTrace | undefined)?.degraded).toBe(true);
    expect(r.trace?.fallback).toContain('judge:fake:server');
  });

  it('does not retry non-retryable errors', async () => {
    const judge = judgeReturning(() => {
      throw new ProviderError('fake', 'bad_request', '400');
    });
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] } });
    await svc.ask({ caseId, question: '薬物は使われた？' });
    expect(judge.calls).toBe(1);
  });

  it('forces rules when the daily budget is exceeded', async () => {
    const judge = judgeReturning(() => ({ answerClass: 'no', factIds: [], confidence: 1, closeness: 0, qtype: 'yesno', source: 'model' }));
    const budget = new BudgetGuard(0.01);
    budget.add(0.02);
    const { svc } = makeService({ components: { mode: 'jev', judge, warnings: [] }, budget });
    const r = await svc.ask({ caseId, question: '薬物は使われた？' }, { withTrace: true });
    expect(judge.calls).toBe(0);
    expect(r.trace?.mode).toBe('rules');
    expect(r.trace?.fallback).toContain('budget');
    expect(r.answers[0].line).not.toContain('簡易判定');
    expect(r.answers[0].notice).toBeUndefined();
  });

  it('uses model phrasing, rejects leaks and re-renders once after a failed post-check', async () => {
    const lines = ['クックック、はい。一酸化炭素ですねェ。', 'ええ、雨の夜でしたとも。'];
    let i = 0;
    const renderer: Renderer = { name: 'fake-llm', canned: false, render: async () => ({ text: lines[i++ % 2], usage, latencyMs: 1, prompt: 'P' }) };
    const { svc } = makeService({ components: { mode: 'jev+llm', renderer, warnings: [] } });
    const r = await svc.ask({ caseId, question: '雨が降っていましたか' }, { withTrace: true });
    expect(r.answers[0].line).toBe('ええ、雨の夜でしたとも。'); // first try leaked a leak term
    expect(r.trace?.fastPath).toBe(false);

    let checks = 0;
    const checker: PostChecker = { name: 'fake-check', check: async () => ({ pass: ++checks > 5, reasons: ['tone'], usage, latencyMs: 1 }) };
    const r2 = await makeService({ components: { mode: 'jev+llm+check', renderer: { ...renderer, render: async () => ({ text: '雨でしたねェ。', usage, latencyMs: 1 }) }, postChecker: checker, warnings: [] } }).svc.ask({ caseId, question: '雨が降っていましたか' }, { withTrace: true });
    expect(checks).toBe(2); // render → check NG → render → check NG → canned
    expect(r2.trace?.fastPath).toBe(true);
    expect(r2.trace?.fallback).toContain('render:rejected');
  });

  it('callModel honours the deadline and timeouts', async () => {
    const slow = () => new Promise<number>((res) => setTimeout(() => res(1), 200));
    const r = await callModel('slow', slow, 50, () => 5000);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2); // timeout is retryable
    expect(r.error).toContain('timeout');
    const d = await callModel('x', async () => 1, 1000, () => 500);
    expect(d.ok).toBe(false);
    expect(d.error).toBe('deadline');
  });

  it('findLeaks ignores terms the player already knows', () => {
    const c = fixtureCase();
    const leakTerms = ['一酸化炭素'];
    expect(findLeaks('一酸化炭素ですねェ', leakTerms, [])).toEqual(['一酸化炭素']);
    expect(findLeaks('一酸化炭素ですねェ', leakTerms, [c.facts.find((f) => f.id === 'F15')!])).toEqual([]);
  });
});

describe('factory', () => {
  it('builds rules without a key and never throws for model modes', () => {
    expect(createComponents({}).mode).toBe('rules');
    expect(createComponents({ PIPELINE_MODE: 'rules', OPENROUTER_API_KEY: 'x' })).toMatchObject({ mode: 'rules', warnings: [] });
    // model modes either assemble a judge or degrade to rules with a warning (see factory.ts)
    const comp = createComponents({ PIPELINE_MODE: 'jev', OPENROUTER_API_KEY: 'x' });
    expect(comp.mode === 'rules' ? comp.warnings.length > 0 : !!comp.judge).toBe(true);
    expect(createComponents({ PIPELINE_MODE: 'jev+llm', LLM_PROVIDER: 'none', OPENROUTER_API_KEY: 'x' }).warnings.join(' ')).toContain('LLM_PROVIDER');
  });
});
