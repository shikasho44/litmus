/**
 * One AI playthrough of one case through the REAL GameService (the same code the HTTP handler
 * calls): ask / hint → inquest (noise-break shots, grant) → verdict, all with signed tokens.
 * The player model sees only what a player sees (player.ts). Engine traces are recorded for the
 * report but never shown to the player.
 */
import type { CasePublic, InquestRoundView, ProgressSnapshot, ProgressToken, PublicFact } from '../../shared/api.js';
import { ApiError } from '../../shared/api.js';
import type { GameService } from '../../server/engine/game.js';
import type { EngineTrace } from '../../server/engine/trace.js';
import type { LlmProvider } from '../../server/engine/providers/types.js';
import { ProviderError } from '../../server/engine/providers/types.js';
import { normalize } from '../../server/engine/normalize.js';
import type { Persona } from './personas.js';
import { debatePrompt, investigationPrompt, MAX_HINTS, MAX_QUESTIONS, parsePlayerJson, systemPrompt, toAction, verdictPrompt, type InvestigationView, type PlayerAction } from './player.js';
import type { RunSpend, SharedBudget } from './budget.js';
import type { AskPart, RunLog, ShotEvent } from './types.js';
import { PROTO_IDS } from '../../shared/proto.js';

/** Every prototype switch on: the playtest reaches the prototype cases too (shared/proto.ts). */
const P = { protos: PROTO_IDS };

export const MAX_VERDICTS = 4;
const MAX_SHOTS_PER_ROUND = 5;
const MAX_INVALID = 6;
/** Hard stop on player actions per run (a model that keeps choosing a no-op cannot loop forever). */
const MAX_ACTIONS = 120;

export interface SessionOptions {
  svc: GameService;
  caseId: string;
  persona: Persona;
  llm: LlmProvider;
  model: string;
  budget: SharedBudget;
  spend: RunSpend;
  id: string;
  log?: (msg: string) => void;
}

class BudgetStop extends Error {}

