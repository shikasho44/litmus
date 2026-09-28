/**
 * GameService — the server-side implementation of every GameApi method.
 *
 * Framework-free and Node-free: used by the HTTP handler (dev server, preview, Vercel)
 * and directly by the embedded browser client (static build). Every call that changes
 * progress verifies the incoming token and returns a freshly signed one.
 */
import type {
  AskRequest, AskResponse, CasePublic, CaseSummary, GrantRequest, HintRequest, HintResponse,
  InquestStartRequest, InquestStartResponse, PipelineMode, ProgressSnapshot, ProgressToken,
  PublicFact, ReconstructionRequest, ReconstructionResult, ReconstructionSubmit, ReconstructionView,
  ShotRequest, ShotResponse, SolutionResponse, VerdictMode, VerdictRequest, VerdictResponse, VerdictSetupRequest,
  VerdictSetupResponse,
} from '../../shared/api.js';
import { badRequest, forbidden, notFound, rateLimited } from './errors.js';
import type { PipelineComponents, VerdictJudgeOutput } from './judge-types.js';
import type { BudgetGuard } from './budget.js';
import type { ContentRegistry, LoadedCase } from './registry.js';
import { texts } from './lines.js';
import { MAX_QUESTION_CHARS, normalize, softNormalize } from './normalize.js';
import { callModel, REDACTED, runAsk, STAGE_TIMEOUT_MS, TURN_DEADLINE_MS } from './pipeline.js';
import { detectSafety, safetyLine } from './safety.js';
import { memoIdForFact, initialState, sanitizeState, snapshot, type GameState } from './state.js';
import { roomDifficulty } from './room-binding.js';
import { signToken, verifyToken } from './token.js';
import { VERDICT_MODE_BY_DIFFICULTY } from '../../shared/api.js';
import { budgetRule, questionBudget } from '../../shared/budget.js';
import { optionOrder, parseSegments, publicFact, reconstructionView, roundViews, solutionView, toPublic, toSummary, verdictSetupView } from './public-view.js';
import { evaluateVerdict } from './verdict.js';
import { judgeChoice, judgeCloze, parseVerdictMode, type PickVerdict } from './verdict-modes.js';
import { StageTimer, traceId, type EngineTrace, type TraceSink } from './trace.js';

export const MAX_VERDICT_CHARS = 600;
/** Holma's line when a question arrives after the hard question budget is used up (not counted). */
export const BUDGET_CLOSED_LINE = '……質問は、もう締め切りましたよ。あとは集めた所見で、審問に臨みなさい。';
export const DEFAULT_QUESTION_CAP = 400;
/** At most one judge wake-up call per this interval (per server instance). */
export const WARM_INTERVAL_MS = 120_000;

export interface GameServiceOptions {
  /** Returns the current registry (may reload content in dev). */
  content: () => ContentRegistry | Promise<ContentRegistry>;
  secret: string;
  components: PipelineComponents;
  /** Builds components for an admin mode override (ask-debug). */
  componentsFor?: (mode: PipelineMode) => PipelineComponents;
  /** Dev: unpublished cases visible, traces attached to responses. */
  dev?: boolean;
  budget?: BudgetGuard;
  traces?: TraceSink;
  questionCap?: number;
  clock?: () => number;
}

export interface CallOptions {
  /** Admin caller (x-admin-token or dev): unpublished cases, traces. */
  admin?: boolean;
  /** Attach TurnTrace to the response. */
  withTrace?: boolean;
  /** Admin-only pipeline mode override. */
  mode?: PipelineMode;
}

const str = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== 'string' || v.length === 0) throw badRequest(`${name} is required`);
  if (v.length > max) throw badRequest(`${name} is too long`);
  return v;
};

export class GameService {
  private readonly clock: () => number;
  private readonly questionCap: number;
  private lastWarm = -Infinity;
  /** The pending wake-up call (tests and the Vercel entry may await it). */
  warming?: Promise<void>;

  constructor(private readonly opts: GameServiceOptions) {
    this.clock = opts.clock ?? Date.now;
    this.questionCap = opts.questionCap ?? DEFAULT_QUESTION_CAP;
  }

  get components(): PipelineComponents {
    return this.opts.components;
  }

  async registry(): Promise<ContentRegistry> {
    return this.opts.content();
  }

  private visible(o?: CallOptions): boolean {
    return !!(this.opts.dev || o?.admin);
  }

