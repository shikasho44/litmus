/**
 * InquestSession — the state machine behind the 死因審問 scene.
 *
 *   loading → opening → debate (rounds… — optional: 「反証を飛ばして死因宣告へ」) → verdict → reconstruction → finale → done
 *                          └ composure 0 → suspended → back to investigation
 *                                                         verdict: lights 0 → gameover
 *
 * The server is authoritative for everything that matters (cleared rounds, solved,
 * reconstructed) and returns a fresh signed token on every call. The UI keeps only what
 * the bible assigns to it: composure (集中力), grant count, verdict attempts, lives, the current
 * phase and drafts — mirrored into the save (setInquest) so a reload resumes in place.
 *
 * The verdict format follows the case difficulty (VERDICT_MODE_BY_DIFFICULTY): choice / cloze /
 * free. api.verdictSetup returns the options with the debate assists applied (each cleared round
 * strikes out a choice, pre-fills a blank or reveals an element); available=false → free text.
 * Lives (Jane's lights, LIVES_BY_DIFFICULTY) drop by one per non-correct verdict; at 0 the
 * difficulty's game-over rule is written to the save (applyGameOver).
 *
 * Every costly event reports what it adds to the 事件スコア (`penalty`, rank.ts penaltyStep for
 * this case's difficulty) so the scene can flash 「減点 −n」 beside the control.
 *
 * Components read the signals; the scene drives the timed sequences (cut-ins, lines).
 */
import { batch, computed, signal } from '@preact/signals';
import type {
  CasePublic,
  Difficulty,
  HolmaMood,
  InquestRoundView,
  ProgressSnapshot,
  PublicFact,
  ReconstructionView,
  VerdictMode,
  VerdictRequest,
  VerdictResult,
  VerdictSetupResponse,
} from '../../../shared/api';
import { ApiError, LIVES_BY_DIFFICULTY, VERDICT_MODE_BY_DIFFICULTY } from '../../../shared/api';
import { api } from '../../api';
import type { Speaker } from '../../audio';
import { ensureToken, freshToken, restartCaseAfterBadToken } from '../investigation/caseData';
import { runModeOf } from '../../state/runMode';
import { caseList } from '../../lib/cases';
import { pickLine } from '../../lib/lines';
import { penaltyStep } from '../rank/rank';
import { runGameOvers } from '../rank/stats';
import { addFacts, caseDifficulty, getCaseProgress, resetCase, setInquest, setStage, setToken, updateCase } from '../../state/save';
import type { InquestPhase, InquestState } from '../../state/types';
import { parseCloze } from './cloze';

export type Phase = 'loading' | 'error' | 'debate' | 'suspended' | 'verdict' | 'reconstruction' | 'finale' | 'done' | 'gameover';
/** Sub-state of a debate round. */
export type DebateStep = 'intro' | 'play' | 'firing' | 'success' | 'clear';
/** Sub-state of the verdict. */
export type VerdictStep = 'write' | 'judging' | 'result';

export const MAX_COMPOSURE = 5;
export const VERDICT_MAX = 600;

export interface Say {
  speaker: Speaker;
  text: string;
  mood?: HolmaMood;
  /** Name plate override. */
  name?: string;
}

export interface Target {
  statementId: string;
  seg: number;
  text: string;
}

export interface VerdictView {
  result: VerdictResult;
  matched: string[];
  labels: Record<string, string>;
  lines: string[];
  text: string;
  /**
   * Holma's pointed feedback (every line after the lead: missing-element or wrong-claim
   * feedback). Kept under the checklist as 「ホルマの指摘」 until the next submission.
   */
  notes: string[];
  /** Element ids the solve requires (others are optional). Only when the server sends them. */
  required?: string[];
  /**
   * The server's safety filter answered instead of judging (the text confided self-harm):
   * not counted as an attempt. The UI shows no stamp — a calm line and a support card.
   */
  support?: boolean;
  /** The verdict format this judgement was made in. */
  mode?: VerdictMode;
  /** This miss put out Jane's last light. */
  gameOver?: boolean;
  /** What this miss costs the 事件スコア (0 for a correct verdict or at a cap). */
  penalty?: number;
}

export { parseCloze, type ClozePart } from './cloze';

export const SUPPORT_URL = 'https://www.mhlw.go.jp/mamorouyokokoro/';

/**
 * FALLBACK ONLY: the server says who speaks (ShotResponse.speaker). When an older server omits
 * it, guess from the wording (Jane talks plainly; Holma is polite / says あなた).
 */
