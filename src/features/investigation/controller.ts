/**
 * Investigation controller: one instance per mounted InvestigationScene.
 *
 *   ask(text) → api.ask → save (log, facts, memos, token) → present():
 *     per atomic answer: stamp slam → Holma mood + typed line → (findings: cut-in → card
 *     flies to the notebook → shards light) → (nearCore: pulse + shard flicker)
 *
 * Everything the player earned is saved BEFORE the presentation runs, so a reload in the
 * middle of an animation never loses anything. The presentation only controls what is
 * revealed when (hidden answer ids, facts still "in flight", the shard count on stage).
 */
import { batch, signal } from '@preact/signals';
import type { AnswerClass } from '../../../shared/case-schema';
import { ApiError, type AskAnswer, type AskResponse, type CasePublic, type HolmaMood, type PublicFact } from '../../../shared/api';
import { api } from '../../api';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { bank, pickLine, resolveLine, type ResolvedLine } from '../../lib/lines';
import { layout } from '../../lib/viewport';
import { addFacts, addHint, addMemos, appendLog, getCaseProgress, newLogId, setToken } from '../../state/save';
import type { LogEntry } from '../../state/types';
import { STAMP_META } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';
import { ensureToken, restartCaseAfterBadToken, shardProgress } from './caseData';

export interface PendingQuestion {
  id: string;
  text: string;
}
export interface TransientRow {
  id: string;
  kind: 'network' | 'rate';
  line: string;
  mood: HolmaMood;
  retryText?: string;
}
export interface FlightRequest {
  id: number;
  facts: PublicFact[];
  core: boolean;
  resolve: () => void;
}
export interface Whisper {
  level: number;
  text: string;
  intro: ResolvedLine;
  total: number;
}
export interface StageQuestion {
  n: number;
  text: string;
  answerClass?: AnswerClass;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Idle nudge after ~45 s without input. QA may shorten it with `?debug=1&idlems=3000`. */
const IDLE_MS = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const v = Number(q.get('idlems'));
    return q.get('debug') === '1' && v >= 1000 ? v : 45_000;
  } catch {
    return 45_000;
  }
})();
const RATE_WAIT_MS = 8_000;

