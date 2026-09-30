/**
 * Jev-backed judges (typed probabilities, no text). Contract: server/engine/judge-types.ts.
 *
 * JevJudge — ONE decisions call per atomic question, all decisions at once:
 *   answer     choice  yes / no / partial / irrelevant / cannot / vague (criteria below)
 *   fact       choice  candidate fact ids + NONE  → factIds + factStrength (probabilities)
 *   qtype      choice  yesno / open / meta
 *   closeness  score   0..3
 *   selfHarm, directAnswer, offtopic   noul → JudgeDecision.flags
 *
 * The state is kept lean (Jev loses accuracy with irrelevant material): the question (+ a
 * negation hint), the case truth summary, and the candidate facts as {id: text【メモ】note}.
 * Candidate strategies (compared by scripts/bench.ts, see docs/ai.md):
 *   'topk'       retrieval top-8 (input.candidates.facts; can be empty when nothing matches)
 *   'wide'       retrieval candidates, then filled up to 12 by bigram containment over all facts
 *   'all'        every fact of the case
 *   '<set>+prior'  any of the above + the deterministic rules decision as an explicit prior
 *
 * JevVerdictJudge — one call, a noul per answerElement.judgeClaim and per wrongClaim.judgeClaim.
 * JevPostChecker  — local leak check first, then nouls: new information, contradiction with the
 *                   decided class, cause of death / secret terms.
 */
import type { AnswerClass, Case, Fact } from '../../../shared/case-schema.js';
import type {
  Judge, JudgeDecision, JudgeInput, PostChecker, PostCheckInput, PostCheckOutput, QuestionType,
  Usage, VerdictJudge, VerdictJudgeInput, VerdictJudgeOutput,
} from '../judge-types.js';
import { bigrams, containment, isWhQuestion, type MetaKind } from '../normalize.js';
import { ProviderError, type DecisionAnswer, type DecisionProvider, type DecisionQuestion, type DecisionResult } from '../providers/types.js';
import { CLASS_LABEL, foreignFactMentions, leaksIn } from './guards.js';

export type CandidateStrategy = 'topk' | 'wide' | 'all' | 'topk+prior' | 'wide+prior' | 'all+prior';
export const CANDIDATE_STRATEGIES: readonly CandidateStrategy[] = ['topk', 'wide', 'all', 'topk+prior', 'wide+prior', 'all+prior'];
export const WIDE_K = 12;
/** Chosen by the bench experiment (docs/ai.md §3). */
export const DEFAULT_STRATEGY: CandidateStrategy = 'all+prior';

export interface JevJudgeOptions {
  provider: DecisionProvider;
  model?: string;
  strategy?: CandidateStrategy;
  /** Prompt variant (defaults to DEFAULT_PROMPT). */
  prompt?: AskPromptOptions;
}

/* ------------------------------------------------------------------ */
/* Prompt pieces                                                       */
/* ------------------------------------------------------------------ */

export const ANSWER_INSTRUCTIONS =
  '審問官の質問が述べている命題を、事件の真相と所見に照らして判定する。答えはゲームの判定スタンプになる。';

export const ANSWER_CRITERIA: Record<AnswerClass, string> = {
  yes: 'はい: 命題が真相・所見と一致して正しい。否定の確認（〜ではないですよね？）は、否定の内容が正しければ「はい」。',
  no: 'いいえ: 命題が真相・所見に反し誤り。否定の確認は、否定の内容が誤りなら「いいえ」。',
  partial: '一部そう: 命題の一部だけ正しい、条件つきで正しい、または言葉の取り方で正誤が分かれる。',
  irrelevant: '関係ない: 真相にも所見にも無い細部、死因と無関係な事柄、雑談（反対の事実が書かれていれば「いいえ」）。',
  cannot: '答えられない: 死因・真相・名前など答えそのものやヒントを求めている、または死に方・自殺や殺害の方法・致死量など危険な情報を求めている。',
  vague: '具体的に: はい／いいえで答えられない質問（なぜ・どうやって・何・誰・いつ 等）や、意味の取れない入力。',
};

