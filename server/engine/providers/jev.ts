/**
 * Jev decision provider (TypeSafe "System One" model — typed probabilities, no text).
 *
 *   OpenRouter  POST https://openrouter.ai/api/alpha/decisions   key OPENROUTER_API_KEY
 *               model JEV_MODEL (default 'typesafe/jev-1.13')
 *   TypeSafe    POST https://api.typesafe.ai/v1/systemone        key TYPESAFE_API_KEY
 *               (only when no OpenRouter key is set; model JEV_MODEL without the
 *               'typesafe/' prefix, default 'jev-latest')
 *
 * Request  { model, state, questions: { key: {type:'choice'|'score'|'noul', instructions, criteria?} } }
 * Response { answers: { key: {type, choice|score|noul, probabilities?, confidence?} }, usage: {input_tokens, output_tokens, cost} }
 * (shape verified 2026-09-24, see ./types.ts). Every answer is normalised here so callers can
 * rely on: choice ∈ criteria keys, probabilities summing to ~1, confidence = P(choice),
 * score as a number, noul ∈ [0,1].
 *
 * Works with the global fetch (Node 20+, Vercel). Keys are read from `env` once and only
 * placed in the Authorization header — never logged, never put in errors or `raw`.
 */
import type { EnvLike } from '../env.js';
import { postJson, type FetchLike } from './http.js';
import { ProviderError, type DecisionAnswer, type DecisionProvider, type DecisionQuestion, type DecisionResult, type Usage } from './types.js';

export const OPENROUTER_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const TYPESAFE_DECISIONS_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';
export const DEFAULT_JEV_TIMEOUT_MS = 6000;

export interface JevProviderOptions {
  fetchImpl?: FetchLike;
  /** Used when a call passes no timeoutMs. */
  defaultTimeoutMs?: number;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function normProbs(raw: unknown, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let sum = 0;
  for (const k of keys) {
    const p = clamp01(num(src[k], 0));
    out[k] = p;
    sum += p;
  }
  if (sum > 0 && Math.abs(sum - 1) > 0.02) for (const k of keys) out[k] = out[k] / sum;
  return out;
}

function argmax(p: Record<string, number>): string | undefined {
  let best: string | undefined;
  for (const [k, v] of Object.entries(p)) if (best === undefined || v > p[best]) best = k;
  return best;
}

/** Normalises one raw answer against the question that was asked. Exported for tests. */
export function normalizeAnswer(key: string, q: DecisionQuestion, a: unknown): DecisionAnswer {
  const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  if (q.type === 'noul') {
    const v = o.noul ?? o.value ?? o.probability;
    if (v === undefined) throw new ProviderError('jev', 'server', `answer "${key}" has no noul value`);
    return { type: 'noul', noul: clamp01(num(v)) };
  }
  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria);
    const probabilities = normProbs(o.probabilities, keys);
    let choice = typeof o.choice === 'string' && keys.includes(o.choice) ? o.choice : undefined;
    if (!choice) choice = argmax(probabilities);
    if (!choice) throw new ProviderError('jev', 'server', `answer "${key}" has no valid choice`);
    const confidence = probabilities[choice] > 0 ? probabilities[choice] : clamp01(num(o.confidence, 0));
    return { type: 'choice', choice, probabilities, confidence };
  }
  // score: levels are the criteria indices '0'..'n-1'
  const keys = q.criteria.map((_, i) => String(i));
  const probabilities = normProbs(o.probabilities, keys);
  let score = num(o.score, NaN);
  if (!Number.isFinite(score)) {
    const best = argmax(probabilities);
    if (best === undefined) throw new ProviderError('jev', 'server', `answer "${key}" has no score`);
    score = Number(best);
  }
  score = Math.min(keys.length - 1, Math.max(0, score));
  const top = argmax(probabilities);
  return { type: 'score', score, probabilities, confidence: top !== undefined && probabilities[top] > 0 ? probabilities[top] : clamp01(num(o.confidence, 0)) };
}

export function mapUsage(u: unknown): Usage {
  const o = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
  return {
    inputTokens: Math.round(num(o.input_tokens ?? o.prompt_tokens)),
    outputTokens: Math.round(num(o.output_tokens ?? o.completion_tokens)),
    costUsd: Math.max(0, num(o.cost ?? o.total_cost)),
  };
}

export function createJevProvider(env: EnvLike, opts: JevProviderOptions = {}): DecisionProvider {
  const orKey = env.OPENROUTER_API_KEY?.trim();
  const tsKey = env.TYPESAFE_API_KEY?.trim();
  if (!orKey && !tsKey) throw new ProviderError('jev', 'config', 'OPENROUTER_API_KEY (or TYPESAFE_API_KEY) is not set');
  const viaOpenRouter = !!orKey;
  const key = (viaOpenRouter ? orKey : tsKey)!;
  const configured = env.JEV_MODEL?.trim();
  const model = viaOpenRouter ? configured || DEFAULT_JEV_MODEL : (configured || 'jev-latest').replace(/^typesafe\//, '');
  const url = viaOpenRouter ? OPENROUTER_DECISIONS_URL : TYPESAFE_DECISIONS_URL;
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (viaOpenRouter) headers['x-title'] = 'janedoe';

  return {
    name: viaOpenRouter ? `jev:openrouter:${model}` : `jev:typesafe:${model}`,
    async decide(state, questions, callOpts = {}): Promise<DecisionResult> {
      const keys = Object.keys(questions);
      if (keys.length === 0) throw new ProviderError('jev', 'bad_request', 'no questions');
      const { data, latencyMs } = await postJson('jev', url, { model, state, questions }, headers, {
        signal: callOpts.signal,
        timeoutMs: callOpts.timeoutMs ?? opts.defaultTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
        fetchImpl: opts.fetchImpl,
      });
      const rawAnswers = data?.answers;
      if (!rawAnswers || typeof rawAnswers !== 'object') throw new ProviderError('jev', 'server', 'response has no answers');
      const missing = keys.filter((k) => !(k in rawAnswers));
      if (missing.length > 0) throw new ProviderError('jev', 'server', `no answer for: ${missing.slice(0, 5).join(', ')}`);
      const answers: Record<string, DecisionAnswer> = {};
      for (const k of keys) answers[k] = normalizeAnswer(k, questions[k], rawAnswers[k]);
      return {
        answers,
        usage: mapUsage(data?.usage),
        latencyMs,
        raw: { id: data?.id, model: data?.model ?? model, provider: data?.provider },
      };
    },
  };
}
