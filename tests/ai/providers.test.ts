import { describe, expect, it } from 'vitest';
import { createJevProvider, normalizeAnswer, OPENROUTER_DECISIONS_URL, TYPESAFE_DECISIONS_URL } from '../../server/engine/providers/jev';
import { createOpenRouterLlm, DEFAULT_LLM_MODEL, OPENROUTER_CHAT_URL } from '../../server/engine/providers/openrouter-llm';
import { createCodexLlm, codexOptions } from '../../server/engine/providers/codex';
import { ProviderError, type DecisionQuestion } from '../../server/engine/providers/types';
import type { FetchLike } from '../../server/engine/providers/http';

const KEY = 'sk-or-test-0123456789abcdef';

interface Call { url: string; init: RequestInit; body: Record<string, unknown> }

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const QS: Record<string, DecisionQuestion> = {
  answer: { type: 'choice', instructions: 'x', criteria: { yes: 'y', no: 'n', partial: 'p' } },
  level: { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c', 'd'] },
  flag: { type: 'noul', instructions: 'x' },
};

const OK_BODY = {
  id: 'gen-1',
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    answer: { type: 'choice', choice: 'no', probabilities: { yes: 0.1, no: 0.85, partial: 0.05 }, confidence: 0.85 },
    level: { type: 'score', score: 2.2, probabilities: { '0': 0.05, '1': 0.1, '2': 0.6, '3': 0.25 }, confidence: 0 },
    flag: { type: 'noul', noul: 0.12 },
  },
  usage: { input_tokens: 713, output_tokens: 129, cost: 0.000029946 },
};

describe('Jev provider', () => {
  it('posts the documented request to OpenRouter and maps the answers + usage', async () => {
    const f = fakeFetch(() => json(200, OK_BODY));
    const p = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: f });
    const r = await p.decide({ q: '質問' }, QS);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(OPENROUTER_DECISIONS_URL);
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(f.calls[0].body).toMatchObject({ model: 'typesafe/jev-1.13', state: { q: '質問' }, questions: QS });
    expect(r.answers.answer).toEqual({ type: 'choice', choice: 'no', probabilities: { yes: 0.1, no: 0.85, partial: 0.05 }, confidence: 0.85 });
    expect(r.answers.level).toMatchObject({ type: 'score', score: 2.2, confidence: 0.6 });
    expect(r.answers.flag).toEqual({ type: 'noul', noul: 0.12 });
    expect(r.usage).toEqual({ inputTokens: 713, outputTokens: 129, costUsd: 0.000029946 });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(r.raw)).not.toContain(KEY);
  });

  it('uses JEV_MODEL and falls back to TypeSafe when only TYPESAFE_API_KEY is set', async () => {
    const f = fakeFetch(() => json(200, OK_BODY));
    await createJevProvider({ OPENROUTER_API_KEY: KEY, JEV_MODEL: '~typesafe/jev-latest' }, { fetchImpl: f }).decide('s', QS);
    expect(f.calls[0].body.model).toBe('~typesafe/jev-latest');
    const g = fakeFetch(() => json(200, OK_BODY));
    await createJevProvider({ TYPESAFE_API_KEY: 'ts-key-0123456789', JEV_MODEL: 'typesafe/jev-1.13' }, { fetchImpl: g }).decide('s', QS);
    expect(g.calls[0].url).toBe(TYPESAFE_DECISIONS_URL);
    expect(g.calls[0].body.model).toBe('jev-1.13');
  });

  it('refuses to build without a key (config)', () => {
    expect(() => createJevProvider({})).toThrow(ProviderError);
    try {
      createJevProvider({ OPENROUTER_API_KEY: '  ' });
    } catch (e) {
      expect((e as ProviderError).kind).toBe('config');
    }
  });

  it.each([
    [429, 'rate_limited', true],
    [500, 'server', true],
    [503, 'server', true],
    [408, 'timeout', true],
    [401, 'config', false],
    [402, 'config', false],
    [400, 'bad_request', false],
    [422, 'bad_request', false],
  ])('maps HTTP %i to %s', async (status, kind, retryable) => {
    const f = fakeFetch(() => json(status, { error: { message: `boom ${KEY}` } }));
    const p = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: f });
    const err = await p.decide('s', QS).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
    expect(String(err.message)).not.toContain(KEY);
  });

  it('maps a network failure, a timeout, a caller abort and malformed bodies', async () => {
    const down = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect((await down.decide('s', QS).catch((e) => e)).kind).toBe('network');

    const hang: FetchLike = (_u, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const slow = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: hang });
    expect((await slow.decide('s', QS, { timeoutMs: 20 }).catch((e) => e)).kind).toBe('timeout');
    const ac = new AbortController();
    const pending = slow.decide('s', QS, { signal: ac.signal, timeoutMs: 5000 }).catch((e) => e);
    ac.abort();
    expect((await pending).kind).toBe('timeout');

    const garbage = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: async () => new Response('<html>', { status: 200 }) });
    expect((await garbage.decide('s', QS).catch((e) => e)).kind).toBe('server');
    const missing = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: async () => json(200, { answers: { answer: OK_BODY.answers.answer } }) });
    const err = await missing.decide('s', QS).catch((e) => e);
    expect(err.kind).toBe('server');
    expect(err.message).toContain('level');
    const inBody = createJevProvider({ OPENROUTER_API_KEY: KEY }, { fetchImpl: async () => json(200, { error: { code: 429, message: 'slow down' } }) });
    expect((await inBody.decide('s', QS).catch((e) => e)).kind).toBe('rate_limited');
  });

  it('normalises odd answers: unknown choice → argmax, probabilities renormalised, noul clamped', () => {
    const a = normalizeAnswer('answer', QS.answer, { choice: 'maybe', probabilities: { yes: 0.6, no: 0.3, partial: 0.3 } });
    expect(a).toMatchObject({ type: 'choice', choice: 'yes' });
    if (a.type === 'choice') expect(a.probabilities.yes).toBeCloseTo(0.5);
    expect(normalizeAnswer('flag', QS.flag, { noul: 1.7 })).toEqual({ type: 'noul', noul: 1 });
    const s = normalizeAnswer('level', QS.level, { probabilities: { '0': 0.1, '3': 0.9 } });
    expect(s).toMatchObject({ type: 'score', score: 3 });
    expect(() => normalizeAnswer('flag', QS.flag, {})).toThrow(ProviderError);
  });
});