function lastPiece(line: string) {
  const parts = line.split('\n').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export type Controller = ReturnType<typeof createController>;

export function createController(caseId: string) {
  /* ---------------- state ---------------- */
  const pub = signal<CasePublic | undefined>(undefined);
  const pending = signal<PendingQuestion | null>(null);
  const transient = signal<TransientRow[]>([]);
  /** Answer log ids not revealed yet (presentation in progress). */
  const hidden = signal<Set<string>>(new Set());
  /** Answer log ids that should type out (added in this session). */
  const animated = signal<Set<string>>(new Set());
  /** Fact ids whose card is still flying (hidden in the notebook until they land). */
  const arriving = signal<Set<string>>(new Set());
  const asking = signal(false);
  const presenting = signal(false);
  const hintBusy = signal(false);
  const mood = signal<HolmaMood>('normal');
  const talking = signal(false);
  const stageQ = signal<StageQuestion | null>(null);
  /** Shard progress shown on stage (lags the saved progress until each card lands). */
  const shownProgress = signal(0);
  /** Increment → Jane's shards flicker (nearCore). */
  const nearTick = signal(0);
  /** Increment → the notebook button bumps (a card landed). */
  const bumpTick = signal(0);
  /** Increment → finish every typing line now. */
  const finishTick = signal(0);
  const idleLine = signal<(ResolvedLine & { key: number }) | null>(null);
  const whisper = signal<Whisper | null>(null);
  const rateUntil = signal(0);
  const announce = signal('');
  const inputText = signal('');
  const flight = signal<FlightRequest | null>(null);

  let skipping = false;
  let seq = 0;
  let lastActivity = Date.now();
  let idleCount = 0;
  let idleAlt = 0;
  let disposed = false;
  const typeWaiters = new Map<string, () => void>();

  /* ---------------- helpers ---------------- */
  const progress = () => getCaseProgress(caseId);

  function syncFromSave() {
    const c = progress();
    const log = c?.log ?? [];
    let n = 0;
    let lastQ: string | undefined;
    for (const e of log) if (e.kind === 'question') (n++, (lastQ = e.text));
    const lastA = [...log].reverse().find((e) => e.kind === 'answer') as Extract<LogEntry, { kind: 'answer' }> | undefined;
    stageQ.value = lastQ && lastA?.notice !== 'support' ? { n, text: lastQ, answerClass: lastA?.answerClass } : null;
    mood.value = lastA?.notice === 'support' ? 'serious' : lastA?.mood ?? 'normal';
    shownProgress.value = shardProgress(pub.peek(), c?.factOrder ?? [], c?.snapshot?.progress ?? 0);
  }

  function setPub(p: CasePublic | undefined) {
    pub.value = p;
    if (p && !presenting.peek()) shownProgress.value = shardProgress(p, progress()?.factOrder ?? [], progress()?.snapshot?.progress ?? 0);
  }

  function nearCoreLines(): Set<string> {
    const s = new Set<string>();
    for (const l of bank('nearCore')) s.add(resolveLine(l).text.trim());
    for (const t of pub.peek()?.holmaLines?.nearCore ?? []) s.add(t.trim());
    return s;
  }

  function waitTyped(id: string, text: string): Promise<void> {
    // safety net only (the TypeLine reports completion); generous so slow devices still finish typing
    const max = 1500 + [...text].length * 80;
    return new Promise((resolve) => {
      const done = () => {
        typeWaiters.delete(id);
        resolve();
      };
      typeWaiters.set(id, done);
      setTimeout(done, max);
    });
  }

  function onTyped(id: string) {
    typeWaiters.get(id)?.();
    if (animated.peek().has(id)) {
      const next = new Set(animated.peek());
      next.delete(id);
      animated.value = next;
    }
  }

  function touch() {
    lastActivity = Date.now();
    if (idleLine.peek()) idleLine.value = null;
  }

  /* ---------------- finding sequence ---------------- */
  function fly(facts: PublicFact[], core: boolean): Promise<void> {
    return new Promise((resolve) => {
      if (skipping) return resolve();
      flight.value = { id: ++seq, facts, core, resolve };
    });
  }

  function flightDone(id: number) {
    const f = flight.peek();
    if (!f || f.id !== id) return;
    flight.value = null;
    f.resolve();
  }

  async function findingSequence(facts: PublicFact[], landedIds: string[]) {
    const core = facts.some((f) => f.importance >= 3);
    if (!skipping) {
      if (core) {
        fx.flash('#FF2E63', { opacity: 0.32, duration: 0.5 });
        fx.speedLines(1100, { kind: 'radial', color: 'rgba(255,46,99,0.55)' });
        fx.shake(1.1, 0.42);
        await fx.cutIn({ text: '核心所見', en: 'CORE FINDING', tone: 'alarm', character: 'holma', mood: 'surprised', hold: 0.95 });
      } else {
        await fx.cutIn({ text: '所見入手', en: 'NEW FINDING', tone: 'formalin', hold: 0.42 });
      }
    }
    await fly(facts, core);
    audio.sfx(core ? 'findingCore' : 'finding');
    batch(() => {
      const next = new Set(arriving.peek());
      facts.forEach((f) => next.delete(f.id));
      arriving.value = next;
      shownProgress.value = shardProgress(pub.peek(), landedIds, shownProgress.peek());
      bumpTick.value++;
    });
    announce.value = `所見入手：${facts.map((f) => f.cardTitle ?? f.text).join('、')}`;
  }

  /* ---------------- presentation ---------------- */
  async function present(answers: AskAnswer[], entries: Extract<LogEntry, { kind: 'answer' }>[], res: AskResponse, wasNear: boolean) {
    presenting.value = true;
    skipping = false;
    const nearSet = nearCoreLines();
    const landed = new Set(progress()?.factOrder ?? []);
    for (const a of answers) for (const f of a.unlocked) landed.delete(f.id);
    let nearShown = false;
    const narrow = layout.peek() === 'narrow';

    for (let i = 0; i < answers.length; i++) {
      if (disposed) return;
      const a = answers[i];
      const e = entries[i];
      const support = a.notice === 'support';
      let stampDone: Promise<void> = Promise.resolve();
      if (!support && !skipping) {
        stageQ.value = { ...(stageQ.peek() ?? { n: 0, text: a.question }), answerClass: a.answerClass };
        stampDone = fx.stamp(a.answerClass, { size: narrow ? 'lg' : 'xl', hold: 0.85 });
        await wait(motionReduced() ? 60 : 230);
      } else if (!support) {
        stageQ.value = { ...(stageQ.peek() ?? { n: 0, text: a.question }), answerClass: a.answerClass };
      } else {
        // a support notice is answered quietly: nothing is echoed on the stage
        stageQ.value = null;
        audio.sfx('page');
      }
      batch(() => {
        mood.value = support ? 'serious' : a.mood;
        const h = new Set(hidden.peek());
        h.delete(e.id);
        hidden.value = h;
        talking.value = !skipping;
      });
      announce.value = support ? `ホルマ：${a.line}` : `判定：${STAMP_META[a.answerClass].sr}。ホルマ：${a.line.replace(/\n/g, ' ')}`;
      if (!skipping) await Promise.all([stampDone, waitTyped(e.id, a.line)]);
      talking.value = false;

      if (a.unlocked.length) {
        a.unlocked.forEach((f) => landed.add(f.id));
        await findingSequence(a.unlocked, [...landed]);
      }

      const isNear = !support && (nearSet.has(lastPiece(a.line)) || (!wasNear && res.progress.nearCore && !nearShown && i === answers.length - 1));
      if (isNear && !nearShown) {
        nearShown = true;
        nearTick.value++;
        if (!skipping) {
          fx.pulse('cyan');
          await wait(420);
        }
      }
      if (!skipping && i < answers.length - 1) await wait(160);
    }
    batch(() => {
      hidden.value = new Set();
      arriving.value = new Set();
      shownProgress.value = shardProgress(pub.peek(), progress()?.factOrder ?? [], res.progress.progress);
      presenting.value = false;
      talking.value = false;
    });
    skipping = false;
  }

  /** Fast-forward the running presentation (Enter / click while it plays). */
  function fastForward() {
    if (!presenting.peek()) return;
    skipping = true;
    finishTick.value++;
    typeWaiters.forEach((done) => done());
    const f = flight.peek();
    if (f) flightDone(f.id);
  }

  /* ---------------- ask ---------------- */
  async function ask(raw: string) {
    touch();
    if (presenting.peek()) {
      fastForward();
      return false;
    }
    if (asking.peek()) return false;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (Date.now() < rateUntil.peek()) {
      audio.sfx('error');
      toast('少し待ってから、もう一度どうぞ。', { tone: 'warn', icon: 'time' });
      return false;
    }

    const qid = newLogId();
    batch(() => {
      transient.value = [];
      pending.value = { id: qid, text };
      asking.value = true;
      inputText.value = '';
      stageQ.value = { n: (stageQ.peek()?.n ?? 0) + 1, text };
      idleLine.value = null;
    });
    audio.sfx('send');

    let token = progress()?.token;
    if (!token) {
      await ensureToken(caseId, pub.peek());
      token = progress()?.token;
    }
    const wasNear = !!progress()?.snapshot?.nearCore;
    let res: AskResponse;
    try {
      if (!token) throw new ApiError('network', 'no token');
      res = await api.ask({ caseId, question: text, token });
    } catch (e) {
      if (disposed) return false;
      await handleError(e, text);
      return false;
    }
    if (disposed) return false;

    const entries = res.answers.map(
      (a): Extract<LogEntry, { kind: 'answer' }> => ({
        id: newLogId(),
        at: Date.now(),
        kind: 'answer',
        question: a.question,
        answerClass: a.answerClass,
        line: a.line,
        mood: a.mood,
        unlocked: a.unlocked.map((f) => f.id),
        memos: a.memos.map((m) => m.id),
        ...(a.notice ? { notice: a.notice, degraded: a.notice === 'degraded' } : {}),
      }),
    );
    const facts = res.answers.flatMap((a) => a.unlocked);
    batch(() => {
      hidden.value = new Set(entries.map((e) => e.id));
      animated.value = new Set([...animated.peek(), ...entries.map((e) => e.id)]);
      arriving.value = new Set(facts.map((f) => f.id));
      const qEntry: LogEntry = { id: qid, at: Date.now(), kind: 'question', text };
      const newEntries: LogEntry[] = [qEntry, ...entries];
      appendLog(caseId, newEntries);
      addFacts(caseId, facts);
      addMemos(
        caseId,
        res.answers.flatMap((a) => a.memos),
      );
      setToken(caseId, res.token, res.progress);
      pending.value = null;
      asking.value = false;
    });
    await present(res.answers, entries, res, wasNear);
    touch();
    return true;
  }

  async function handleError(e: unknown, text: string) {
    const code = e instanceof ApiError ? e.code : 'network';
    batch(() => {
      pending.value = null;
      asking.value = false;
      if (!inputText.peek()) inputText.value = text;
      stageQ.value = null;
    });
    syncFromSave();
    mood.value = 'surprised';
    audio.sfx('error');
    if (code === 'rate_limited') {
      const l = pickLine('error.rateLimited');
      rateUntil.value = Date.now() + RATE_WAIT_MS;
      transient.value = [{ id: `t${++seq}`, kind: 'rate', line: l.text, mood: l.mood }];
      announce.value = `ホルマ：${l.text}`;
      return;
    }
    if (code === 'bad_token') {
      const ok = await restartCaseAfterBadToken(caseId, pub.peek());
      syncFromSave();
      toast(ok ? '記録の照合に失敗したため、この事件を最初からやり直します。' : '記録の照合に失敗しました。通信を確かめて、もう一度どうぞ。', { tone: 'warn', duration: 5200 });
      return;
    }
    const l = pickLine('error.network');
    transient.value = [{ id: `t${++seq}`, kind: 'network', line: l.text, mood: l.mood, retryText: text }];
    announce.value = `ホルマ：${l.text}`;
  }

  function retry(text?: string) {
    const t = (inputText.peek() || text || '').trim();
    if (t) void ask(t);
  }

  /* ---------------- hints ---------------- */
  async function requestHint(): Promise<boolean> {
    if (hintBusy.peek()) return false;
    touch();
    hintBusy.value = true;
    try {
      let token = progress()?.token;
      if (!token) {
        await ensureToken(caseId, pub.peek());
        token = progress()?.token;
      }
      if (!token) throw new ApiError('network', 'no token');
      const res = await api.hint({ caseId, token });
      if (disposed) return false;
      batch(() => {
        addHint(caseId, res.level, res.text);
        const hintEntry: LogEntry = { id: newLogId(), at: Date.now(), kind: 'hint', level: res.level, text: res.text };
        appendLog(caseId, [hintEntry]);
        setToken(caseId, res.token, res.progress);
        whisper.value = { level: res.level, text: res.text, intro: pickLine('investigation.hintIntro'), total: pub.peek()?.hintCount ?? 3 };
        mood.value = 'serious';
      });
      audio.sfx('reveal');
      announce.value = `ホルマの囁き ${res.level}：${res.text}`;
      return true;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      if (code === 'bad_token') {
        await restartCaseAfterBadToken(caseId, pub.peek());
        syncFromSave();
        toast('記録の照合に失敗したため、この事件を最初からやり直します。', { tone: 'warn', duration: 5200 });
      } else {
        const l = pickLine(code === 'rate_limited' ? 'error.rateLimited' : 'error.network');
        toast(l.text, { tone: 'warn', icon: 'whisper' });
      }
      audio.sfx('error');
      return false;
    } finally {
      hintBusy.value = false;
    }
  }

  function showWhisperAgain(level: number) {
    const h = progress()?.hints.find((x) => x.level === level);
    if (!h) return;
    whisper.value = { level: h.level, text: h.text, intro: { text: '先ほどの囁きを、もう一度。', mood: 'normal' }, total: pub.peek()?.hintCount ?? 3 };
  }

  /* ---------------- idle ---------------- */
  function idleCheck(blocked: boolean) {
    if (blocked || asking.peek() || presenting.peek() || whisper.peek() || document.visibilityState !== 'visible') {
      lastActivity = Math.max(lastActivity, Date.now() - IDLE_MS + 4000);
      return;
    }
    if (idleLine.peek() || idleCount >= 4) return;
    if (Date.now() - lastActivity < IDLE_MS) return;
    const caseIdle = pub.peek()?.holmaLines?.idle ?? [];
    const useCase = caseIdle.length > 0 && idleAlt++ % 2 === 0;
    const line = useCase ? { text: caseIdle[Math.floor(Math.random() * caseIdle.length)], mood: 'normal' as HolmaMood } : pickLine('investigation.idle');
    idleCount++;
    lastActivity = Date.now();
    idleLine.value = { ...line, key: ++seq };
    announce.value = `ホルマ：${line.text}`;
    audio.blip('holma');
    setTimeout(() => {
      if (idleLine.peek()?.key === seq) idleLine.value = null;
    }, 9000);
  }

  function dispose() {
    disposed = true;
    typeWaiters.forEach((d) => d());
    const f = flight.peek();
    if (f) f.resolve();
  }

  return {
    caseId,
    // state
    pub,
    pending,
    transient,
    hidden,
    animated,
    arriving,
    asking,
    presenting,
    hintBusy,
    mood,
    talking,
    stageQ,
    shownProgress,
    nearTick,
    bumpTick,
    finishTick,
    idleLine,
    whisper,
    rateUntil,
    announce,
    inputText,
    flight,
    // actions
    setPub,
    syncFromSave,
    ask,
    retry,
    fastForward,
    onTyped,
    flightDone,
    requestHint,
    showWhisperAgain,
    idleCheck,
    touch,
    dispose,
  };
}