export function successSpeaker(line: string): 'jane' | 'holma' {
  const t = line.trim();
  if (/あなた|審問官|ですとも|ねェ|なさい/.test(t)) return 'holma';
  if (/(です|ます|でした|ました|ません|でしょう)[。！？…」』]*$/.test(t)) return 'holma';
  return 'jane';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Drop blank lines at both ends (a stray Enter must never be saved as the verdict). */
export function tidyDraft(text: string): string {
  return text.replace(/^(?:[ \t\u3000]*\r?\n)+/, '').replace(/(?:\r?\n[ \t\u3000]*)+$/, '');
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export class InquestSession {
  readonly caseId: string;
  disposed = false;

  /* ---- data from the server ---- */
  info = signal<CasePublic | null>(null);
  rounds = signal<InquestRoundView[]>([]);
  evidence = signal<PublicFact[]>([]);
  progress = signal<ProgressSnapshot | null>(null);
  recon = signal<ReconstructionView | null>(null);
  finaleLines = signal<string[]>([]);

  /* ---- flow ---- */
  phase = signal<Phase>('loading');
  error = signal<string | null>(null);
  busy = signal(false);
  /** true on the very first entry (plays Holma's full opening). */
  firstEntry = true;
  /**
   * The server rejected the saved progress token (401 bad_token). Nothing can be verified any
   * more: the scene shows a blocking dialog whose only ways out restart the case.
   */
  tokenDead = signal(false);

  /* ---- debate ---- */
  roundIndex = signal(0);
  step = signal<DebateStep>('intro');
  current = signal(0);
  userPaused = signal(false);
  target = signal<Target | null>(null);
  selected = signal<string | null>(null);
  hint = signal<string | null>(null);
  roundMisses = signal(0);
  composure = signal(MAX_COMPOSURE);
  misses = signal(0);
  grants = signal(0);
  suspensions = signal(0);
  /** The 誤差 that just reacted (drawn developed blue). */
  broken = signal<Target | null>(null);
  /** Fact ids that just joined the evidence (NEW badge). */
  freshFacts = signal<Set<string>>(new Set());
  /** Ricochet feedback: key increments on each wrong shot. */
  missKey = signal(0);
  /** The player skipped the rest of the noise break. */
  debateSkipped = signal(false);

  /* ---- verdict ---- */
  verdictStep = signal<VerdictStep>('write');
  /**
   * true from entering the verdict until the 死因宣告 cut-in and Holma's prompt are over:
   * the sheet stays read-only and unfocused so Enter advances his line instead of typing.
   */
  verdictIntro = signal(false);
  draft = signal('');
  verdictAttempts = signal(0);
  verdict = signal<VerdictView | null>(null);
  /** Show the support card (see VerdictView.support). */
  support = signal(false);

  /* ---- difficulty, verdict format, lives, assists ---- */
  difficulty = signal<Difficulty>('normal');
  /** The format the verdict is declared in (free when the case has no verdictModes). */
  verdictMode = signal<VerdictMode>('cloze');
  setup = signal<VerdictSetupResponse | null>(null);
  setupState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** choice: the picked option id. */
  choice = signal<string | null>(null);
  /** choice: options already declared and judged wrong (crossed out, not selectable). */
  triedChoices = signal<string[]>([]);
  /** cloze: blank id → option index (as displayed). Assist-filled blanks are included and locked. */
  clozePicks = signal<Record<string, number>>({});
  /** Jane's lights: verdict retries left. */
  lives = signal(3);
  maxLives = signal(3);
  /** Debate assists earned / available (from verdictSetup; null = not known yet). */
  assists = signal<{ earned: number; total: number } | null>(null);

  /* ---- reconstruction ---- */
  picks = signal<Record<string, number>>({});
  verified = signal<Record<string, boolean>>({});
  wrongPanels = signal<Set<string>>(new Set());
  activePanel = signal<string | null>(null);
  finaleIndex = signal(-1);

  /* ---- dialogue (blocking lines) & bark (non-blocking quip) ---- */
  dialogue = signal<{ line: Say; key: number } | null>(null);
  bark = signal<{ text: string; key: number; tone: 'holma' | 'hint' | 'warn' } | null>(null);
  holmaMood = signal<HolmaMood>('normal');
  speaking = signal<Speaker | null>(null);

  private seq = 0;
  /** After a game over the save belongs to the restart rule: nothing may write the old run back. */
  private retired = false;
  private sayResolve: (() => void) | null = null;
  private barkTimer: ReturnType<typeof setTimeout> | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;

  round = computed(() => this.rounds.value[this.roundIndex.value] ?? null);
  statements = computed(() => this.round.value?.statements ?? []);
  selectedFact = computed(() => this.evidence.value.find((f) => f.id === this.selected.value) ?? null);
  ready = computed(() => !!this.target.value && !!this.selected.value && this.step.value === 'play' && !this.tokenDead.value);
  /** Rounds already cleared on the server. */
  cleared = computed(() => this.progress.value?.debateCleared ?? []);
  blanks = computed(() => (this.recon.value?.panels ?? []).filter((p) => p.choice));
  allPicked = computed(() => this.blanks.value.every((p) => typeof this.picks.value[p.id] === 'number'));
  /** Rounds not cleared yet (the player may go back to the noise break from the verdict). */
  openRounds = computed(() => this.rounds.value.filter((r) => !this.cleared.value.includes(r.id)));
  /** The verdict can be declared in the current format. */
  verdictReady = computed(() => {
    const mode = this.verdictMode.value;
    if (mode === 'free') return this.draft.value.trim().length >= 4;
    const st = this.setup.value;
    if (this.setupState.value !== 'ready' || !st) return false;
    if (mode === 'choice') {
      const c = this.choice.value;
      const opt = st.choice?.options.find((o) => o.id === c);
      return !!opt && !opt.removed && !this.triedChoices.value.includes(opt.id);
    }
    const picks = this.clozePicks.value;
    const blanks = st.cloze?.blanks ?? [];
    return blanks.length > 0 && blanks.every((b) => typeof picks[b.id] === 'number');
  });

  constructor(caseId: string) {
    this.caseId = caseId;
  }

  dispose() {
    this.disposed = true;
    this.sayResolve?.();
    this.sayResolve = null;
    clearTimeout(this.barkTimer);
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.persist({ verdictDraft: tidyDraft(this.draft.peek()) });
    }
  }

  /** Waits unless the scene is gone (then resolves at once). */
  wait(ms: number) {
    return this.disposed ? Promise.resolve() : sleep(ms);
  }

  /* ------------------------------------------------------------------ */
  /* Token & save                                                         */
  /* ------------------------------------------------------------------ */
  private token(): string | undefined {
    return getCaseProgress(this.caseId)?.token;
  }

  /** The case's own difficulty 1..3 (the rank's penalty sizes follow it). */
  private caseLevel(): number {
    return this.info.peek()?.difficulty ?? caseList.peek()?.find((c) => c.id === this.caseId)?.difficulty ?? 2;
  }

  /** What the game over about to be written costs (the run's counters restart on 審問官 / 教授, the game over stays). */
  gameOverPenalty(): number {
    return penaltyStep('gameOvers', runGameOvers(getCaseProgress(this.caseId)), this.caseLevel());
  }

  /** What one more suspension costs. */
  suspensionPenalty(): number {
    return penaltyStep('suspensions', this.suspensions.peek(), this.caseLevel());
  }

  private apply(res: { token: string; progress: ProgressSnapshot }) {
    if (this.retired) return;
    setToken(this.caseId, res.token, res.progress);
    this.progress.value = res.progress;
  }

  persist(patch: Partial<InquestState> = {}) {
    if (this.retired) return;
    if (this.disposed && !('verdictDraft' in patch)) return;
    const ph = this.phase.peek();
    const phase: InquestPhase = ph === 'verdict' ? 'verdict' : ph === 'reconstruction' || ph === 'finale' ? 'reconstruction' : ph === 'done' ? 'done' : 'debate';
    setInquest(this.caseId, {
      phase,
      roundIndex: this.roundIndex.peek(),
      composure: this.composure.peek(),
      cleared: [...(this.progress.peek()?.debateCleared ?? [])],
      misses: this.misses.peek(),
      grants: this.grants.peek(),
      verdictAttempts: this.verdictAttempts.peek(),
      suspensions: this.suspensions.peek(),
      reconstructionPicks: { ...this.picks.peek() },
      reconstructionDone: !!this.progress.peek()?.reconstructed,
      lives: this.lives.peek(),
      debateSkipped: this.debateSkipped.peek(),
      rounds: this.rounds.peek().length,
      verdictChoice: this.choice.peek() ?? undefined,
      triedChoices: [...this.triedChoices.peek()],
      verdictBlanks: { ...this.clozePicks.peek() },
      ...patch,
    });
  }

  fail(e: unknown, what: string) {
    const code = e instanceof ApiError ? e.code : 'server';
    if (code === 'bad_token' && !this.disposed) this.tokenDead.value = true;
    const msg =
      code === 'network' || code === 'timeout'
        ? '通信できませんでした。電波の良いところで、もう一度お試しください。'
        : code === 'rate_limited'
          ? '少し間を置いてから、もう一度お試しください。'
          : code === 'bad_token'
            ? '進行データを確認できませんでした。捜査からやり直してください。'
            : `${what}に失敗しました。もう一度お試しください。`;
    return { code, msg };
  }

  /* ------------------------------------------------------------------ */
  /* Load / resume                                                        */
  /* ------------------------------------------------------------------ */
  async load() {
    this.phase.value = 'loading';
    this.error.value = null;
    const saved = getCaseProgress(this.caseId)?.inquest;
    const difficulty = caseDifficulty(this.caseId);
    const maxLives = LIVES_BY_DIFFICULTY[difficulty] ?? 3;
    batch(() => {
      this.difficulty.value = difficulty;
      this.verdictMode.value = VERDICT_MODE_BY_DIFFICULTY[difficulty] ?? 'free';
      this.maxLives.value = maxLives;
      this.lives.value = typeof saved?.lives === 'number' && saved.lives > 0 ? Math.min(maxLives, saved.lives) : maxLives;
    });
    try {
      const [info, token] = await Promise.all([
        api.getCase(this.caseId).catch(() => null),
        this.token() ? Promise.resolve(this.token()!) : freshToken(this.caseId).then((r) => (this.apply(r), r.token)),
      ]);
      if (this.disposed) return;
      this.info.value = info;
      const start = await api.inquestStart({ caseId: this.caseId, token });
      if (this.disposed) return;
      batch(() => {
        this.apply(start);
        this.rounds.value = start.rounds;
        this.evidence.value = start.evidence;
        // UI-side counters from the save
        this.composure.value = saved && saved.composure > 0 ? Math.min(MAX_COMPOSURE, saved.composure) : MAX_COMPOSURE;
        this.misses.value = saved?.misses ?? start.progress.debateMisses;
        this.grants.value = saved?.grants ?? 0;
        this.suspensions.value = saved?.suspensions ?? 0;
        this.verdictAttempts.value = Math.max(saved?.verdictAttempts ?? 0, start.progress.verdictAttempts);
        this.draft.value = tidyDraft(saved?.verdictDraft ?? '');
        this.picks.value = saved?.reconstructionPicks ? { ...saved.reconstructionPicks } : {};
        this.debateSkipped.value = !!saved?.debateSkipped;
        this.choice.value = typeof saved?.verdictChoice === 'string' ? saved.verdictChoice : null;
        this.triedChoices.value = strList(saved?.triedChoices);
        this.clozePicks.value = saved?.verdictBlanks && typeof saved.verdictBlanks === 'object' ? { ...saved.verdictBlanks } : {};
        if (saved?.lastVerdict) {
          const lv = saved.lastVerdict;
          const req = strList(lv.required);
          this.verdict.value = { result: lv.result, matched: strList(lv.matched), labels: lv.labels ?? {}, text: lv.text ?? '', lines: [], notes: strList(lv.notes), ...(req.length ? { required: req } : {}) };
        }
      });
      this.firstEntry = !saved || (saved.cleared.length === 0 && saved.misses === 0 && saved.verdictAttempts === 0 && saved.suspensions === 0);
      setStage(this.caseId, 'inquest');

      const p = start.progress;
      if (p.reconstructed) {
        await this.loadRecon();
        this.phase.value = 'done';
      } else if (p.solved) {
        await this.loadRecon();
        this.phase.value = 'reconstruction';
      } else {
        const firstOpen = start.rounds.findIndex((r) => !p.debateCleared.includes(r.id));
        const skipped = this.debateSkipped.peek() && saved?.phase === 'verdict';
        if (firstOpen < 0 || !start.rounds.length || skipped) {
          this.roundIndex.value = Math.max(0, firstOpen < 0 ? start.rounds.length - 1 : firstOpen);
          this.verdictIntro.value = true; // until the scene's 死因宣告 cut-in has played
          this.phase.value = 'verdict';
          this.verdictStep.value = 'write';
        } else {
          this.roundIndex.value = firstOpen;
          this.debateSkipped.value = false;
          this.phase.value = 'debate';
          this.step.value = 'intro';
        }
        // the assists earned so far (HUD); entering the verdict awaits it again
        void this.loadSetup();
      }
      this.persist();
    } catch (e) {
      if (this.disposed) return;
      this.error.value = this.fail(e, '審問の準備').msg;
      this.phase.value = 'error';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dialogue                                                             */
  /* ------------------------------------------------------------------ */
  /** Show lines one by one; resolves when the player advances past the last. */
  async say(lines: Say[], onLine?: (i: number) => void) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (this.disposed) return;
      onLine?.(i);
      if (line.speaker === 'holma') this.holmaMood.value = line.mood ?? this.holmaMood.peek();
      this.speaking.value = line.speaker;
      await new Promise<void>((resolve) => {
        this.sayResolve = resolve;
        this.dialogue.value = { line, key: ++this.seq };
      });
    }
    this.dialogue.value = null;
    this.speaking.value = null;
  }

  advance() {
    const r = this.sayResolve;
    this.sayResolve = null;
    r?.();
  }

  /** Holma's non-blocking quip near his head. */
  quip(text: string, tone: 'holma' | 'hint' | 'warn' = 'holma', mood?: HolmaMood) {
    // A dead token is explained by its own blocking dialog; no transient SYSTEM bubble on top.
    if (this.tokenDead.peek() && tone === 'warn') return;
    clearTimeout(this.barkTimer);
    if (mood) this.holmaMood.value = mood;
    this.bark.value = { text, key: ++this.seq, tone };
    const ms = Math.max(3200, Math.min(7000, 1800 + [...text].length * 90));
    this.barkTimer = setTimeout(() => (this.bark.value = null), ms);
  }

  holma(path: string, fallbackMood: HolmaMood = 'normal'): Say {
    const l = pickLine(path, fallbackMood);
    return { speaker: 'holma', text: l.text, mood: l.mood };
  }

  /* ------------------------------------------------------------------ */
  /* Debate                                                               */
  /* ------------------------------------------------------------------ */
  /** Every round starts with an EMPTY CHAMBER: the bullet that broke the last round is spent. */
  resetRoundUi() {
    batch(() => {
      this.selected.value = null;
      this.current.value = 0;
      this.userPaused.value = false;
      this.target.value = null;
      this.hint.value = null;
      this.roundMisses.value = 0;
      this.broken.value = null;
    });
  }

  setTarget(t: Target | null) {
    if (this.step.peek() !== 'play') return;
    this.target.value = t;
  }

  select(factId: string | null) {
    if (this.step.peek() === 'firing') return;
    this.selected.value = factId;
    if (factId && this.freshFacts.peek().has(factId)) {
      const s = new Set(this.freshFacts.peek());
      s.delete(factId);
      this.freshFacts.value = s;
    }
  }

  /** Fire the loaded evidence at the locked noise. Returns null on transport failure. */
  async shoot(): Promise<{ correct: boolean; lines: string[]; speaker?: 'jane' | 'holma'; hint?: string; penalty: number } | null> {
    const round = this.round.peek();
    const t = this.target.peek();
    const f = this.selected.peek();
    const token = this.token();
    if (!round || !t || !f || !token) return null;
    // the rank reads the server's miss count (ProgressSnapshot.debateMisses)
    const missesBefore = this.progress.peek()?.debateMisses ?? this.misses.peek();
    try {
      const res = await api.shot({ caseId: this.caseId, token, roundId: round.id, statementId: t.statementId, span: t.text, factId: f });
      if (this.disposed) return null;
      this.apply(res);
      if (!res.correct) {
        batch(() => {
          this.misses.value++;
          this.roundMisses.value++;
          this.composure.value = Math.max(0, this.composure.peek() - 1);
          if (res.hint) this.hint.value = res.hint;
          this.missKey.value++;
        });
      }
      this.persist();
      const penalty = res.correct ? 0 : penaltyStep('misses', missesBefore, this.caseLevel());
      return { correct: res.correct, lines: res.lines, speaker: res.speaker, hint: res.hint, penalty };
    } catch (e) {
      const { msg } = this.fail(e, '所見の判定');
      this.quip(msg, 'warn');
      return null;
    }
  }

  /** 「ホルマに泣きつく」. Returns the granted fact, whether it was new (only a new one is charged) and its cost. */
  async beg(): Promise<{ fact: PublicFact; isNew: boolean; line: string; penalty: number } | null> {
    const round = this.round.peek();
    const token = this.token();
    if (!round || !token || this.busy.peek()) return null;
    this.busy.value = true;
    const grantsBefore = this.grants.peek();
    try {
      const res = await api.grant({ caseId: this.caseId, token, roundId: round.id });
      if (this.disposed) return null;
      this.apply(res);
      const fact = res.granted;
      if (!fact) return null;
      const isNew = !this.evidence.peek().some((x) => x.id === fact.id);
      batch(() => {
        if (isNew) {
          this.evidence.value = [...this.evidence.peek(), fact];
          this.grants.value++;
          this.freshFacts.value = new Set([...this.freshFacts.peek(), fact.id]);
        }
        this.selected.value = fact.id;
        if (!isNew && res.lines[0]) this.hint.value = res.lines[0];
      });
      if (isNew) addFacts(this.caseId, [fact]);
      this.persist();
      return { fact, isNew, line: res.lines[0] ?? '', penalty: isNew ? penaltyStep('grants', grantsBefore, this.caseLevel()) : 0 };
    } catch (e) {
      this.quip(this.fail(e, '所見の受け取り').msg, 'warn');
      return null;
    } finally {
      this.busy.value = false;
    }
  }

  /** Mark the current round cleared locally and move on. Returns true when it was the last. */
  nextRound(): boolean {
    const next = this.rounds.peek().findIndex((r) => !this.cleared.peek().includes(r.id));
    if (next < 0) return true;
    this.roundIndex.value = next;
    this.resetRoundUi();
    this.step.value = 'intro';
    this.persist();
    return false;
  }

  suspend() {
    batch(() => {
      this.suspensions.value++;
      this.phase.value = 'suspended';
    });
    // Come back fresh: composure refills when the inquest is reopened.
    this.persist({ composure: MAX_COMPOSURE, phase: 'debate' });
  }

  leaveToInvestigation() {
    setStage(this.caseId, 'investigation');
  }

  /** 「反証を飛ばして死因宣告へ」: the rounds left give no assists. */
  skipDebate() {
    batch(() => {
      this.debateSkipped.value = true;
      this.target.value = null;
      this.selected.value = null;
      this.hint.value = null;
    });
    this.persist({ debateSkipped: true });
  }

  /** From the verdict back to the first open noise-break round (to earn assists). */
  backToDebate(): boolean {
    const next = this.rounds.peek().findIndex((r) => !this.cleared.peek().includes(r.id));
    if (next < 0) return false;
    batch(() => {
      this.debateSkipped.value = false;
      this.roundIndex.value = next;
      this.resetRoundUi();
      this.step.value = 'intro';
      this.phase.value = 'debate';
    });
    this.persist({ phase: 'debate', debateSkipped: false });
    return true;
  }

  /**
   * After a bad_token: wipe this case's unverifiable progress (best rank / clears survive) and
   * fetch a fresh token, so the save never keeps a dead token. Never throws.
   */
  async restartAfterBadToken(): Promise<void> {
    this.disposed = true; // stop pending sequences from writing the old state back
    this.sayResolve?.();
    this.sayResolve = null;
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    await restartCaseAfterBadToken(this.caseId, this.info.peek() ?? undefined);
  }

  /* ------------------------------------------------------------------ */
  /* Verdict                                                              */
  /* ------------------------------------------------------------------ */
  setDraft(text: string) {
    this.draft.value = text;
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = undefined;
      this.persist({ verdictDraft: tidyDraft(this.draft.peek()) });
    }, 500);
  }

  /**
   * api.verdictSetup for the difficulty's format: the options with the debate assists applied.
   * Resolves to the assist gain (earned now − earned before). A case without verdictModes
   * (available=false) — or an engine without the endpoint — falls back to free text.
   */
  async loadSetup(): Promise<number> {
    const token = this.token();
    const want: VerdictMode = VERDICT_MODE_BY_DIFFICULTY[this.difficulty.peek()] ?? 'free';
    if (!token) return 0;
    const before = this.assists.peek()?.earned ?? 0;
    if (typeof (api as { verdictSetup?: unknown }).verdictSetup !== 'function') {
      this.useFreeFallback(want);
      return 0;
    }
    if (!this.setup.peek()) this.setupState.value = 'loading';
    try {
      const res = await api.verdictSetup({ caseId: this.caseId, token, mode: want });
      if (this.disposed) return 0;
      const mode: VerdictMode = res.available && res.mode === want ? want : 'free';
      batch(() => {
        this.setup.value = res;
        this.verdictMode.value = mode;
        this.assists.value = res.available ? { earned: res.assistsEarned ?? 0, total: res.assistsTotal ?? 0 } : null;
        this.setupState.value = 'ready';
        if (mode === 'cloze' && res.cloze) {
          // assist-filled blanks are locked in; stale saved picks outside the options are dropped
          const picks: Record<string, number> = {};
          for (const b of res.cloze.blanks) {
            const cur = this.clozePicks.peek()[b.id];
            if (typeof b.filled === 'number') picks[b.id] = b.filled;
            else if (typeof cur === 'number' && cur >= 0 && cur < b.options.length) picks[b.id] = cur;
          }
          this.clozePicks.value = picks;
        }
        if (mode === 'choice' && res.choice) {
          const ids = new Set(res.choice.options.filter((o) => !o.removed).map((o) => o.id));
          const c = this.choice.peek();
          if (c && !ids.has(c)) this.choice.value = null;
          this.triedChoices.value = this.triedChoices.peek().filter((id) => ids.has(id));
        }
      });
      return res.available ? Math.max(0, (res.assistsEarned ?? 0) - before) : 0;
    } catch (e) {
      if (this.disposed) return 0;
      const code = e instanceof ApiError ? e.code : 'server';
      if (code === 'bad_token') this.tokenDead.value = true;
      // A transport failure keeps the format and offers a retry; an engine that does not know
      // the endpoint (404 / bad request) plays the original free-text verdict.
      if (code === 'network' || code === 'timeout' || code === 'rate_limited') this.setupState.value = 'error';
      else this.useFreeFallback(want);
      return 0;
    }
  }

  private useFreeFallback(want: VerdictMode) {
    batch(() => {
      this.verdictMode.value = 'free';
      this.setupState.value = 'ready';
      this.assists.value = null;
      if (want !== 'free') this.setup.value = { mode: 'free', available: false, assistsEarned: 0, assistsTotal: 0 };
    });
  }

  pickChoice(id: string) {
    if (this.verdictStep.peek() !== 'write') return;
    this.choice.value = id;
    this.persist();
  }

  pickBlank(blankId: string, index: number) {
    if (this.verdictStep.peek() !== 'write') return;
    const b = this.setup.peek()?.cloze?.blanks.find((x) => x.id === blankId);
    if (!b || typeof b.filled === 'number') return;
    this.clozePicks.value = { ...this.clozePicks.peek(), [blankId]: index };
    this.persist();
  }

  /** The sentence as declared (for the record): the chosen option, or the cloze filled in. */
  private declaredText(mode: VerdictMode): string {
    const st = this.setup.peek();
    if (mode === 'choice') return st?.choice?.options.find((o) => o.id === this.choice.peek())?.text ?? '';
    if (mode === 'cloze' && st?.cloze) {
      const cloze = st.cloze;
      const picks = this.clozePicks.peek();
      return parseCloze(cloze.template)
        .map((p) => ('text' in p ? p.text : (cloze.blanks.find((b) => b.id === p.blank)?.options[picks[p.blank]] ?? '＿＿')))
        .join('');
    }
    return this.draft.peek().trim();
  }

  async declare(): Promise<VerdictView | null> {
    const mode = this.verdictMode.peek();
    const text = this.declaredText(mode);
    const token = this.token();
    if (!token || !this.verdictReady.peek() || !text) return null;
    const before = this.progress.peek()?.verdictAttempts ?? 0;
    const req: VerdictRequest =
      mode === 'choice'
        ? { caseId: this.caseId, token, mode, choice: this.choice.peek()! }
        : mode === 'cloze'
          ? { caseId: this.caseId, token, mode, blanks: { ...this.clozePicks.peek() } }
          : { caseId: this.caseId, token, mode: 'free', text };
    try {
      const res = await api.verdict(req);
      if (this.disposed) return null;
      this.apply(res);
      // Every judged verdict increments the server's attempt count; the safety reply does not.
      const support = res.notice === 'support' || (mode === 'free' && res.result !== 'correct' && (res.matched?.length ?? 0) === 0 && res.progress.verdictAttempts === before);
      if (support) {
        const view: VerdictView = { result: res.result, matched: [], labels: res.labels ?? {}, lines: res.lines, notes: [], text, support: true, mode };
        this.support.value = true;
        return view;
      }
      this.support.value = false;
      // Holma's lead line comes first; what follows points at the gaps (never the answer).
      const notes = res.result === 'correct' ? [] : res.lines.slice(1).filter((l) => l.trim());
      // `required` is optional on the wire: marks the other elements （任意） when present.
      const required = strList((res as { required?: unknown }).required);
      const miss = res.result !== 'correct';
      const lives = miss ? Math.max(0, this.lives.peek() - 1) : this.lives.peek();
      const gameOver = miss && lives <= 0;
      // A miss is one more retry (attempts before it were all misses). The miss that ends the run
      // costs a game over; on 審問官 / 教授 the run's retries are wiped with it, so only that stays.
      const level = this.caseLevel();
      const retry = miss ? penaltyStep('verdict', before, level) : 0;
      const penalty = !gameOver ? retry : this.gameOverPenalty() + (this.difficulty.peek() === 'easy' ? retry : 0);
      const view: VerdictView = {
        result: res.result,
        matched: res.matched ?? [],
        labels: res.labels ?? {},
        lines: res.lines,
        notes,
        text,
        mode,
        ...(required.length ? { required } : {}),
        ...(gameOver ? { gameOver: true } : {}),
        ...(penalty > 0 ? { penalty } : {}),
      };
      batch(() => {
        this.verdictAttempts.value = Math.max(this.verdictAttempts.peek() + 1, res.progress.verdictAttempts);
        this.verdict.value = view;
        this.lives.value = lives;
        const c = this.choice.peek();
        if (miss && mode === 'choice' && c) {
          this.triedChoices.value = [...new Set([...this.triedChoices.peek(), c])];
          this.choice.value = null;
        }
      });
      this.persist({
        lastVerdict: { result: view.result, matched: view.matched, labels: view.labels, text, notes, ...(view.required ? { required: view.required } : {}) },
        ...(mode === 'free' ? { verdictDraft: text } : {}),
      });
      return view;
    } catch (e) {
      this.quip(this.fail(e, '宣告').msg, 'warn');
      return null;
    }
  }

  /**
   * Jane's last light went out. The difficulty's rule is written to the save at once (a reload
   * during the game-over scene must not bring the dead run back):
   *   easy         → the case resumes from the START OF THE INQUEST: findings, token and
   *                  counters stay, the lights refill, the verdict drafts are cleared.
   *   normal/hard  → this case starts over from the beginning (resetCase keeps best rank, clears,
   *                  the restored name and the difficulty) with a new token. Other cases are
   *                  never touched.
   *   a special run whose game over ends it (online versus: 脱落, src/state/runMode.ts) → 'end':
   *                  nothing restarts, the run stays where it fell.
   */
  async applyGameOver(): Promise<'inquest' | 'restart' | 'end'> {
    const d = this.difficulty.peek();
    batch(() => {
      this.phase.value = 'gameover';
      this.target.value = null;
    });
    this.retired = true;
    this.sayResolve?.();
    this.sayResolve = null;
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    const gameOvers = (getCaseProgress(this.caseId)?.gameOvers ?? 0) + 1;
    if (runModeOf(this.caseId)?.gameOver) {
      updateCase(this.caseId, (c) => ({ ...c, stage: 'inquest', gameOvers, inquest: c.inquest ? { ...c.inquest, lives: 0 } : c.inquest }));
      return 'end';
    }
    if (d === 'easy') {
      const cur = getCaseProgress(this.caseId)?.inquest;
      updateCase(this.caseId, (c) => ({
        ...c,
        stage: 'inquest',
        gameOvers,
        inquest: {
          phase: 'debate',
          roundIndex: 0,
          composure: MAX_COMPOSURE,
          cleared: [...(this.progress.peek()?.debateCleared ?? cur?.cleared ?? [])],
          misses: cur?.misses ?? this.misses.peek(),
          grants: cur?.grants ?? this.grants.peek(),
          verdictAttempts: Math.max(cur?.verdictAttempts ?? 0, this.verdictAttempts.peek()),
          suspensions: cur?.suspensions ?? this.suspensions.peek(),
          rounds: this.rounds.peek().length,
          lives: this.maxLives.peek(),
          debateSkipped: false,
        },
      }));
      return 'inquest';
    }
    batch(() => {
      resetCase(this.caseId);
      updateCase(this.caseId, { gameOvers });
      setStage(this.caseId, 'intro');
    });
    await ensureToken(this.caseId, this.info.peek() ?? undefined);
    return 'restart';
  }

  /* ------------------------------------------------------------------ */
  /* Reconstruction                                                       */
  /* ------------------------------------------------------------------ */
  async loadRecon() {
    const token = this.token();
    if (!token) return;
    const view = await api.reconstruction({ caseId: this.caseId, token });
    if (this.disposed) return;
    this.recon.value = view;
    // drop saved picks that no longer fit
    const valid: Record<string, number> = {};
    for (const p of view.panels) {
      const v = this.picks.peek()[p.id];
      if (p.choice && typeof v === 'number' && v >= 0 && v < p.choice.options.length) valid[p.id] = v;
    }
    this.picks.value = valid;
  }

  pick(panelId: string, option: number) {
    if (this.verified.peek()[panelId]) return;
    this.picks.value = { ...this.picks.peek(), [panelId]: option };
    const w = new Set(this.wrongPanels.peek());
    w.delete(panelId);
    this.wrongPanels.value = w;
    this.persist();
  }

  async submitRecon(): Promise<{ allCorrect: boolean; wrong: string[] } | null> {
    const token = this.token();
    if (!token) return null;
    try {
      const res = await api.submitReconstruction({ caseId: this.caseId, token, picks: this.picks.peek() });
      if (this.disposed) return null;
      this.apply(res);
      const wrong = Object.entries(res.correct).filter(([, ok]) => !ok).map(([id]) => id);
      batch(() => {
        const v: Record<string, boolean> = {};
        for (const [id, ok] of Object.entries(res.correct)) if (ok) v[id] = true;
        this.verified.value = v;
        this.wrongPanels.value = new Set(wrong);
        if (res.finale) this.finaleLines.value = res.finale;
      });
      if (res.allCorrect) {
        // blanks now reveal their caption & art
        const token2 = this.token();
        if (token2) {
          try {
            this.recon.value = await api.reconstruction({ caseId: this.caseId, token: token2 });
          } catch {
            /* keep the blank view; captions come later */
          }
        }
      }
      this.persist({ reconstructionDone: res.allCorrect });
      return { allCorrect: res.allCorrect, wrong };
    } catch (e) {
      this.quip(this.fail(e, '再構成の確認').msg, 'warn');
      return null;
    }
  }

  clearWrongPicks(ids: string[]) {
    const p = { ...this.picks.peek() };
    for (const id of ids) delete p[id];
    this.picks.value = p;
    this.persist();
  }

  finish() {
    this.persist({ phase: 'done', reconstructionDone: true });
    setStage(this.caseId, 'resolution');
  }
}