  private async loaded(caseId: unknown, o?: CallOptions): Promise<LoadedCase> {
    const id = str(caseId, 'caseId', 80);
    const reg = await this.registry();
    const c = reg.get(id, this.visible(o));
    if (!c) throw notFound(`unknown case: ${id}`);
    return c;
  }

  private async state(c: LoadedCase, token: unknown): Promise<GameState> {
    const s = await verifyToken(token, this.opts.secret, c.data.id, this.clock());
    return sanitizeState(c.data, s);
  }

  private async issue(c: LoadedCase, s: GameState): Promise<{ token: ProgressToken; progress: ProgressSnapshot }> {
    return { token: await signToken(s, this.opts.secret, this.clock()), progress: snapshot(c.data, s) };
  }

  /**
   * Online versus: a run bound to a room declares its verdict in the room difficulty's format
   * (a case without verdictModes falls back to free text for everyone, as the UI does).
   */
  private checkRoomMode(c: LoadedCase, s: GameState, mode: VerdictMode): void {
    const d = roomDifficulty(s.room);
    if (!d) return;
    const want: VerdictMode = c.data.verdictModes ? VERDICT_MODE_BY_DIFFICULTY[d] : 'free';
    if (mode !== want) throw badRequest(`this room-bound run declares its verdict as ${want}`);
  }

  /**
   * The hard question budget this ask runs under (shared/budget.ts), or undefined for none.
   * A room-bound versus run: its room difficulty's budget when that is a hard one (教授), whatever
   * the client sends. Otherwise the client's own declared limit (single player enforces its
   * budget in the browser; declaring it lets the server cut a multi-question message exactly).
   */
  private questionLimit(c: LoadedCase, s: GameState, requested: unknown): number | undefined {
    const d = roomDifficulty(s.room);
    if (d) return budgetRule(d).kind === 'hard' ? questionBudget(c.data.difficulty, d, c.data.questionBudget) : undefined;
    return typeof requested === 'number' && Number.isInteger(requested) && requested > 0 && requested <= 10_000 ? requested : undefined;
  }

  /* ---------------------------------------------------------------- */

  async listCases(o?: CallOptions): Promise<CaseSummary[]> {
    const reg = await this.registry();
    return reg.list(this.visible(o)).map((c) => toSummary(c.data));
  }

  async getCase(caseId: string, o?: CallOptions): Promise<CasePublic> {
    return toPublic((await this.loaded(caseId, o)).data);
  }

  async newToken(caseId: string, o?: CallOptions): Promise<{ token: ProgressToken; progress: ProgressSnapshot }> {
    const c = await this.loaded(caseId, o);
    this.warmJudge();
    return this.issue(c, initialState(c.data, this.clock()));
  }

  /**
   * A player is starting a case: wake the model judge up in the background (fire-and-forget,
   * throttled) so the first question — asked after the intro — does not hit a cold provider.
   */
  warmJudge(): void {
    const judge = this.opts.components.judge;
    const now = this.clock();
    if (!judge?.warm || now - this.lastWarm < WARM_INTERVAL_MS || this.opts.budget?.exceeded()) return;
    this.lastWarm = now;
    this.warming = judge.warm().then((u) => {
      if (u) this.opts.budget?.add(u.costUsd);
    }, () => undefined);
  }

