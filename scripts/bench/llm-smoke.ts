/**
 * One real LlmRenderer call (costs ONE chat call) — for choosing / checking LLM_MODEL.
 *
 *   npx tsx scripts/bench/llm-smoke.ts [--model <openrouter slug>] [--provider openrouter|codex]
 *                                      [--case c01] [--q 質問] [--class yes]
 *
 * Prints the line, the local checks, latency and cost. Never prints keys.
 */
import type { AnswerClass } from '../../shared/case-schema.js';
import { loadRegistry, resolveContentRoot } from '../../server/node/content-fs.js';
import { createOpenRouterLlm } from '../../server/engine/providers/openrouter-llm.js';
import { createCodexLlm } from '../../server/engine/providers/codex.js';
import { LlmRenderer } from '../../server/engine/ai/llm-renderer.js';
import { initialState } from '../../server/engine/state.js';

const args = process.argv.slice(2);
const get = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

async function main(): Promise<void> {
  const env = { ...process.env } as Record<string, string | undefined>;
  const model = get('model');
  if (model) env.LLM_MODEL = model;
  const provider = get('provider', 'openrouter');
  const llm = provider === 'codex' ? createCodexLlm(env) : createOpenRouterLlm(env);
  const reg = loadRegistry(resolveContentRoot());
  const c = reg.cases.find((x) => x.data.id.startsWith(get('case', 'c01')!))!;
  const state = initialState(c.data, Date.now());
  const allowed = state.unlocked.map((id) => c.index.factById.get(id)!.fact);
  const unlockFact = c.data.facts.find((f) => f.spoilerLevel <= 1 && f.importance >= 2 && !state.unlocked.includes(f.id))!;
  const answerClass = (get('class', 'yes') as AnswerClass) ?? 'yes';
  const r = new LlmRenderer({ llm });
  const out = await r.render({
    caseData: c.data,
    question: get('q', `${unlockFact.keywords[0]}は関係ありますか？`)!,
    answerClass,
    allowedFacts: [...allowed, unlockFact],
    newlyUnlocked: [unlockFact],
    cannedLine: 'はい。……ククッ、そう来ましたか。\n所見を一枚、差し上げましょう。',
    mood: 'normal',
    nearCore: false,
    timeoutMs: provider === 'codex' ? 90000 : 10000,
  });
  const raw = out.raw as { output?: string; fallback?: string[] };
  console.log(JSON.stringify({ model: out.model, line: out.text, modelOutput: raw.output, fallback: raw.fallback ?? null, latencyMs: out.latencyMs, usage: out.usage }, null, 1));
  if (provider === 'codex') (await import('../../server/engine/providers/codex-node.js')).shutdownCodex();
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