/**
 * Answer criteria v2 (2026-09-25, AI playtest): Jev confirmed plausible-sounding but unsupported
 * propositions — 「ボールが光で溶けた？」→ はい, 「まぶしさの反射で心臓が止まった？」→ はい,
 * 「幻覚の中で岩の隙間を雪洞だと思った？」→ はい. v2 says what yes needs (every part supported),
 * that an invented cause / mechanism is いいえ, and that an unwritten detail is 関係ない.
 */
export const ANSWER_CRITERIA_V2: Record<AnswerClass, string> = {
  yes: 'はい: 命題の中身（原因・仕組み・状態・細部）がすべて真相・所見で裏づけられる。否定の確認（〜ではないですよね？）は、否定の内容が正しければ「はい」。',
  no: 'いいえ: 命題が真相・所見に反し誤り。真相に無い原因・仕組み・出来事を主張している場合も「いいえ」。否定の確認は、否定の内容が誤りなら「いいえ」。',
  partial: '一部そう: 命題の主な部分は正しいが、一部が違う・言い過ぎ・条件つき、または言葉の取り方で正誤が分かれる。',
  irrelevant: '関係ない: 真相にも所見にも書かれていない細部（気持ち・感じたもの・道具の細かな仕様など）、死因と無関係な事柄、雑談。書かれていない細部を推測で「はい」「いいえ」にしない（反対の事実が書かれていれば「いいえ」）。',
  cannot: ANSWER_CRITERIA.cannot,
  vague: ANSWER_CRITERIA.vague,
};

/** Prompt variants compared by the playtest replay (docs/ai.md §3-6). */
export interface AskPromptOptions {
  /** 'plain': 「はい／所見 F08（キーワード一致…）」; 'evidence': also names the matched words and says the draft did not check the rest of the proposition. */
  prior?: 'plain' | 'evidence';
  criteria?: 'v1' | 'v2';
}
/**
 * v2 since 2026-09-25: AI-playtest replay 21 → 29 / 44 hand-labelled questions, stratified bench
 * sample 77 → 80 / 90 (irrelevant +2, ambiguous +1, no class lost net). docs/ai.md §3-6.
 */
export const DEFAULT_PROMPT: Required<AskPromptOptions> = { prior: 'evidence', criteria: 'v2' };

const QTYPE_CRITERIA: Record<Exclude<QuestionType, 'unknown'>, string> = {
  yesno: 'はい／いいえで答えられる確認（否定の確認も含む）',
  open: 'なぜ・どうやって・何・誰・いつ 等、内容を説明させる質問',
  meta: '答えやヒントの要求、遊び方、案内役自身への質問、あいさつ・雑談',
};

const CLOSENESS_CRITERIA = ['死因と無関係', '周辺の手がかり', '死因につながる重要な手がかり', '死因や死の仕組みそのもの'];

const FLAG_QUESTIONS: Record<'selfHarm' | 'directAnswer' | 'offtopic', string> = {
  selfHarm: '質問者が自殺・自傷・殺害の方法、楽に死ねるか、何分で死ぬか、致死量など死ぬ／殺すための情報を求めている、または死にたいと打ち明けている（被害者の死が自殺だったかを確認するだけの質問は除く）',
  directAnswer: '死因・真相・答え・被害者の名前を直接教えるよう求めている（はい／いいえの確認は除く）',
  offtopic: '事件と無関係な雑談・あいさつ・案内役への個人的な質問',
};

const FACT_NONE = 'NONE';
const MAX_NOTE = 140;

function factLine(f: Fact): string {
  const note = f.judgeNote ? `【メモ】${f.judgeNote.length > MAX_NOTE ? `${f.judgeNote.slice(0, MAX_NOTE)}…` : f.judgeNote}` : '';
  return `${f.text}${note}`;
}

function factLabel(f: Fact): string {
  const t = f.cardTitle ?? f.text;
  return `${f.id}: ${t.length > 34 ? `${t.slice(0, 34)}…` : t}`;
}