describe('OpenRouter chat provider', () => {
  const reply = (content: unknown, usage: unknown = { prompt_tokens: 562, completion_tokens: 22, cost: 0.00005487 }) =>
    json(200, { model: 'deepseek/deepseek-v4-flash-0731', choices: [{ message: { content } }], usage });

  it('requests usage accounting, disables reasoning, sorts providers by latency and maps the reply', async () => {
    const f = fakeFetch(() => reply('  はい。ククッ。 '));
    const llm = createOpenRouterLlm({ OPENROUTER_API_KEY: KEY }, { fetchImpl: f });
    const r = await llm.complete({ system: 'sys', user: 'usr', maxTokens: 50 });
    expect(f.calls[0].url).toBe(OPENROUTER_CHAT_URL);
    expect(f.calls[0].body).toMatchObject({
      model: DEFAULT_LLM_MODEL,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
      max_tokens: 50,
      usage: { include: true },
      reasoning: { enabled: false },
      provider: { sort: 'latency' },
    });
    expect(f.calls[0].body.response_format).toBeUndefined();
    expect(r).toMatchObject({ text: 'はい。ククッ。', usage: { inputTokens: 562, outputTokens: 22, costUsd: 0.00005487 }, model: 'deepseek/deepseek-v4-flash-0731' });
  });

  it('honours LLM_MODEL / LLM_REASONING / LLM_PROVIDER_SORT and JSON mode', async () => {
    const f = fakeFetch(() => reply([{ type: 'text', text: '{"a":1}' }]));
    const llm = createOpenRouterLlm({ OPENROUTER_API_KEY: KEY, LLM_MODEL: 'openai/gpt-6-luna', LLM_REASONING: 'low', LLM_PROVIDER_SORT: 'price' }, { fetchImpl: f });
    const r = await llm.complete({ system: 's', user: 'u', json: true });
    expect(f.calls[0].body).toMatchObject({ model: 'openai/gpt-6-luna', reasoning: { effort: 'low' }, provider: { sort: 'price' }, response_format: { type: 'json_object' } });
    expect(r.text).toBe('{"a":1}');
  });

  it('maps errors like the Jev provider and needs a key', async () => {
    expect(() => createOpenRouterLlm({})).toThrow(ProviderError);
    const f = fakeFetch(() => json(503, { error: { message: 'no providers' } }));
    const err = await createOpenRouterLlm({ OPENROUTER_API_KEY: KEY }, { fetchImpl: f }).complete({ system: 's', user: 'u' }).catch((e) => e);
    expect(err.kind).toBe('server');
    const empty = fakeFetch(() => json(200, { choices: [] }));
    expect((await createOpenRouterLlm({ OPENROUTER_API_KEY: KEY }, { fetchImpl: empty }).complete({ system: 's', user: 'u' }).catch((e) => e)).kind).toBe('server');
  });
});

describe('Codex provider (construction only — no process is spawned)', () => {
  it('is refused on Vercel and reads its options', () => {
    expect(() => createCodexLlm({ VERCEL: '1' })).toThrow(/development-only/);
    expect(() => createCodexLlm({ CODEX_BIN: 'codex; rm -rf /' })).toThrow(ProviderError);
    const llm = createCodexLlm({ CODEX_TRANSPORT: 'exec', CODEX_MODEL: 'gpt-6-sol' });
    expect(llm.name).toBe('codex:exec:gpt-6-sol');
    expect(codexOptions({})).toMatchObject({ transport: 'app-server', bin: 'codex', effort: 'low', timeoutMs: 60000 });
  });
});
