/**
 * Investigation controller: one instance per mounted InvestigationScene.
 *
 *   ask(text) → api.ask → save (log, facts, memos, token) → present():
 *     per atomic answer: stamp slam → Holma mood + typed line → (findings: cut-in → card
 *     flies to the notebook → shards light) → (nearCore: pulse + shard flicker)
 *
 * Pacing: the first FULL_FINDINGS finding reveals of a session get the full show (cut-in +
 * card flight); after that ordinary findings use a compact flight that runs while the line
 * is still typing. CORE findings always get the full cut-in. Enter/click fast-forwards; Enter
 * with a question typed also queues it, so it is sent as soon as the presentation ends.
 *
 * Everything the player earned is saved BEFORE the presentation runs, so a reload in the
 * middle of an animation never loses anything. The presentation only controls what is
 * revealed when (hidden answer ids, facts still "in flight", the shard count on stage).
 */
import { batch, signal } from '@preact/signals';
import type { AnswerClass } from '../../../shared/case-schema';
import { ApiError, type AskAnswer, type AskResponse, type CasePublic, type HolmaMood, type ProgressSnapshot, type PublicFact } from '../../../shared/api';
import { api } from '../../api';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { pickLine, type ResolvedLine } from '../../lib/lines';
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
  /** Short flight (no cut-in before it): used once the player has seen a few full reveals. */
  compact: boolean;
  resolve: () => void;
}
/** The server could not verify the saved token: the player decides (retry / start over). */
export interface TokenTrouble {
  source: 'ask' | 'hint';
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
/** Finding reveals per session that get the full cut-in + flight before the compact treatment. */
const FULL_FINDINGS = 2;
/** Presentations (ever, per browser) that show the 「クリック / Enter で早送り」 hint. */
const FF_HINT_KEY = 'janedoe:ffhint';
const FF_HINT_TIMES = 3;
const STAMP_HOLD = 0.85;

function ffHintLeft(): boolean {
  try {
    return Number(localStorage.getItem(FF_HINT_KEY) ?? 0) < FF_HINT_TIMES;
  } catch {
    return false;
  }
}
function ffHintSeen() {
  try {
    localStorage.setItem(FF_HINT_KEY, String(Number(localStorage.getItem(FF_HINT_KEY) ?? 0) + 1));
  } catch {
    /* per-viewer convenience only */
  }
}

/**
 * Sizes the judgement stamp from the stage: the fx stamp is ≈2.6× its font size tall, so a
 * font size of 27% of the stage height keeps the slam inside the stage frame (1280×720, phone
 * keyboard open) while big screens still get the full-size stamp. The size classes' own values
 * (src/ui/stamp.css) are the upper bound. Applied through --iv-stamp-s (investigation.css).
 */
function fitStamp(narrow: boolean): 'lg' | 'xl' {
  const r = document.querySelector<HTMLElement>('[data-stage]')?.getBoundingClientRect();
  const h = r && r.height > 0 ? r.height : 400;
  const vw = window.innerWidth;
  const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const cap = narrow ? clamp(46, vw * 0.14, 72) : clamp(80, vw * 0.11, 150);
  const px = Math.round(clamp(34, h * 0.27, cap));
  document.documentElement.style.setProperty('--iv-stamp-s', `${px}px`);
  return narrow ? 'lg' : 'xl';
}

/**
 * Which answers are "near core" moments. The engine flags them per answer (AskAnswer.nearCore:
 * a core hypothesis confirmed for the first time, or the nearCore state switching on). Fallback
 * for a server that does not send the flag: when the snapshot's nearCore flipped on this turn
 * and no answer claims it, the last non-support answer gets it (the old behaviour).
 */
export function nearFlags(answers: AskAnswer[], wasNear: boolean, snap: ProgressSnapshot | undefined): boolean[] {
  const flags = answers.map((a) => a.nearCore === true && a.notice !== 'support');
  if (!flags.some(Boolean) && !wasNear && snap?.nearCore) {
    for (let i = answers.length - 1; i >= 0; i--) {
      if (answers[i].notice !== 'support') {
        flags[i] = true;
        break;
      }
    }
  }
  return flags;
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
  /** Enter was pressed with a question typed during a presentation → send it when it ends. */
  const queued = signal(false);
  /** Show the one-time 「クリック / Enter で早送り」 hint during this presentation. */
  const ffHint = signal(false);
  /** Answer ids whose small verdict chips wait until the big stamp starts to leave. */
  const chipHold = signal<Set<string>>(new Set());
  /** A bad token is waiting for the player's decision (dialog). */
  const tokenTrouble = signal<TokenTrouble | null>(null);

  let skipping = false;
  let seq = 0;
  /** Finding reveals shown in this session (the first FULL_FINDINGS get the full treatment). */
  let findingShows = 0;
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

  /* ---------------- verdict chips ---------------- */
  const heldClass = new Map<string, AnswerClass>();
  function holdChip(id: string, answerClass: AnswerClass) {
    heldClass.set(id, answerClass);
    const s = new Set(chipHold.peek());
    s.add(id);
    chipHold.value = s;
  }
  function releaseAllChips() {
    const ids = [...chipHold.peek()];
    if (!ids.length) return;
    const last = heldClass.get(ids[ids.length - 1]);
    heldClass.clear();
    batch(() => {
      chipHold.value = new Set();
      const q = stageQ.peek();
      if (q && !q.answerClass && last) stageQ.value = { ...q, answerClass: last };
    });
  }
  /** The big stamp is leaving → the small chips (stage caption + chat row) may appear. */
  function releaseChip(id: string, answerClass: AnswerClass) {
    if (!chipHold.peek().has(id)) return;
    heldClass.delete(id);
    batch(() => {
      const s = new Set(chipHold.peek());
      s.delete(id);
      chipHold.value = s;
      const q = stageQ.peek();
      if (q && !q.answerClass) stageQ.value = { ...q, answerClass };
    });
  }

  /* ---------------- finding sequence ---------------- */
  function fly(facts: PublicFact[], core: boolean, compact: boolean): Promise<void> {
    return new Promise((resolve) => {
      if (skipping) return resolve();
      flight.value = { id: ++seq, facts, core, compact, resolve };
    });
  }

  function flightDone(id: number) {
    const f = flight.peek();
    if (!f || f.id !== id) return;
    flight.value = null;
    f.resolve();
  }

  /** Is the next reveal of these facts compact? (ordinary findings after the first few) */
  function compactFor(facts: PublicFact[]) {
    return !facts.some((f) => f.importance >= 3) && findingShows >= FULL_FINDINGS;
  }

  async function findingSequence(facts: PublicFact[], landedIds: string[], compact: boolean) {
    const core = facts.some((f) => f.importance >= 3);
    findingShows++;
    if (!skipping) {
      if (core) {
        fx.flash('#FF2E63', { opacity: 0.32, duration: 0.5 });
        fx.speedLines(1100, { kind: 'radial', color: 'rgba(255,46,99,0.55)' });
        fx.shake(1.1, 0.42);
        await fx.cutIn({ text: '核心所見', en: 'CORE FINDING', tone: 'alarm', character: 'holma', mood: 'surprised', hold: 0.9 });
      } else if (!compact) {
        await fx.cutIn({ text: '所見入手', en: 'NEW FINDING', tone: 'formalin', hold: 0.42 });
      }
    }
    await fly(facts, core, compact && !core);
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
  async function present(answers: AskAnswer[], entries: Extract<LogEntry, { kind: 'answer' }>[], res: AskResponse, near: boolean[]) {
    presenting.value = true;
    skipping = false;
    const landed = new Set(progress()?.factOrder ?? []);
    for (const a of answers) for (const f of a.unlocked) landed.delete(f.id);
    let nearShown = false;
    const narrow = layout.peek() === 'narrow';
    if (answers.some((a) => a.unlocked.length) && ffHintLeft()) {
      ffHint.value = true;
      ffHintSeen();
    }

    for (let i = 0; i < answers.length; i++) {
      if (disposed) return;
      const a = answers[i];
      const e = entries[i];
      const support = a.notice === 'support';
      let stampDone: Promise<void> = Promise.resolve();
      /** Resolves as the big stamp starts to leave (or is gone). */
      let stampLeaving: Promise<void> = Promise.resolve();
      let chipTimer: ReturnType<typeof setTimeout> | undefined;
      if (!support && !skipping) {
        // the big stamp speaks first; the small chips (caption, chat row) follow as it leaves
        stageQ.value = { ...(stageQ.peek() ?? { n: 0, text: a.question }), answerClass: undefined };
        holdChip(e.id, a.answerClass);
        stampDone = fx.stamp(a.answerClass, { size: fitStamp(narrow), hold: STAMP_HOLD });
        let leave = () => {};
        stampLeaving = Promise.race([stampDone, new Promise<void>((r) => (leave = r))]);
        chipTimer = setTimeout(() => {
          releaseChip(e.id, a.answerClass);
          leave();
        }, (0.25 + STAMP_HOLD) * 1000);
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
      const typed = (skipping ? Promise.resolve() : waitTyped(e.id, a.line)).then(() => {
        talking.value = false;
      });
      const compact = a.unlocked.length > 0 && compactFor(a.unlocked);
      // a compact card already pops while the stamp fades out; everything else waits for it to go
      if (!skipping) await (compact ? stampLeaving : stampDone);
      clearTimeout(chipTimer);
      if (!support) releaseChip(e.id, a.answerClass);

      if (a.unlocked.length) {
        a.unlocked.forEach((f) => landed.add(f.id));
        // compact: the card flies while Holma is still talking; full: after the line
        if (compact) await Promise.all([findingSequence(a.unlocked, [...landed], true), typed]);
        else {
          await typed;
          await findingSequence(a.unlocked, [...landed], false);
        }
      } else await typed;
      talking.value = false;

      if (near[i] && !nearShown) {
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
      releaseAllChips();
      shownProgress.value = shardProgress(pub.peek(), progress()?.factOrder ?? [], res.progress.progress);
      presenting.value = false;
      talking.value = false;
      ffHint.value = false;
    });
    skipping = false;
  }

  /** Fast-forward the running presentation (Enter / click while it plays). */
  function fastForward() {
    if (!presenting.peek()) return;
    skipping = true;
    batch(() => {
      finishTick.value++;
      ffHint.value = false;
      releaseAllChips();
    });
    typeWaiters.forEach((done) => done());
    const f = flight.peek();
    if (f) flightDone(f.id);
  }

  /** Enter with a question typed while the presentation plays: send it once it is over. */
  function queueSend() {
    if (!presenting.peek()) return;
    queued.value = true;
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

    const near = nearFlags(res.answers, wasNear, res.progress);
    const entries = res.answers.map(
      (a, i): Extract<LogEntry, { kind: 'answer' }> => ({
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
        ...(near[i] ? { nearCore: true } : {}),
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
    await present(res.answers, entries, res, near);
    touch();
    if (queued.peek() && !disposed) {
      queued.value = false;
      const next = inputText.peek().trim();
      if (next) void ask(next);
    }
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
      // never wipe the case silently: the player chooses (retry / start over with a backup)
      tokenTrouble.value = { source: 'ask' };
      announce.value = '記録を照合できませんでした。もう一度試すか、最初からやり直すかを選んでください。';
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

  /**
   * The player's answer to the bad-token dialog.
   *   retry   — try the same request again with the saved token (a transient 401 recovers)
   *   restart — back the attempt up (notebook 「前回の記録」), start the case over, keep the input
   */
  async function resolveTokenTrouble(action: 'retry' | 'restart' | 'dismiss') {
    const t = tokenTrouble.peek();
    if (!t) return;
    tokenTrouble.value = null;
    if (action === 'dismiss') return;
    if (action === 'retry') {
      if (t.source === 'hint') void requestHint();
      else retry();
      return;
    }
    const ok = await restartCaseAfterBadToken(caseId, pub.peek());
    if (disposed) return;
    findingShows = 0;
    syncFromSave();
    toast(ok ? '新しい記録で捜査を始め直しました。前回の記録は捜査ノートで読み返せます。' : '記録を作り直せませんでした。通信を確かめて、もう一度どうぞ。', { tone: ok ? 'info' : 'warn', duration: 4200 });
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
        tokenTrouble.value = { source: 'hint' };
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
    document.documentElement.style.removeProperty('--iv-stamp-s');
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
    queued,
    ffHint,
    chipHold,
    tokenTrouble,
    // actions
    setPub,
    syncFromSave,
    ask,
    retry,
    fastForward,
    queueSend,
    resolveTokenTrouble,
    onTyped,
    flightDone,
    requestHint,
    showWhisperAgain,
    idleCheck,
    touch,
    dispose,
  };
}
