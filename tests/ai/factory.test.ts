import { afterEach, describe, expect, it } from 'vitest';
import { clearProviderCache, componentsFor, createComponents, strategyFrom } from '../../server/engine/factory';
import { JevJudge, JevPostChecker, JevVerdictJudge, DEFAULT_STRATEGY } from '../../server/engine/ai/jev-judge';
import { LlmRenderer } from '../../server/engine/ai/llm-renderer';
import { LlmJudge } from '../../server/engine/ai/llm-judge';
import type { DecisionProvider, LlmProvider } from '../../server/engine/providers/types';

const KEY = { OPENROUTER_API_KEY: 'sk-or-test-key' };
const fakeDecision: DecisionProvider = { name: 'jev:fake', async decide() { throw new Error('not called'); } };
const fakeLlm: LlmProvider = { name: 'llm:fake', async complete() { throw new Error('not called'); } };

afterEach(() => clearProviderCache());

describe('factory', () => {
  it('rules mode builds nothing; no key → rules with a warning', () => {
    expect(createComponents({ PIPELINE_MODE: 'rules', ...KEY })).toEqual({ mode: 'rules', warnings: [] });
    const c = createComponents({ PIPELINE_MODE: 'jev' });
    expect(c.mode).toBe('rules');
    expect(c.warnings.join(' ')).toMatch(/OPENROUTER_API_KEY is not set/);
    expect(c.warnings.join(' ')).toMatch(/degraded: jev → rules/);
    expect(createComponents({}).mode).toBe('rules');
  });

  it('jev (default with a key): JevJudge with the default strategy + JevVerdictJudge, canned lines', () => {
    const c = createComponents(KEY);
    expect(c.mode).toBe('jev');
    expect(c.judge).toBeInstanceOf(JevJudge);
    expect((c.judge as JevJudge).strategy).toBe(DEFAULT_STRATEGY);
    expect(c.verdictJudge).toBeInstanceOf(JevVerdictJudge);
    expect(c.renderer).toBeUndefined();
    expect(c.warnings).toEqual([]);
    expect(strategyFrom({ JEV_CANDIDATES: 'topk' })).toBe('topk');
    expect(strategyFrom({ JEV_CANDIDATES: 'bogus' })).toBe(DEFAULT_STRATEGY);
    expect((createComponents({ ...KEY, JEV_CANDIDATES: 'wide' }).judge as JevJudge).strategy).toBe('wide');
  });

  it('jev+llm needs LLM_PROVIDER; with openrouter it adds the renderer; check adds the post-checker', () => {
    const none = createComponents({ ...KEY, PIPELINE_MODE: 'jev+llm' });
    expect(none.mode).toBe('jev');
    expect(none.warnings.join(' ')).toContain('LLM_PROVIDER');
    const b = createComponents({ ...KEY, PIPELINE_MODE: 'jev+llm', LLM_PROVIDER: 'openrouter' });
    expect(b.mode).toBe('jev+llm');
    expect(b.renderer).toBeInstanceOf(LlmRenderer);
    const cMode = createComponents({ ...KEY, PIPELINE_MODE: 'jev+llm+check', LLM_PROVIDER: 'openrouter' });
    expect(cMode.mode).toBe('jev+llm+check');
    expect(cMode.postChecker).toBeInstanceOf(JevPostChecker);
  });

  it('llm mode: LlmJudge only; component-level fallback when the LLM cannot be built', () => {
    const a = createComponents({ ...KEY, PIPELINE_MODE: 'llm', LLM_PROVIDER: 'openrouter' });
    expect(a.mode).toBe('llm');
    expect(a.judge).toBeInstanceOf(LlmJudge);
    expect(a.verdictJudge).toBeUndefined();
    const codexOnVercel = createComponents({ ...KEY, PIPELINE_MODE: 'jev+llm', LLM_PROVIDER: 'codex', VERCEL: '1' });
    expect(codexOnVercel.mode).toBe('jev'); // renderer dropped, Jev judge kept
    expect(codexOnVercel.warnings.join(' ')).toMatch(/codex llm: .*development-only/);
  });

  it('DECISION_PROVIDER=rules keeps rules decisions (but the post-checker may still use Jev)', () => {
    const c = createComponents({ ...KEY, DECISION_PROVIDER: 'rules', PIPELINE_MODE: 'jev+llm+check', LLM_PROVIDER: 'openrouter' });
    expect(c.judge).toBeUndefined();
    expect(c.renderer).toBeInstanceOf(LlmRenderer);
    expect(c.postChecker).toBeInstanceOf(JevPostChecker);
    expect(c.warnings.join(' ')).toMatch(/DECISION_PROVIDER=rules/);
  });

  it('overrides inject providers (tests / bench) without any key', () => {
    const c = createComponents({ PIPELINE_MODE: 'jev+llm+check', LLM_PROVIDER: 'openrouter' }, undefined, { decisionProvider: fakeDecision, llm: fakeLlm, strategy: 'topk' });
    expect(c.mode).toBe('jev+llm+check');
    expect((c.judge as JevJudge).strategy).toBe('topk');
  });

  it('componentsFor caches one component set per mode and shares providers', () => {
    const env = { ...KEY, LLM_PROVIDER: 'openrouter' };
    const f = componentsFor(env);
    const a = f('jev+llm');
    expect(f('jev+llm')).toBe(a);
    expect(f('rules').mode).toBe('rules');
    const b = f('jev');
    expect(b).not.toBe(a);
    // the same Jev provider instance behind both judges (provider cache)
    const pa = (a.judge as unknown as { provider: unknown }).provider;
    const pb = (b.judge as unknown as { provider: unknown }).provider;
    expect(pa).toBe(pb);
  });
});