  /**
   * DEV/ADMIN ONLY (routed under /api/admin/mint-token). Issues a token at a chosen stage so
   * scene builders and QA can jump straight to the inquest / solution without playing.
   *   stage 'fresh'        → initial state
   *   stage 'investigated' → every fact with spoilerLevel ≤ 3 unlocked (+ their memos)
   *   stage 'debated'      → investigated + all debate rounds cleared
   *   stage 'solved'       → debated + verdict accepted
   *   stage 'reconstructed'→ solved + reconstruction complete
   */
  async mintToken(
    caseId: string,
    stage: 'fresh' | 'investigated' | 'debated' | 'solved' | 'reconstructed',
    o?: CallOptions,
    /** QA: start with this many questions already asked (all counted against the budget). */
    asked?: number,
  ): Promise<{ token: ProgressToken; progress: ProgressSnapshot }> {
    const c = await this.loaded(caseId, o);
    const s = initialState(c.data, this.clock());
    const order = ['fresh', 'investigated', 'debated', 'solved', 'reconstructed'];
    const at = Math.max(0, order.indexOf(stage));
    if (at >= 1) {
      for (const f of c.data.facts) {
        if (f.spoilerLevel <= 3 && !s.unlocked.includes(f.id)) s.unlocked.push(f.id);
        if (f.spoilerLevel <= 3 && f.scienceMemo && !s.memos.includes(f.scienceMemo)) s.memos.push(f.scienceMemo);
      }
      s.asked = Math.max(s.asked, 20);
      s.spent = s.asked;
    }
    if (typeof asked === 'number' && Number.isInteger(asked) && asked >= 0 && asked <= this.questionCap) {
      s.asked = asked;
      s.spent = asked;
    }
    if (at >= 2) s.cleared = c.data.debate.map((r) => r.id);
    if (at >= 3) { s.solved = true; s.verdictAttempts = Math.max(1, s.verdictAttempts); s.nearCore = true; }
    if (at >= 4) s.reconstructed = true;
    return this.issue(c, sanitizeState(c.data, s));
  }

  async ask(req: AskRequest, o?: CallOptions): Promise<AskResponse> {
    const c = await this.loaded(req?.caseId, o);
    if (typeof req.question !== 'string') throw badRequest('question is required');
    const question = req.question.trim();
    const state = req.token === undefined || req.token === null || req.token === '' ? initialState(c.data, this.clock()) : await this.state(c, req.token);
    if (state.asked >= this.questionCap) throw rateLimited(`question cap reached (${this.questionCap}) for this progress token`, false);
    const reg = await this.registry();

    // The hard question budget is used up: Holma declines, nothing is judged or counted.
    const limit = this.questionLimit(c, state, req.limit);
    if (limit !== undefined && state.spent >= limit) {
      const closed: AskResponse = {
        answers: [{ question: question.slice(0, MAX_QUESTION_CHARS), answerClass: 'cannot', line: BUDGET_CLOSED_LINE, mood: 'serious', unlocked: [], memos: [], free: true }],
        ...(await this.issue(c, state)),
      };
      return closed;
    }

    const components = o?.mode && o.admin && this.opts.componentsFor ? this.opts.componentsFor(o.mode) : this.opts.components;
    const outcome = await runAsk({
      loaded: c,
      lines: reg.lines,
      question,
      state,
      components,
      budget: this.opts.budget,
      deadlineMs: TURN_DEADLINE_MS,
      limit,
    });
    this.opts.traces?.write({
      id: traceId(),
      at: new Date(this.clock()).toISOString(),
      kind: 'ask',
      caseId: c.data.id,
      // Questions the safety filter answered are never logged (traces keep only the rule id).
      input: outcome.safety ? REDACTED : question.slice(0, MAX_QUESTION_CHARS + 20),
      result: outcome.answers.map((a) => a.answerClass),
      trace: outcome.trace,
    });
    // A versus run stays bound to its room whatever the pipeline returns.
    const next = outcome.state.room === state.room ? outcome.state : { ...outcome.state, room: state.room };
    const issued = await this.issue(c, next);
    const res: AskResponse = { answers: outcome.answers, ...issued };
    if (o?.withTrace) res.trace = outcome.trace;
    return res;
  }

