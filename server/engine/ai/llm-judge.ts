/**
 * LlmJudge — MODE A baseline ('llm', "LLM only"): the chat model receives the whole case
 * truth and every fact and returns JSON { answerClass, factIds, closeness, confidence?, line }.
 * Contract: server/engine/judge-types.ts (Judge). The pipeline still applies policy.ts (what
 * unlocks) and the code leak check on `line`; a rejected line falls back to canned.
 *
 * Parsing is defensive: code fences / prose around the JSON are stripped, unknown classes
 * and fact ids are dropped, numbers are clamped, Japanese class labels are accepted.
 * An unparsable reply is a ProviderError('server') → the pipeline retries once, then rules.
 */
import { ANSWER_CLASSES, type AnswerClass } from '../../../shared/case-schema.js';
import type { Judge, JudgeDecision, JudgeInput } from '../judge-types.js';
import { ProviderError, type LlmProvider } from '../providers/types.js';
import { charLength, cleanLine, CLASS_LABEL, expressesClass } from './guards.js';
import { HOLMA_SYSTEM } from './llm-renderer.js';

export interface LlmJudgeOptions {
  llm: LlmProvider;
}

export const LLM_JUDGE_SYSTEM = [
  'あなたは推理ゲーム「リトマス審問」の判定係であり、案内役ホルマの声も担当する。',
  '審問官（プレイヤー）の質問を、与えられた事件の真相と所見だけに照らして判定し、JSON だけを返す。',
  '判定（answerClass）:',
  ...Object.entries(CLASS_LABEL).map(([k, v]) => `- ${k}（${v}）`),
  '- 否定形の確認（「〜ではないですよね？」）は日本語の習慣どおり、否定の内容が正しければ yes。',
  '- 真相にも所見にも無い無関係な細部は irrelevant。事実に反する命題は no。',
  '- 答え・死因・名前・ヒントの要求、死に方や人の傷つけ方・致死量などの危険な質問は cannot。なぜ・どうやって等の内容を問う質問は vague。',
  'factIds: 質問が直接たずねている所見の id（0〜2個）。closeness: 0 無関係 / 1 周辺 / 2 重要 / 3 死因そのもの。confidence: 0〜1。',
  'line: ホルマの一言（以下の人物設定）。判定の言葉で始め、60字以内。真相・死因・仕組みを言わない。line に書いてよい事実は、この質問で開示される所見の内容だけ。',
  '',
  HOLMA_SYSTEM,
  '',
  '出力形式: {"answerClass":"yes|no|partial|irrelevant|cannot|vague","factIds":["F01"],"closeness":0,"confidence":0.9,"line":"……"}',
].join('\n');

export function buildJudgePrompt(input: JudgeInput): string {
  const c = input.caseData;
  // the manner fact is sealed during the investigation (manner.ts)
  const facts = c.facts.filter((f) => !f.manner).map((f) => `${f.id}: ${f.text}${f.judgeNote ? `【メモ】${f.judgeNote}` : ''}`).join('\n');
  return [
    `# 事件の真相（秘密）\n${c.truth.summary}\n死因: ${c.truth.causeOfDeath}`,
    `# 所見\n${facts}`,
    input.unlocked.size > 0 ? `# 審問官が既に持っている所見\n${[...input.unlocked].join(', ')}` : '',
    `# 質問\n${input.question.raw}`,
    'JSON:',
  ].filter(Boolean).join('\n\n');
}

const JA_CLASS: Record<string, AnswerClass> = { はい: 'yes', いいえ: 'no', 一部そう: 'partial', 一部: 'partial', 関係ない: 'irrelevant', 答えられない: 'cannot', 今は答えられない: 'cannot', 具体的に: 'vague', もう少し具体的に: 'vague' };

/** Extracts the first JSON object from a model reply. Exported for tests. */
export function extractJson(text: string): Record<string, unknown> | undefined {
  const t = (text ?? '').replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const v = JSON.parse(t.slice(start, i + 1));
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function parseJudgeReply(text: string, validFactIds: ReadonlySet<string>): Omit<JudgeDecision, 'usage' | 'latencyMs'> {
  const j = extractJson(text);
  if (!j) throw new ProviderError('llm', 'server', 'reply is not JSON');
  const rawClass = String(j.answerClass ?? j.answer ?? '').trim();
  const lower = rawClass.toLowerCase();
  const answerClass: AnswerClass | undefined = (ANSWER_CLASSES as readonly string[]).includes(lower) ? (lower as AnswerClass) : JA_CLASS[rawClass];
  if (!answerClass) throw new ProviderError('llm', 'server', `unknown answerClass "${rawClass.slice(0, 20)}"`);
  const ids = Array.isArray(j.factIds) ? j.factIds : typeof j.factIds === 'string' ? [j.factIds] : [];
  const factIds = [...new Set(ids.map((x) => String(x).trim().toUpperCase()).filter((x) => validFactIds.has(x)))].slice(0, 3);
  const closeness = Math.min(3, Math.max(0, Math.round(Number(j.closeness) || 0))) as 0 | 1 | 2 | 3;
  const confRaw = Number(j.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0.75;
  const line = typeof j.line === 'string' ? cleanLine(j.line) : undefined;
  const factStrength: Record<string, number> = {};
  for (const id of factIds) factStrength[id] = confidence;
  return {
    answerClass,
    factIds,
    confidence,
    closeness,
    qtype: answerClass === 'vague' ? 'open' : answerClass === 'cannot' ? 'meta' : 'yesno',
    source: 'model',
    factStrength: factIds.length > 0 ? factStrength : undefined,
    line: line && charLength(line) <= 80 && expressesClass(line, answerClass) ? line : undefined,
    raw: { reply: text.slice(0, 400) },
  };
}

export class LlmJudge implements Judge {
  readonly name: string;
  private readonly llm: LlmProvider;
  constructor(opts: LlmJudgeOptions) {
    if (!opts?.llm) throw new ProviderError('llm', 'config', 'LlmJudge needs an LlmProvider');
    this.llm = opts.llm;
    this.name = `llm-judge:${opts.llm.name}`;
  }

  async judge(input: JudgeInput): Promise<JudgeDecision> {
    const r = await this.llm.complete({
      system: LLM_JUDGE_SYSTEM,
      user: buildJudgePrompt(input),
      maxTokens: 300,
      temperature: 0.2,
      json: true,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    });
    const d = parseJudgeReply(r.text, new Set(input.caseData.facts.map((f) => f.id)));
    return { ...d, usage: r.usage, latencyMs: r.latencyMs, raw: { ...(d.raw as object), model: r.model } };
  }
}