export async function playCase(o: SessionOptions): Promise<RunLog> {
  const t0 = Date.now();
  const pub: CasePublic = await o.svc.getCase(o.caseId, { admin: true, ...P });
  let { token, progress } = await o.svc.newToken(o.caseId, { admin: true, ...P });
  const held = new Map<string, PublicFact>(pub.startingFacts.map((f) => [f.id, f]));
  const log: RunLog = {
    id: o.id,
    caseId: o.caseId,
    persona: o.persona.id,
    personaLabel: o.persona.label,
    model: o.model,
    startedAt: new Date(t0).toISOString(),
    seconds: 0,
    asks: [],
    playerIssues: [],
    thoughts: [],
    hints: [],
    inquestOpenedAt: [],
    shots: [],
    verdicts: [],
    outcome: 'failed',
    final: { asked: 0, hintsUsed: 0, unlocked: 0, totalFacts: pub.totalFacts, progress: 0, nearCore: false, solved: false, debateCleared: [], debateMisses: 0 },
    spend: o.spend,
  };
  const labels: Record<string, string> = {};
  let turn = 0;
  let invalid = 0;
  const say = (m: string) => o.log?.(`[${o.id}] ${m}`);

  const think = async (user: string, phase: string): Promise<PlayerAction | undefined> => {
    if (o.budget.exhausted) throw new BudgetStop();
    let lastRaw = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await o.llm.complete({ system: systemPrompt(o.persona), user, json: true, temperature: o.persona.temperature, maxTokens: 450, timeoutMs: 30000 });
        lastRaw = r.text;
        const a = toAction(parsePlayerJson(r.text));
        if (a) {
          if (a.think) log.thoughts.push({ turn, phase, think: a.think.slice(0, 120) });
          return a;
        }
      } catch (e) {
        if (e instanceof ProviderError && e.kind === 'config') throw new BudgetStop();
        lastRaw = `ERROR ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
      }
    }
    log.playerIssues.push({ turn, issue: `unparseable ${phase} output`, raw: lastRaw.slice(0, 300) });
    return undefined;
  };

  const view = (note?: string): InvestigationView => ({ pub, held: [...held.values()], asks: log.asks, hints: log.hints, asked: progress.asked, hintsUsed: progress.hintsUsed, verdicts: log.verdicts, labels, note });
  const asked = new Set<string>();

  const doAsk = async (message: string): Promise<void> => {
    turn++;
    const t = Date.now();
    const res = await o.svc.ask({ caseId: o.caseId, question: message, token }, { admin: true, withTrace: true, ...P });
    token = res.token;
    progress = res.progress;
    const trace = res.trace as EngineTrace | undefined;
    const ms = Date.now() - t;
    res.answers.forEach((a, i) => {
      for (const f of a.unlocked) held.set(f.id, f);
      const part = trace?.parts?.[i];
      const p: AskPart = {
        turn,
        message,
        question: a.question,
        answer: a.answerClass,
        line: a.line,
        unlocked: a.unlocked.map((f) => ({ id: f.id, title: f.cardTitle ?? f.text.slice(0, 20), level: -1 })),
        notice: a.notice,
        nearCore: a.nearCore,
        source: (part?.judge as { source?: string } | undefined)?.source ?? part?.source,
        factIds: part?.factIds,
        closeness: part?.closeness,
        latencyMs: i === 0 ? ms : 0,
        costUsd: i === 0 ? trace?.costUsd ?? 0 : 0,
      };
      log.asks.push(p);
    });
    say(`Q${turn} ${message} → ${res.answers.map((a) => a.answerClass).join('/')}${res.answers.some((a) => a.unlocked.length) ? ' ★' : ''}`);
  };

  const doHint = async (): Promise<void> => {
    const h = await o.svc.hint({ caseId: o.caseId, token }, P);
    token = h.token;
    progress = h.progress;
    log.hints.push({ turn, level: h.level, text: h.text });
    say(`hint ${h.level}`);
  };

  const debate = async (): Promise<void> => {
    const start = await o.svc.inquestStart({ caseId: o.caseId, token }, P);
    token = start.token;
    progress = start.progress;
    for (const round of start.rounds) {
      if (progress.debateCleared.includes(round.id)) continue;
      await playRound(round, start.evidence);
    }
  };

  const playRound = async (round: InquestRoundView, evidence0: PublicFact[]): Promise<void> => {
    const history: ShotEvent[] = [];
    let evidence = [...evidence0, ...[...held.values()].filter((f) => f.importance >= 1 && !evidence0.some((e) => e.id === f.id))];
    let granted = false;
    for (let k = 0; k < MAX_SHOTS_PER_ROUND + 2; k++) {
      const shotsSoFar = history.filter((h) => h.kind !== 'grant').length;
      // Stuck after many misses: take the grant once (the game never lets a player get stuck).
      const forceGrant = !granted && shotsSoFar >= MAX_SHOTS_PER_ROUND - 1;
      const a = forceGrant ? ({ action: 'grant' } as PlayerAction) : await think(debatePrompt(pub, round, evidence, history, [...held.values()]), `debate:${round.id}`);
      if (!a) {
        history.push({ round: round.id, statement: '', span: '', fact: '', correct: false, lines: [], kind: 'invalid', error: 'no usable output' });
        continue;
      }
      if (a.action === 'grant') {
        if (granted) continue;
        granted = true;
        const g = await o.svc.grant({ caseId: o.caseId, token, roundId: round.id }, P);
        token = g.token;
        progress = g.progress;
        if (g.granted) {
          held.set(g.granted.id, g.granted);
          if (!evidence.some((e) => e.id === g.granted!.id)) evidence = [...evidence, g.granted];
        }
        const ev: ShotEvent = { round: round.id, statement: '', span: '', fact: '', correct: false, lines: g.lines, speaker: g.speaker, granted: g.granted?.id, kind: 'grant' };
        history.push(ev);
        log.shots.push(ev);
        say(`grant ${round.id} → ${g.granted?.id}`);
        continue;
      }
      if (a.action !== 'shot' || !a.statement || !a.fact || !a.span) {
        log.playerIssues.push({ turn, issue: `debate: expected a shot, got ${a.action}` });
        continue;
      }
      const span = a.span.replace(/^《|》$/g, '');
      // 「発言3」 / 3 / "r1-s3" → the statement id the band stands for.
      const num = Number(/(\d+)\s*$/.exec(a.statement)?.[1] ?? NaN);
      const stmt = round.statements.find((x) => x.id === a.statement) ?? (Number.isInteger(num) ? round.statements[num - 1] : undefined);
      try {
        if (!stmt) throw new ApiError('bad_request', `no statement ${a.statement}`, false);
        const r = await o.svc.shot({ caseId: o.caseId, token, roundId: round.id, statementId: stmt.id, span, factId: a.fact }, P);
        token = r.token;
        progress = r.progress;
        const ev: ShotEvent = { round: round.id, statement: a.statement, span, fact: a.fact, correct: r.correct, lines: r.lines, speaker: r.speaker, hint: r.hint, kind: 'shot' };
        history.push(ev);
        log.shots.push(ev);
        say(`shot ${round.id} ${a.statement}《${span}》${a.fact} → ${r.correct ? 'HIT' : 'miss'}`);
        if (r.correct) return;
      } catch (e) {
        const ev: ShotEvent = { round: round.id, statement: a.statement, span, fact: a.fact, correct: false, lines: [], kind: 'invalid', error: e instanceof ApiError ? e.message : String(e) };
        history.push(ev);
        log.shots.push(ev);
      }
    }
  };

  const doVerdict = async (text: string): Promise<boolean> => {
    const v = await o.svc.verdict({ caseId: o.caseId, token, text }, P);
    token = v.token;
    progress = v.progress;
    Object.assign(labels, v.labels);
    log.verdicts.push({ asked: progress.asked, text, result: v.result, matched: v.matched, lines: v.lines, notice: v.notice });
    say(`verdict → ${v.result} [${v.matched.join('')}]`);
    return v.result === 'correct';
  };

  try {
    // ---- investigation / inquest loop ----
    let phase: 'investigate' | 'verdict' = 'investigate';
    let solved = false;
    let actions = 0;
    while (!solved) {
      if (++actions > MAX_ACTIONS) throw new Error(`more than ${MAX_ACTIONS} player actions`);
      if (phase === 'investigate') {
        const note = progress.asked >= MAX_QUESTIONS ? '質問は上限に達しました。審問を開いてください。' : progress.asked >= MAX_QUESTIONS - 5 ? `残りの質問はあと${MAX_QUESTIONS - progress.asked}回です。` : undefined;
        let a: PlayerAction | undefined = progress.asked >= MAX_QUESTIONS ? { action: 'inquest' } : await think(investigationPrompt(view(note)), 'investigate');
        if (!a) {
          if (++invalid > MAX_INVALID) throw new Error('player produced no usable action');
          continue;
        }
        if (a.action === 'hint' && progress.hintsUsed >= MAX_HINTS) {
          log.playerIssues.push({ turn, issue: 'hint requested after all 3 were used' });
          a = await think(investigationPrompt(view('ヒントはもう残っていません。質問するか、審問を開いてください。')), 'investigate');
          // Still asking for a hint: the player has nothing left to try → open the inquest.
          if (!a || a.action === 'hint') a = { action: 'inquest' };
        }
        if (a.action === 'ask' && a.question) {
          const key = normalize(a.question);
          if (asked.has(key)) log.playerIssues.push({ turn: turn + 1, issue: 'repeated question (sent anyway)' });
          asked.add(key);
          await doAsk(a.question);
        } else if (a.action === 'hint') await doHint();
        else if (a.action === 'inquest') {
          log.inquestOpenedAt.push(progress.asked);
          await debate();
          phase = 'verdict';
        } else log.playerIssues.push({ turn, issue: `unexpected action ${a.action} while investigating` });
      } else {
        if (log.verdicts.length >= MAX_VERDICTS) break;
        const canInvestigate = progress.asked < MAX_QUESTIONS && log.verdicts.length > 0;
        const a = await think(verdictPrompt(view(), canInvestigate), 'verdict');
        if (!a) {
          if (++invalid > MAX_INVALID) throw new Error('player produced no usable action');
          continue;
        }
        if (a.action === 'verdict' && a.verdict) solved = await doVerdict(a.verdict.slice(0, 590));
        else if (a.action === 'ask' && a.question && canInvestigate) {
          phase = 'investigate';
          await doAsk(a.question);
        } else if (a.action === 'hint' && progress.hintsUsed < MAX_HINTS) await doHint();
        else log.playerIssues.push({ turn, issue: `unexpected action ${a.action} at the verdict` });
      }
    }
    log.outcome = solved ? 'solved' : 'failed';
  } catch (e) {
    if (e instanceof BudgetStop) log.outcome = 'budget';
    else if (e instanceof ApiError && e.code === 'rate_limited') log.outcome = 'cap';
    else {
      log.outcome = 'error';
      log.error = e instanceof Error ? `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n') ?? ''}` : String(e);
    }
  }
  const snap: ProgressSnapshot = progress;
  log.final = {
    asked: snap.asked,
    hintsUsed: snap.hintsUsed,
    unlocked: snap.unlocked.length,
    totalFacts: pub.totalFacts,
    progress: snap.progress,
    nearCore: snap.nearCore,
    solved: snap.solved,
    debateCleared: snap.debateCleared,
    debateMisses: snap.debateMisses,
  };
  log.seconds = Math.round((Date.now() - t0) / 1000);
  void (token as ProgressToken);
  return log;
}
