import { describe, expect, it } from 'vitest';
import { LlmRenderer, buildRenderPrompt, HOLMA_SYSTEM } from '../../server/engine/ai/llm-renderer';
import { LlmJudge, extractJson, parseJudgeReply } from '../../server/engine/ai/llm-judge';
import { cleanLine, expressesClass, foreignFactMentions, leaksIn } from '../../server/engine/ai/guards';
import { analyze } from '../../server/engine/normalize';
import { retrieve } from '../../server/engine/retrieve';
import { judgeRules } from '../../server/engine/rules-judge';
import type { RenderInput } from '../../server/engine/judge-types';
import { ProviderError, type LlmProvider, type LlmRequest } from '../../server/engine/providers/types';
import { FIXTURE_ID, fixtureCase, fixtureIndex, makeService } from '../engine/helpers';

const c = fixtureCase();
const index = fixtureIndex();
const fact = (id: string) => c.facts.find((f) => f.id === id)!;

function fakeLlm(texts: string[] | ((req: LlmRequest) => string)): LlmProvider & { reqs: LlmRequest[] } {
  const p = {
    name: 'llm:fake',
    reqs: [] as LlmRequest[],
    async complete(req: LlmRequest) {
      p.reqs.push(req);
      const text = typeof texts === 'function' ? texts(req) : texts[Math.min(p.reqs.length - 1, texts.length - 1)];
      return { text, usage: { inputTokens: 500, outputTokens: 20, costUsd: 0.00005 }, latencyMs: 800, model: 'fake-model' };
    },
  };
  return p;
}

const renderInput = (over: Partial<RenderInput> = {}): RenderInput => ({
  caseData: c,
  question: 'コンロはありましたか？',
  answerClass: 'yes',
  allowedFacts: [fact('F01'), fact('F06')],
  newlyUnlocked: [fact('F06')],
  cannedLine: 'はい。……ククッ、そう来ましたか。\n所見を一枚、差し上げましょう。',
  mood: 'normal',
  nearCore: false,
  ...over,
});

describe('guards', () => {
  it('expressesClass: polar classes must open with their word; cannot / vague must not', () => {
    expect(expressesClass('はい。ククッ。', 'yes')).toBe(true);
    expect(expressesClass('……いいえ。静かに、否と。', 'no')).toBe(true);
    expect(expressesClass('クックック、はい。', 'yes')).toBe(false);
    expect(expressesClass('はい、いいえ、どちらでも。', 'yes')).toBe(false);
    expect(expressesClass('一部は、その通り。', 'partial')).toBe(true);
    expect(expressesClass('関係ない。ククッ。', 'irrelevant')).toBe(true);
    expect(expressesClass('それを言えば、答えそのものです。', 'cannot')).toBe(true);
    expect(expressesClass('はい。答えられません。', 'cannot')).toBe(false);
    expect(expressesClass('はい か いいえ で答えられる形に。', 'vague')).toBe(false);
    expect(expressesClass('もう少し、具体的に。', 'vague')).toBe(true);
  });

  it('leaksIn ignores terms the allowed facts already contain; cleanLine strips labels and quotes', () => {
    expect(leaksIn('一酸化炭素ですねェ', index.leakTerms, [])).toEqual(['一酸化炭素']);
    expect(leaksIn('一酸化炭素ですねェ', index.leakTerms, [fact('F15')])).toEqual([]);
    expect(cleanLine('ホルマ：「はい。ククッ。」')).toBe('はい。ククッ。');
  });

  it('foreignFactMentions flags keywords of facts the player does not hold, not ones from the question', () => {
    const allowed = new Set(['F01', 'F06']);
    expect(foreignFactMentions('はい。換気口も閉じていましたねェ。', 'コンロはありましたか？', c.facts, allowed)).toContain('換気');
    expect(foreignFactMentions('はい。換気ですか、ククッ。', '換気はしていましたか？', c.facts, allowed)).toEqual([]);
    expect(foreignFactMentions('はい。テントの中にございましたとも。', 'コンロはありましたか？', c.facts, allowed)).toEqual([]);
  });
});