function rulesPrior(input: JudgeInput, style: AskPromptOptions['prior'] = 'plain'): string {
  const r = input.rules;
  const facts = r.factIds.length > 0 ? `／所見 ${r.factIds.join(',')}` : '';
  if (style === 'evidence' && r.source === 'keyword') {
    const hits = input.candidates.facts.find((f) => f.id === r.factIds[0])?.hits ?? [];
    const words = hits.length > 0 ? hits.slice(0, 4).map((h) => `「${h}」`).join('') : 'いくつかの語';
    return `${CLASS_LABEL[r.answerClass]}${facts}（質問の${words}が所見の語と一致しただけの機械的な下書き。質問が述べる原因・仕組み・細部が正しいかは確かめていない。確かさ ${Math.round(r.confidence * 100)}%）`;
  }
  const how =
    r.source === 'probe' ? `想定質問「${r.probe?.q ?? ''}」との類似 ${Math.round((r.probe?.score ?? 0) * 100)}%`
      : r.source === 'keyword' ? 'キーワード一致'
        : r.source === 'meta' ? '答え・ヒントの要求や雑談の定型パターン'
          : r.source === 'open' ? '疑問詞の質問'
            : '手がかりなし';
  return `${CLASS_LABEL[r.answerClass]}${facts}（${how}。確かさ ${Math.round(r.confidence * 100)}%。誤っていることもある）`;
}

export interface AskRequestBuild {
  state: Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  candidateIds: string[];
}

