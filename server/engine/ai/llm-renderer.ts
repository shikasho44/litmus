/**
 * LlmRenderer — phrases Holma's line for an ALREADY DECIDED answer class (modes jev+llm,
 * jev+llm+check). Contract: server/engine/judge-types.ts (Renderer).
 *
 * Input to the model: the question, the fixed answer class, only the facts this answer reveals
 * (newlyUnlocked — giving it every held fact made it embellish), and the canned line as a style
 * reference. Persona from content/VOICE.md ("LLM 言い換え用の要約").
 *
 * Output rules checked locally before returning: ≤ 60 chars, clearly expresses the class first
 * (はい / いいえ / 一部 / 関係ない …, see guards.expressesClass), no leak term that the allowed
 * facts do not already contain, and no keyword of a fact the player does not hold (unless the
 * question itself used it). On any failure the canned line is returned (raw.fallback says
 * why) — the pipeline additionally leak-checks and, in mode C, runs the Jev post-check.
 */
import type { AnswerClass } from '../../../shared/case-schema.js';
import type { Renderer, RenderInput, RenderOutput } from '../judge-types.js';
import { ProviderError, type LlmProvider } from '../providers/types.js';
import { charLength, CLASS_LABEL, cleanLine, expressesClass, foreignFactMentions, leaksIn } from './guards.js';

export const MAX_RENDER_CHARS = 60;
const MAX_CONTEXT_FACTS = 3;

export interface LlmRendererOptions {
  llm: LlmProvider;
  maxChars?: number;
}

export const HOLMA_SYSTEM = [
  'あなたは「ホルマ」。零番安置室を管理する白ウサギの剥製標本で、芝居がかった慇懃無礼な司会者。',
  '一人称「私」、相手は「審問官」。語尾は「〜ですねェ」「〜ですとも」「さァ」、笑いは「クックック」「ククッ」（「ェ」「ァ」は1行に1回まで）。',
  '真実をすべて知っているが、掟により訊かれたことに判定で答えることしかできない。それを楽しんでいる。',
  '仕事: 与えられた「判定」の意味を変えずに、ホルマの一言を書く。',
  '- 必ず判定の言葉で始める: yes→「はい」、no→「いいえ」、partial→「一部」、irrelevant→「関係ない」。cannot→答えられない理由（掟・答えそのもの）を芝居がかって言う。vague→はい／いいえで答えられる形に言い直すよう促す。',
  '- 60字以内、1〜2文。全角の！？と……（2つ）と——（2つ）。絵文字・顔文字・英語禁止。',
  '- 事件の説明をしない。判定の言葉のあとは、ホルマの反応や感想（皮肉・含み笑い・掟）だけを添える。',
  '- 質問と「使ってよい事実」に出てくる言葉以外の、物・体の部位・場所・時刻・原因・人物を口にしない。推測しない。',
  '- 死因・仕組み・真相・答えを言わない、ほのめかさない。「始まり」「決め手」「核心」など重要さを匂わせる言い方もしない。',
  '- 血や傷の描写をしない。審問官を罵らない。「AI」などのメタな言葉を使わない。',
  '- 出力はホルマの一言だけ。かぎかっこ・名前・説明は付けない。',
].join('\n');

const OPENING_HINT: Record<AnswerClass, string> = {
  yes: '「はい」で始める',
  no: '「いいえ」で始める',
  partial: '「一部」で始める（どこが合っているかは言わない）',
  irrelevant: '「関係ない」で始める（その事柄が本当か嘘かは匂わせない）',
  cannot: '「はい」「いいえ」は使わず、掟や「答えそのもの」を理由に答えられないと言う',
  vague: '「はい」「いいえ」は使わず、はい／いいえで答えられる問いに言い直すよう促す',
};

export function buildRenderPrompt(input: RenderInput): string {
  // Only what this answer reveals (plus nothing else): more context made the model embellish.
  const facts = input.newlyUnlocked.slice(0, MAX_CONTEXT_FACTS);
  const base = input.cannedLine.split('\n').find((l) => l.trim().length > 0) ?? input.cannedLine;
  return [
    `審問官の質問: ${input.question}`,
    `判定: ${input.answerClass}（${CLASS_LABEL[input.answerClass]}）— ${OPENING_HINT[input.answerClass]}`,
    `使ってよい事実: ${facts.length > 0 ? facts.map((f) => `・${f.text}`).join(' ') : 'なし（事件の事実には触れない）'}`,
    input.newlyUnlocked.length > 0 ? '（この答えで審問官は新しい所見を手に入れた）' : '',
    input.nearCore ? '（審問官は核心に近づいている。動揺を少しだけ滲ませてよいが、答えは言わない）' : '',
    `口調の見本（そのまま使わない）: ${base}`,
    'ホルマの一言:',
  ].filter(Boolean).join('\n');
}

export class LlmRenderer implements Renderer {
  readonly name: string;
  readonly canned = false;
  private readonly llm: LlmProvider;
  private readonly maxChars: number;

  constructor(opts: LlmRendererOptions) {
    if (!opts?.llm) throw new ProviderError('llm', 'config', 'LlmRenderer needs an LlmProvider');
    this.llm = opts.llm;
    this.maxChars = opts.maxChars ?? MAX_RENDER_CHARS;
    this.name = `llm-renderer:${opts.llm.name}`;
  }

  async render(input: RenderInput): Promise<RenderOutput> {
    const prompt = buildRenderPrompt(input);
    const r = await this.llm.complete({ system: HOLMA_SYSTEM, user: prompt, maxTokens: 160, temperature: 0.8, signal: input.signal, timeoutMs: input.timeoutMs });
    const text = cleanLine(r.text);
    const problems: string[] = [];
    if (!text) problems.push('empty');
    if (charLength(text) > this.maxChars) problems.push('length');
    if (text && !expressesClass(text, input.answerClass)) problems.push('polarity');
    const leaks = leaksIn(text, input.caseData.leakTerms, input.allowedFacts);
    if (leaks.length > 0) problems.push('leak');
    // Words of facts the player does not hold (e.g. 「心臓」 in a reply about where the ball hit).
    const foreign = text ? foreignFactMentions(text, input.question, input.caseData.facts, new Set(input.allowedFacts.map((f) => f.id))) : [];
    if (foreign.length > 0) problems.push('new-fact');
    const out: RenderOutput = { text, mood: input.mood, usage: r.usage, latencyMs: r.latencyMs, prompt, model: r.model, raw: { output: r.text } };
    if (problems.length > 0) {
      out.text = input.cannedLine;
      out.raw = { output: r.text, fallback: problems, leaks: leaks.length > 0 ? leaks : undefined, foreign: foreign.length > 0 ? foreign : undefined };
    }
    return out;
  }
}