describe('LlmRenderer', () => {
  it('returns a valid in-character line and exposes the prompt (only newly unlocked facts)', async () => {
    const llm = fakeLlm(['はい。ククッ、よく見ていらっしゃる。']);
    const r = await new LlmRenderer({ llm }).render(renderInput());
    expect(r.text).toBe('はい。ククッ、よく見ていらっしゃる。');
    expect(r.usage.costUsd).toBe(0.00005);
    expect(r.model).toBe('fake-model');
    expect(r.prompt).toContain('判定: yes');
    expect(r.prompt).toContain(fact('F06').text);
    expect(r.prompt).not.toContain(fact('F01').text);
    expect(llm.reqs[0].system).toBe(HOLMA_SYSTEM);
    expect(buildRenderPrompt(renderInput({ newlyUnlocked: [] }))).toContain('なし（事件の事実には触れない）');
  });

  it.each([
    ['wrong polarity', 'いいえ。違いますねェ。', 'polarity'],
    ['too long', `はい。${'ク'.repeat(70)}`, 'length'],
    ['leak', 'はい。一酸化炭素の匂いがしますねェ。', 'leak'],
    ['new fact', 'はい。換気口も閉じていましたねェ。', 'new-fact'],
    ['empty', '   ', 'empty'],
  ])('falls back to the canned line on %s', async (_name, text, reason) => {
    const input = renderInput();
    const r = await new LlmRenderer({ llm: fakeLlm([text]) }).render(input);
    expect(r.text).toBe(input.cannedLine);
    expect((r.raw as { fallback: string[] }).fallback).toContain(reason);
  });

  it('in the pipeline (jev+llm): the model line replaces the canned one; a leak falls back', async () => {
    const judge = { name: 'fake', async judge() { return { answerClass: 'yes' as const, factIds: ['F06'], confidence: 0.9, closeness: 1 as const, qtype: 'yesno' as const, source: 'model' as const }; } };
    const good = makeService({ components: { mode: 'jev+llm', judge, renderer: new LlmRenderer({ llm: fakeLlm(['はい。ククッ、お見事。']) }), warnings: [] } }).svc;
    const r = await good.ask({ caseId: FIXTURE_ID, question: '火を使う道具がありましたか' }, { withTrace: true });
    expect(r.answers[0].line).toBe('はい。ククッ、お見事。');
    expect(r.trace?.fastPath).toBe(false);
    const leaky = makeService({ components: { mode: 'jev+llm', judge, renderer: new LlmRenderer({ llm: fakeLlm(['はい。一酸化炭素ですとも。']) }), warnings: [] } }).svc;
    const r2 = await leaky.ask({ caseId: FIXTURE_ID, question: '火を使う道具がありましたか' });
    expect(r2.answers[0].line).not.toContain('一酸化炭素');
  });
});

describe('LlmJudge (mode llm)', () => {
  const ids = new Set(c.facts.map((f) => f.id));

  it('extracts JSON from fenced / chatty replies', () => {
    expect(extractJson('```json\n{"answerClass":"yes","line":"は{い}"}\n```')).toEqual({ answerClass: 'yes', line: 'は{い}' });
    expect(extractJson('結果: {"a": {"b": 1}} 以上')).toEqual({ a: { b: 1 } });
    expect(extractJson('no json here')).toBeUndefined();
  });

  it('parses defensively: Japanese class labels, unknown ids dropped, numbers clamped, bad line dropped', () => {
    const d = parseJudgeReply('{"answerClass":"いいえ","factIds":["f03","F99"],"closeness":7,"confidence":3,"line":"いいえ。ククッ。"}', ids);
    expect(d).toMatchObject({ answerClass: 'no', factIds: ['F03'], closeness: 3, confidence: 1, line: 'いいえ。ククッ。', source: 'model' });
    const noLine = parseJudgeReply('{"answerClass":"yes","factIds":[],"line":"いいえ、違います"}', ids);
    expect(noLine.line).toBeUndefined();
    expect(() => parseJudgeReply('{"answerClass":"maybe"}', ids)).toThrow(ProviderError);
    expect(() => parseJudgeReply('sorry', ids)).toThrow(ProviderError);
  });

  it('sends the whole truth + facts and returns a decision with usage', async () => {
    const llm = fakeLlm(['{"answerClass":"yes","factIds":["F06"],"closeness":2,"confidence":0.8,"line":"はい。ククッ。"}']);
    const q = analyze('コンロはありましたか？');
    const cand = retrieve(q, index);
    const d = await new LlmJudge({ llm }).judge({ caseData: c, index, question: q, candidates: cand, rules: judgeRules(q, cand, index), unlocked: new Set() });
    expect(d).toMatchObject({ answerClass: 'yes', factIds: ['F06'], line: 'はい。ククッ。', usage: { costUsd: 0.00005 } });
    expect(llm.reqs[0].json).toBe(true);
    expect(llm.reqs[0].user).toContain(c.truth.summary);
    expect(llm.reqs[0].user).toContain('F15');
  });
});