/** Retrieval candidates first, then the facts sharing most bigrams with the question, up to k. */
export function wideCandidates(input: JudgeInput, k = WIDE_K): Fact[] {
  const out = input.candidates.facts.map((s) => s.entry.fact).slice(0, k);
  const have = new Set(out.map((f) => f.id));
  const q = bigrams(input.question.core);
  const rest = input.index.facts
    .filter((e) => !have.has(e.fact.id))
    .map((e) => ({ f: e.fact, s: containment(q, e.grams) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.f.importance - a.f.importance);
  for (const x of rest) {
    if (out.length >= k) break;
    out.push(x.f);
  }
  return out;
}

/** Builds the Jev state + questions for one atomic question. Exported for tests / bench. */
export function buildAskRequest(input: JudgeInput, strategy: CandidateStrategy = DEFAULT_STRATEGY, prompt: AskPromptOptions = DEFAULT_PROMPT): AskRequestBuild {
  const c = input.caseData;
  const base = strategy.split('+')[0];
  const facts: Fact[] =
    base === 'topk'
      ? input.candidates.facts.map((s) => s.entry.fact)
      : base === 'wide'
        ? wideCandidates(input)
        : c.facts.filter((f) => !f.manner); // the manner fact is sealed (manner.ts)
  const candidateIds = [...new Set(facts.map((f) => f.id))];
  const byId = new Map(c.facts.map((f) => [f.id, f]));

  const state: Record<string, unknown> = { 質問: input.question.raw };
  if (input.question.negated) state['質問の形'] = '否定の確認（「〜ではないですよね？」型）。否定の内容が正しければ「はい」、誤りなら「いいえ」。';
  state['事件の真相'] = c.truth.summary;
  state['所見'] = Object.fromEntries(candidateIds.map((id) => [id, factLine(byId.get(id)!)]));
  if (strategy.endsWith('+prior')) state['規則による下書きの判定'] = rulesPrior(input, prompt.prior ?? DEFAULT_PROMPT.prior);

  const factCriteria: Record<string, string> = {};
  for (const id of candidateIds) factCriteria[id] = factLabel(byId.get(id)!);
  factCriteria[FACT_NONE] = 'どの所見にも当たらない（雑談・無関係な細部・答えやヒントの要求など）';

  const questions: Record<string, DecisionQuestion> = {
    answer: { type: 'choice', instructions: ANSWER_INSTRUCTIONS, criteria: { ...((prompt.criteria ?? DEFAULT_PROMPT.criteria) === 'v2' ? ANSWER_CRITERIA_V2 : ANSWER_CRITERIA) } },
    fact: { type: 'choice', instructions: 'この質問が直接たずねている所見はどれか。', criteria: factCriteria },
    qtype: { type: 'choice', instructions: '質問の形はどれか。', criteria: { ...QTYPE_CRITERIA } },
    closeness: { type: 'score', instructions: 'この質問は、死因の核心にどれだけ近いか。', criteria: CLOSENESS_CRITERIA },
    selfHarm: { type: 'noul', instructions: FLAG_QUESTIONS.selfHarm },
    directAnswer: { type: 'noul', instructions: FLAG_QUESTIONS.directAnswer },
    offtopic: { type: 'noul', instructions: FLAG_QUESTIONS.offtopic },
  };
  return { state, questions, candidateIds };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function choiceOf(a: DecisionAnswer | undefined): Extract<DecisionAnswer, { type: 'choice' }> | undefined {
  return a && a.type === 'choice' ? a : undefined;
}
function noulOf(a: DecisionAnswer | undefined): number {
  return a && a.type === 'noul' ? a.noul : 0;
}

export const FACT_MIN_TOP = 0.3;
export const FACT_MIN_OTHER = 0.35;
/** Pipeline contract: flags.selfHarm ≥ 0.5 → serious refusal + support notice (safety.ts). */
export const SELF_HARM_THRESHOLD = 0.5;
/**
 * Operating point for the raw Jev noul, chosen on the bench (docs/ai.md §3): raw ≥ 0.30 caught
 * 45/50 authored safety probes with 0 false positives on 763 other probes, while raw ≥ 0.5 caught
 * only 40/50. `flags.selfHarm` is therefore reported CALIBRATED (raw × 0.5/0.30, capped at 1) so
 * that this operating point lands on the pipeline's 0.5 threshold; the raw value stays in `raw`.
 */
export const SELF_HARM_RAW_THRESHOLD = 0.3;
export function calibrateSelfHarm(raw: number): number {
  return Math.min(1, Math.max(0, raw) * (SELF_HARM_THRESHOLD / SELF_HARM_RAW_THRESHOLD));
}
export const DIRECT_ANSWER_THRESHOLD = 0.7;

const META_CLASS: Partial<Record<MetaKind, AnswerClass>> = { askAnswer: 'cannot', askHint: 'cannot', offtopic: 'irrelevant', aboutHolma: 'irrelevant' };

/** Maps a Jev result to a JudgeDecision. Exported for tests. */
export function mapAskDecision(res: DecisionResult, build: AskRequestBuild, input: JudgeInput, strategy: CandidateStrategy): JudgeDecision {
  const ans = choiceOf(res.answers.answer);
  if (!ans) throw new ProviderError('jev', 'server', 'no answer choice');
  let answerClass = ans.choice as AnswerClass;
  const confidence = ans.confidence;

  const fact = choiceOf(res.answers.fact);
  const ranked = build.candidateIds
    .map((id) => ({ id, p: fact?.probabilities[id] ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const factIds: string[] = [];
  const factStrength: Record<string, number> = {};
  ranked.forEach((x, i) => {
    if (factIds.length >= 3) return;
    if ((i === 0 && x.p >= FACT_MIN_TOP) || x.p >= FACT_MIN_OTHER) {
      factIds.push(x.id);
      factStrength[x.id] = r3(x.p);
    }
  });

  const q = choiceOf(res.answers.qtype);
  const qtype = (q?.choice as QuestionType | undefined) ?? 'unknown';
  const sc = res.answers.closeness;
  const closeness = (sc && sc.type === 'score' ? Math.min(3, Math.max(0, Math.round(sc.score))) : 0) as 0 | 1 | 2 | 3;
  const flagsRaw = { selfHarm: r3(noulOf(res.answers.selfHarm)), directAnswer: r3(noulOf(res.answers.directAnswer)), offtopic: r3(noulOf(res.answers.offtopic)) };
  const flags = { ...flagsRaw, selfHarm: r3(calibrateSelfHarm(flagsRaw.selfHarm)) };

  // Meta kind for the canned line bank: keep the rules' meta when Jev agrees with its class,
  // otherwise derive it from the flags.
  let meta: JudgeDecision['meta'];
  const rm = input.rules.meta;
  // Hybrid guard (docs/ai.md §3): Jev tends to call 「答えは何ですか？」 an open question (vague)
  // and 「ホルマは何歳？」 vague. The rules' regex metas and a strong directAnswer flag win over
  // a non-polar Jev answer; a yes / no / partial from Jev is never overridden here.
  // 「犯人は誰ですか」「なぜ〜？」: a polar stamp would be nonsense (and Jev's 'no' here varied by
  // case in the bench). The wh-predicate / why-how forms are always 具体的に (normalize.ts).
  // Also the wh-argument forms (「どこで見つかったの？」「何を吸ったの？」): isWhQuestion.
  let forcedOpen = false;
  const wh = isWhQuestion(input.question.norm);
  if ((answerClass === 'yes' || answerClass === 'no' || answerClass === 'partial') && wh) {
    answerClass = 'vague';
    forcedOpen = true;
  }
  // 「毒ガスが出ていましたか？」: the rules found a qualifier that a ruled-out fact denies (the gas
  // was not poisonous). Jev may still confirm the topic — that would be a lie → the rules' answer
  // (一部そう for a modifier, いいえ for 「窒素ガスは有毒ですか？」), and the ruling-out fact leads
  // the cards (rules-judge.ts ruledOutQualifier).
  let qualifierGuard = false;
  if (answerClass === 'yes' && input.rules.qualifier) {
    answerClass = input.rules.answerClass === 'no' ? 'no' : 'partial';
    qualifierGuard = true;
    const denying = input.rules.factIds[0];
    if (denying && !factIds.includes(denying)) {
      factIds.unshift(denying);
      factStrength[denying] = r3(input.rules.factStrength?.[denying] ?? input.rules.confidence);
      if (factIds.length > 3) factIds.length = 3;
    } else if (denying) {
      factIds.splice(factIds.indexOf(denying), 1);
      factIds.unshift(denying);
    }
  }
  const polar = answerClass === 'yes' || answerClass === 'no' || answerClass === 'partial';
  if (!polar) {
    const pCannot = ans.probabilities.cannot ?? 0;
    if (input.rules.source === 'meta' && (rm === 'askAnswer' || rm === 'askHint')) answerClass = 'cannot';
    else if (flags.directAnswer >= DIRECT_ANSWER_THRESHOLD && pCannot >= 0.3) {
      answerClass = 'cannot';
      meta = 'askAnswer';
    } else if (input.rules.source === 'meta' && (rm === 'offtopic' || rm === 'aboutHolma')) answerClass = 'irrelevant';
  }
  if (meta) {
    /* set by the guard */
  } else if (rm && rm !== 'open' && META_CLASS[rm] === answerClass) meta = rm;
  else if (answerClass === 'cannot' && flags.directAnswer >= 0.5) meta = 'askAnswer';
  else if (answerClass === 'irrelevant' && flags.offtopic >= 0.6 && qtype === 'meta') meta = 'offtopic';
  // Any 'vague' to a wh-question is the rephrasing advice (lines.ts OPEN_LINES), not 「具体的に」.
  else if (answerClass === 'vague' && (qtype === 'open' || forcedOpen || wh || rm === 'open')) meta = 'open';

  let ids = factIds;
  if (flags.selfHarm >= SELF_HARM_THRESHOLD) {
    answerClass = 'cannot';
    ids = [];
    meta = undefined;
  }

  return {
    answerClass,
    factIds: ids,
    confidence: r3(confidence),
    closeness,
    qtype,
    source: 'model',
    meta,
    factStrength: ids.length > 0 ? factStrength : undefined,
    flags,
    usage: res.usage,
    latencyMs: res.latencyMs,
    raw: {
      strategy,
      answer: Object.fromEntries(Object.entries(ans.probabilities).filter(([, p]) => p >= 0.01).map(([k, p]) => [k, r3(p)])),
      fact: ranked.slice(0, 3).map((x) => [x.id, r3(x.p)]).concat([[FACT_NONE, r3(fact?.probabilities[FACT_NONE] ?? 0)]]),
      qtype,
      closeness: sc && sc.type === 'score' ? r3(sc.score) : undefined,
      flags: flagsRaw,
      candidates: build.candidateIds.length,
      forcedOpen: forcedOpen || undefined,
      qualifierGuard: qualifierGuard || undefined,
      provider: res.raw,
    },
  };
}

export class JevJudge implements Judge {
  readonly name: string;
  readonly strategy: CandidateStrategy;
  readonly prompt: AskPromptOptions;
  private readonly provider: DecisionProvider;

  constructor(opts: JevJudgeOptions) {
    if (!opts?.provider) throw new ProviderError('jev', 'config', 'JevJudge needs a DecisionProvider');
    this.provider = opts.provider;
    this.strategy = opts.strategy ?? DEFAULT_STRATEGY;
    this.prompt = { ...DEFAULT_PROMPT, ...(opts.prompt ?? {}) };
    this.name = `jev-judge:${this.strategy}`;
  }

  async judge(input: JudgeInput): Promise<JudgeDecision> {
    const build = buildAskRequest(input, this.strategy, this.prompt);
    const res = await this.provider.decide(build.state, build.questions, { signal: input.signal, timeoutMs: input.timeoutMs });
    return mapAskDecision(res, build, input, this.strategy);
  }

  /**
   * Wake-up call (≈ 60 tokens, ≈ $0.000003). Measured 2026-09-25: after ~25 min without traffic
   * the first three all+prior calls of a session each exceeded the 4.5 s judge timeout, so the
   * player's first question fell back to the rules judge (notice 'degraded'). Never throws.
   */
  async warm(signal?: AbortSignal): Promise<Usage | undefined> {
    try {
      const r = await this.provider.decide({ 質問: '準備はできましたか？' }, { ok: { type: 'noul', instructions: '質問が日本語である' } }, { signal, timeoutMs: WARM_TIMEOUT_MS });
      return r.usage;
    } catch {
      return undefined;
    }
  }
}

export const WARM_TIMEOUT_MS = 15000;

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

const ELEMENT_SUFFIX = '（言葉や言い回しが違っても、同じ意味のことを述べていれば当てはまる）';
const WRONG_SUFFIX = '（その可能性を否定している・退けているだけなら当てはまらない）';

export function buildVerdictRequest(c: Case, text: string): { state: Record<string, unknown>; questions: Record<string, DecisionQuestion>; elementKeys: Record<string, string>; wrongKeys: Record<string, string> } {
  const questions: Record<string, DecisionQuestion> = {};
  const elementKeys: Record<string, string> = {};
  const wrongKeys: Record<string, string> = {};
  c.answerElements.forEach((el, i) => {
    const k = `e${i}`;
    elementKeys[k] = el.id;
    questions[k] = { type: 'noul', instructions: `${el.judgeClaim}${ELEMENT_SUFFIX}` };
  });
  c.wrongClaims.forEach((w, i) => {
    const k = `w${i}`;
    wrongKeys[k] = w.id;
    questions[k] = { type: 'noul', instructions: `${w.judgeClaim}${WRONG_SUFFIX}` };
  });
  return { state: { 推理文: text }, questions, elementKeys, wrongKeys };
}

export class JevVerdictJudge implements VerdictJudge {
  readonly name = 'jev-verdict';
  private readonly provider: DecisionProvider;
  constructor(opts: JevJudgeOptions) {
    if (!opts?.provider) throw new ProviderError('jev', 'config', 'JevVerdictJudge needs a DecisionProvider');
    this.provider = opts.provider;
  }

  async judge(input: VerdictJudgeInput): Promise<VerdictJudgeOutput> {
    const b = buildVerdictRequest(input.caseData, input.text);
    const res = await this.provider.decide(b.state, b.questions, { signal: input.signal, timeoutMs: input.timeoutMs });
    const elements: Record<string, number> = {};
    const wrongClaims: Record<string, number> = {};
    for (const [k, id] of Object.entries(b.elementKeys)) elements[id] = r3(noulOf(res.answers[k]));
    for (const [k, id] of Object.entries(b.wrongKeys)) wrongClaims[id] = r3(noulOf(res.answers[k]));
    return { elements, wrongClaims, usage: res.usage, latencyMs: res.latencyMs, raw: { elements, wrongClaims, provider: res.raw } };
  }
}

/* ------------------------------------------------------------------ */
/* Post-check                                                          */
/* ------------------------------------------------------------------ */

/**
 * Thresholds calibrated on 39 lines (scripts/bench/postcheck-calibrate.ts, docs/ai.md §5):
 * Jev's nouls are noisy on free text — canned 「関係ありません。寄り道も、ほどほどに。」 scored
 * newInfo 0.80 while an LLM line adding 「心臓の上あたり」 scored 0.15 — so the deterministic
 * checks (leak terms, keywords of facts the player does not hold) run first and decide most
 * cases; the nouls only veto clear cases, and only where they were informative:
 *   newInfo      ≥ 0.70, yes / no / partial lines only
 *   contradicts  ≥ 0.50, not for cannot / vague (their lines are not polar)
 *   secret       ≥ 0.60 (canned lines reached 0.45 in case 3)
 */
export const POSTCHECK_THRESHOLD = { newInfo: 0.7, contradicts: 0.5, secret: 0.6 } as const;
const MAX_TERMS_IN_PROMPT = 24;

export function buildPostCheckRequest(input: PostCheckInput): { state: Record<string, unknown>; questions: Record<string, DecisionQuestion> } {
  const terms = [...new Set([input.caseData.truth.causeOfDeath.split(/[（(]/u)[0], ...input.caseData.leakTerms])]
    .filter((t) => t && t.length >= 2 && !/^[\x00-\x7f]+$/.test(t))
    .slice(0, MAX_TERMS_IN_PROMPT);
  const state = {
    質問: input.question,
    決まった答え: CLASS_LABEL[input.answerClass],
    ホルマの返答: input.line,
    許された所見: input.allowedFacts.map((f) => f.text),
  };
  const questions: Record<string, DecisionQuestion> = {
    newInfo: { type: 'noul', instructions: 'ホルマの返答は、「許された所見」にも質問にも書かれていない事件の事実（新しい情報・推測）を述べている。口調や言い回し、答えの言い換えだけなら当てはまらない。' },
    contradicts: { type: 'noul', instructions: `ホルマの返答は、決まった答え「${CLASS_LABEL[input.answerClass]}」と食い違う（別の答えを示している、または答えがはっきりしない）。` },
    secret: { type: 'noul', instructions: `ホルマの返答は、死因や、次の秘密の語のいずれかを述べている・ほのめかしている: ${terms.join('、')}` },
  };
  return { state, questions };
}

export class JevPostChecker implements PostChecker {
  readonly name = 'jev-check';
  private readonly provider: DecisionProvider;
  constructor(opts: JevJudgeOptions) {
    if (!opts?.provider) throw new ProviderError('jev', 'config', 'JevPostChecker needs a DecisionProvider');
    this.provider = opts.provider;
  }

  async check(input: PostCheckInput): Promise<PostCheckOutput> {
    const local = leaksIn(input.line, input.leakTerms, input.allowedFacts);
    if (local.length > 0) {
      return { pass: false, reasons: ['leak'], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 0, raw: { local } };
    }
    const foreign = foreignFactMentions(input.line, input.question, input.caseData.facts, new Set(input.allowedFacts.map((f) => f.id)));
    if (foreign.length > 0) {
      return { pass: false, reasons: ['new-fact'], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 0, raw: { foreign } };
    }
    const b = buildPostCheckRequest(input);
    const res = await this.provider.decide(b.state, b.questions, { signal: input.signal, timeoutMs: input.timeoutMs });
    const p = { newInfo: r3(noulOf(res.answers.newInfo)), contradicts: r3(noulOf(res.answers.contradicts)), secret: r3(noulOf(res.answers.secret)) };
    const reasons: string[] = [];
    const cls = input.answerClass;
    const polarClass = cls === 'yes' || cls === 'no' || cls === 'partial';
    if (polarClass && p.newInfo >= POSTCHECK_THRESHOLD.newInfo) reasons.push('new-fact');
    if (cls !== 'cannot' && cls !== 'vague' && p.contradicts >= POSTCHECK_THRESHOLD.contradicts) reasons.push('polarity');
    if (p.secret >= POSTCHECK_THRESHOLD.secret) reasons.push('secret');
    return { pass: reasons.length === 0, reasons, usage: res.usage, latencyMs: res.latencyMs, raw: { ...p, provider: res.raw } };
  }
}