  async hint(req: HintRequest, o?: CallOptions): Promise<HintResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    const hints = [...c.data.hints].sort((a, b) => a.level - b.level);
    const next = Math.min(s.hintsUsed + 1, hints.length);
    const h = hints[next - 1];
    const ns: GameState = s.hintsUsed < hints.length ? { ...s, hintsUsed: s.hintsUsed + 1 } : s;
    return { level: h.level, text: h.text, ...(await this.issue(c, ns)) };
  }

  private evidence(c: LoadedCase, s: GameState): PublicFact[] {
    return s.unlocked
      .map((id) => c.index.factById.get(id)?.fact)
      .filter((f): f is NonNullable<typeof f> => !!f && f.importance >= 1 && f.spoilerLevel < 4)
      .map(publicFact);
  }

  async inquestStart(req: InquestStartRequest, o?: CallOptions): Promise<InquestStartResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    return { rounds: roundViews(c.data), evidence: this.evidence(c, s), ...(await this.issue(c, s)) };
  }

  async shot(req: ShotRequest, o?: CallOptions): Promise<ShotResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    const round = c.data.debate.find((r) => r.id === req.roundId);
    if (!round) throw badRequest(`unknown round: ${String(req.roundId)}`);
    const stmt = round.statements.find((x) => x.id === req.statementId);
    if (!stmt) throw badRequest(`unknown statement: ${String(req.statementId)}`);
    const factId = str(req.factId, 'factId', 16);
    const span = typeof req.span === 'string' ? req.span.slice(0, 200) : '';
    if (!s.unlocked.includes(factId)) throw badRequest('that evidence has not been collected');
    const lines = await this.registry().then((r) => r.lines);

    // Success lines are Jane's corrected memory; every other shot line is Holma's.
    if (s.cleared.includes(round.id)) {
      return { correct: true, lines: [...round.success], speaker: 'jane', ...(await this.issue(c, s)) };
    }

    const answerStmt = round.statements.find((x) => x.id === round.answer.statement);
    const answerNoise = answerStmt ? parseSegments(answerStmt.text).find((x) => x.noise && x.text.includes(round.answer.span))?.text : undefined;
    const sentSpan = softNormalize(span);
    const spanOk = sentSpan === softNormalize(round.answer.span) || (answerNoise !== undefined && sentSpan === softNormalize(answerNoise));
    const factOk = factId === round.answer.fact || round.alsoAccept.includes(factId);
    const correct = req.statementId === round.answer.statement && spanOk && factOk;

    if (correct) {
      const ns: GameState = { ...s, cleared: [...s.cleared, round.id] };
      return { correct: true, lines: [...round.success], speaker: 'jane', ...(await this.issue(c, ns)) };
    }
    const misses = (s.roundMisses[round.id] ?? 0) + 1;
    const ns: GameState = { ...s, debateMisses: s.debateMisses + 1, roundMisses: { ...s.roundMisses, [round.id]: misses } };
    const pool = round.wrongShot.length > 0 ? round.wrongShot : texts(lines.lines.inquest.wrongShot);
    const res: ShotResponse = { correct: false, lines: [lines.pick(pool, ns.debateMisses, `shot.${round.id}`).text], speaker: 'holma', ...(await this.issue(c, ns)) };
    if (misses >= 2) res.hint = round.hint;
    return res;
  }

  async grant(req: GrantRequest, o?: CallOptions): Promise<ShotResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    const round = c.data.debate.find((r) => r.id === req.roundId);
    if (!round) throw badRequest(`unknown round: ${String(req.roundId)}`);
    const fact = c.index.factById.get(round.answer.fact)?.fact;
    if (!fact) throw badRequest('round has no answer fact');
    if (s.unlocked.includes(fact.id)) {
      // Already held: no penalty, point at it.
      return { correct: false, lines: [round.hint], speaker: 'holma', granted: publicFact(fact), ...(await this.issue(c, s)) };
    }
    const lines = (await this.registry()).lines;
    const memo = memoIdForFact(c.data, fact.id);
    const ns: GameState = {
      ...s,
      unlocked: [...s.unlocked, fact.id],
      memos: memo && !s.memos.includes(memo) ? [...s.memos, memo] : s.memos,
      grants: s.grants + 1,
    };
    return { correct: false, lines: [lines.pick(lines.lines.inquest.grant, ns.grants, 'grant').text], speaker: 'holma', granted: publicFact(fact), ...(await this.issue(c, ns)) };
  }

  /**
   * The verdict screen for a difficulty's mode (choice / cloze / free) with the assists earned by
   * the cleared debate rounds applied. Read-only: verifies the token, issues no new one.
   */
  async verdictSetup(req: VerdictSetupRequest, o?: CallOptions): Promise<VerdictSetupResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    const mode = parseVerdictMode(req.mode);
    this.checkRoomMode(c, s, c.data.verdictModes ? mode : 'free');
    return verdictSetupView(c.data, s.cleared, mode);
  }

  async verdict(req: VerdictRequest, o?: CallOptions): Promise<VerdictResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    const mode = parseVerdictMode(req.mode, 'free');
    this.checkRoomMode(c, s, mode);
    if (mode !== 'free') return this.pickVerdict(c, s, mode, req, o);
    if (typeof req.text !== 'string' || req.text.trim().length === 0) throw badRequest('text is required');
    const text = req.text.trim();
    // A wish to die typed into the verdict box gets the serious line (even when over-long): it is
    // not judged, not sent to a model, not counted and not logged. Method words are not checked
    // here — a verdict describes how someone died.
    const safety = detectSafety(text);
    const selfHarm = safety?.kind === 'selfHarm' ? safety : undefined;
    if (!selfHarm && [...req.text].length > MAX_VERDICT_CHARS) throw badRequest(`text is too long (max ${MAX_VERDICT_CHARS})`);
    const lines = (await this.registry()).lines;
    const L = lines.lines.inquest;
    const labels: Record<string, string> = {};
    for (const el of c.data.answerElements) labels[el.id] = el.label;

    if (selfHarm) {
      return { result: 'wrong', matched: [], labels, lines: [safetyLine(selfHarm)], notice: 'support', ...(await this.issue(c, s)) };
    }

    if (s.solved) {
      return { result: 'correct', matched: c.data.answerElements.map((e) => e.id), labels, lines: [lines.pick(L.verdictCorrect, s.verdictAttempts, 'verdict.correct').text], ...(await this.issue(c, s)) };
    }

    const timer = new StageTimer();
    const vj = this.opts.budget?.exceeded() ? undefined : this.opts.components.verdictJudge;
    let model: VerdictJudgeOutput | undefined;
    let fallback: string | undefined;
    if (vj) {
      const normalized = normalize(text);
      const pre = evaluateVerdict(c.data, text);
      const r = await timer.time('judge', () =>
        callModel(vj.name, (signal, timeoutMs) => vj.judge({ caseData: c.data, text, normalized, rules: pre.rules, signal, timeoutMs }), STAGE_TIMEOUT_MS.judge, () => TURN_DEADLINE_MS - timer.elapsed()),
      );
      if (r.ok && r.value) {
        model = r.value;
        this.opts.budget?.add(r.value.usage.costUsd);
      } else fallback = `verdict-judge:${r.error}`;
    }
    const ev = timer.timeSync('rules', () => evaluateVerdict(c.data, text, model));
    const attempts = s.verdictAttempts + 1;
    const out: string[] = [];
    const seed = attempts;
    if (ev.wrongClaims.length > 0) {
      // A false claim dominates: say the story is wrong and answer that claim (at most two).
      out.push(lines.pick(L.verdictWrong, seed, 'verdict.wrong').text);
      for (const id of ev.wrongClaims.slice(0, 2)) {
        const w = c.data.wrongClaims.find((x) => x.id === id);
        if (w) out.push(w.feedback);
      }
    } else {
      switch (ev.result) {
        case 'correct':
          out.push(lines.pick(L.verdictCorrect, seed, 'verdict.correct').text);
          break;
        case 'almost':
          out.push(lines.pick(L.verdictAlmost, seed, 'verdict.almost').text);
          break;
        case 'missing':
          out.push(lines.pick(L.verdictMissing, seed, 'verdict.missing').text);
          break;
        default:
          out.push(lines.pick(L.verdictWrong, seed, 'verdict.wrong').text);
      }
      if (ev.result === 'almost' || ev.result === 'missing') {
        for (const id of ev.missing.slice(0, 2)) {
          const el = c.data.answerElements.find((x) => x.id === id);
          if (el) out.push(el.missingFeedback);
        }
      }
    }
    const ns: GameState = { ...s, verdictAttempts: attempts, solved: ev.result === 'correct', nearCore: s.nearCore || ev.result === 'correct' };
    const trace: EngineTrace = {
      mode: vj ? this.opts.components.mode : 'rules',
      normalized: [normalize(text)],
      candidates: [],
      judge: { rules: ev.rules, model: ev.model, matched: ev.matched, wrongClaims: ev.wrongClaims, missing: ev.missing },
      confidence: model ? Math.min(...Object.values(model.elements), 1) : undefined,
      fastPath: true,
      fallback,
      timings: timer.timings(),
      tokens: { input: model?.usage.inputTokens ?? 0, output: model?.usage.outputTokens ?? 0 },
      costUsd: model?.usage.costUsd ?? 0,
      degraded: !!fallback,
    };
    this.opts.traces?.write({ id: traceId(), at: new Date(this.clock()).toISOString(), kind: 'verdict', caseId: c.data.id, input: text, result: [ev.result], trace });
    const res: VerdictResponse = { result: ev.result, matched: ev.matched, labels, lines: out, ...(await this.issue(c, ns)) };
    if (o?.withTrace) res.trace = trace;
    return res;
  }

  /**
   * choice / cloze verdicts: judged against the case's verdictModes (no model, no free text).
   * Counted and solved exactly like the free-text verdict; an invalid pick is a bad_request.
   */
  private async pickVerdict(c: LoadedCase, s: GameState, mode: Exclude<VerdictMode, 'free'>, req: VerdictRequest, o?: CallOptions): Promise<VerdictResponse> {
    const pv: PickVerdict = mode === 'choice' ? judgeChoice(c.data, s.cleared, req.choice) : judgeCloze(c.data, s.cleared, req.blanks);
    const lines = (await this.registry()).lines;
    const L = lines.lines.inquest;

    if (s.solved) {
      const all = mode === 'cloze' ? Object.keys(pv.labels) : c.data.answerElements.map((e) => e.id);
      return { result: 'correct', matched: all, labels: pv.labels, lines: [lines.pick(L.verdictCorrect, s.verdictAttempts, 'verdict.correct').text], ...(await this.issue(c, s)) };
    }

    const attempts = s.verdictAttempts + 1;
    const out: string[] = [];
    if (pv.result === 'correct') out.push(lines.pick(L.verdictCorrect, attempts, 'verdict.correct').text);
    else if (pv.result === 'missing') out.push(lines.pick(L.verdictMissing, attempts, 'verdict.missing').text);
    else {
      out.push(lines.pick(L.verdictWrong, attempts, 'verdict.wrong').text);
      // A wrong option that states a known false story gets that claim's authored answer.
      for (const id of pv.wrongClaims.slice(0, 2)) {
        const w = c.data.wrongClaims.find((x) => x.id === id);
        if (w) out.push(w.feedback);
      }
    }
    const solved = pv.result === 'correct';
    const ns: GameState = { ...s, verdictAttempts: attempts, solved, nearCore: s.nearCore || solved };
    const trace: EngineTrace = {
      mode: 'rules',
      normalized: [],
      candidates: [],
      judge: { verdictMode: mode, matched: pv.matched, wrongClaims: pv.wrongClaims },
      fastPath: true,
      timings: [],
      tokens: { input: 0, output: 0 },
      costUsd: 0,
    };
    this.opts.traces?.write({ id: traceId(), at: new Date(this.clock()).toISOString(), kind: 'verdict', caseId: c.data.id, input: pv.input, result: [pv.result], trace });
    const res: VerdictResponse = { result: pv.result, matched: pv.matched, labels: pv.labels, lines: out, ...(await this.issue(c, ns)) };
    if (o?.withTrace) res.trace = trace;
    return res;
  }

  async reconstruction(req: ReconstructionRequest, o?: CallOptions): Promise<ReconstructionView> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    if (!s.solved) throw forbidden('the verdict has not been accepted yet');
    return reconstructionView(c.data, s.reconstructed);
  }

  async submitReconstruction(req: ReconstructionSubmit, o?: CallOptions): Promise<ReconstructionResult> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    if (!s.solved) throw forbidden('the verdict has not been accepted yet');
    const picks = req.picks && typeof req.picks === 'object' ? req.picks : {};
    const correct: Record<string, boolean> = {};
    for (const p of c.data.reconstruction.panels) {
      if (!p.choice) continue;
      const pos = (picks as Record<string, unknown>)[p.id];
      const order = optionOrder(c.data.id, p.id, p.choice.options.length);
      const authored = typeof pos === 'number' && Number.isInteger(pos) && pos >= 0 && pos < order.length ? order[pos] : -1;
      correct[p.id] = authored >= 0 && p.choice.options[authored].correct === true;
    }
    const allCorrect = Object.values(correct).every(Boolean);
    const ns: GameState = allCorrect ? { ...s, reconstructed: true } : s;
    const res: ReconstructionResult = { correct, allCorrect, ...(await this.issue(c, ns)) };
    if (allCorrect) res.finale = [...c.data.reconstruction.finale];
    return res;
  }

  async solution(req: { caseId: string; token: ProgressToken }, o?: CallOptions): Promise<SolutionResponse> {
    const c = await this.loaded(req?.caseId, o);
    const s = await this.state(c, req.token);
    if (!s.solved) throw forbidden('the verdict has not been accepted yet');
    return solutionView(c.data, new Set(s.unlocked));
  }
}
