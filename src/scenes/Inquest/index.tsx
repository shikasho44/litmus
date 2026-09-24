/**
 * 死因審問 (INQUEST) — design bible §3-2.
 *   ① ノイズ・ブレイク  Jane's false memories flow across the stage as diagonal bands; shoot the
 *                      glowing noise with a finding. Composure 5; 2 misses → hint; 泣きつく → grant.
 *   ② 死因宣告          the player's own words; element checklist; unlimited retries.
 *   ③ 真相再構成        fill the blank comic frames; Holma narrates the finale → resolution.
 * State machine: src/features/inquest/session.ts. Components: src/features/inquest/*.
 */
import { gsap } from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FactCategory } from '../../../shared/case-schema';
import { goto, openOverlay, transitioning, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { fx, fxRefs } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { ART, useImage } from '../../lib/asset';
import { pickLine } from '../../lib/lines';
import { layout } from '../../lib/viewport';
import { useCaseTimer } from '../../state/hooks';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button, IconButton } from '../../ui/Button';
import { DialogueBox } from '../../ui/DialogueBox';
import { EvidenceCard, factTitle } from '../../ui/EvidenceCard';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { flyBullet, flyCard } from '../../features/inquest/bullet';
import { ComposureMeter } from '../../features/inquest/Composure';
import { DebateStage } from '../../features/inquest/DebateStage';
import { EvidenceList, LoadedCard } from '../../features/inquest/EvidenceList';
import { FireButton, HintBanner, InstructionStrip, PhaseRail, Quip } from '../../features/inquest/Hud';
import { ChoicePicker, ReconBoard } from '../../features/inquest/ReconBoard';
import { InquestSession, successSpeaker } from '../../features/inquest/session';
import { SuspendedOverlay } from '../../features/inquest/SuspendedOverlay';
import { TitleCard, type TitleCardSpec } from '../../features/inquest/TitleCard';
import { VERDICT_PROMPT, VerdictPanel } from '../../features/inquest/VerdictPanel';
import '../../features/inquest/inquest.css';
import './inquest.css';

const SHARDS = 34;

export function InquestScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const s = useMemo(() => new InquestSession(caseId), [caseId]);
  const narrow = layout.value === 'narrow';
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const camera = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ spec: TitleCardSpec; key: number; resolve: () => void } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [evSheet, setEvSheet] = useState(false);
  const [begAsk, setBegAsk] = useState(false);
  const [filter, setFilter] = useState<FactCategory | 'all'>('all');
  const [stampKey, setStampKey] = useState(0);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [choiceSheet, setChoiceSheet] = useState(false);
  const [reconShake, setReconShake] = useState(0);
  /** Statements stay off stage until the round card has announced the round. */
  const [bandsOn, setBandsOn] = useState(false);
  const [susp, setSusp] = useState<{ text: string; mood: 'normal' | 'laugh' | 'surprised' | 'serious' } | null>(null);
  const cardSeq = useRef(0);
  const bg = useImage(ART.inquest);
  useCaseTimer(caseId);

  const phase = s.phase.value;
  const step = s.step.value;
  const info = s.info.value;
  const stmt = s.statements.value[s.current.value];
  const dialogue = s.dialogue.value;

  /* ------------------------------------------------------------------ */
  /* helpers                                                              */
  /* ------------------------------------------------------------------ */
  const showCard = (spec: TitleCardSpec) =>
    new Promise<void>((resolve) => {
      if (s.disposed) return resolve();
      setCard({ spec, key: ++cardSeq.current, resolve });
    });

  const cam = (to: { x?: number; y?: number; scale?: number; rot?: number }, dur = 1.2, ease = 'power2.inOut') => {
    const el = camera.current;
    if (!el || motionReduced()) return;
    gsap.to(el, { xPercent: to.x ?? 0, yPercent: to.y ?? 0, scale: to.scale ?? 1, rotation: to.rot ?? 0, duration: dur, ease, overwrite: 'auto' });
  };
  const punch = (scale = 1.14) => {
    const el = camera.current;
    if (!el || motionReduced()) return;
    gsap.fromTo(el, { scale }, { scale: 1.04, duration: 0.7, ease: 'expo.out', overwrite: 'auto' });
  };

  const waitIdle = async () => {
    while (transitioning.peek() && !s.disposed) await s.wait(40);
  };

  /* ------------------------------------------------------------------ */
  /* sequences                                                            */
  /* ------------------------------------------------------------------ */
  const startRound = async (resumed = false) => {
    const r = s.round.peek();
    if (!r || s.disposed) return;
    const i = s.roundIndex.peek();
    const n = s.rounds.peek().length;
    s.resetRoundUi();
    s.step.value = 'intro';
    setBandsOn(false);
    cam({ scale: 1.02 }, 0.8);
    await showCard({ kicker: `NOISE BREAK · ROUND ${i + 1}`, title: r.title, sub: 'ノイズ・ブレイク — 記憶の矛盾を撃ち抜け', badge: `${i + 1}/${n}`, tone: 'alarm' });
    if (s.disposed) return;
    setBandsOn(true);
    if (!resumed && r.intro.length) await s.say(r.intro.map((t) => ({ speaker: 'holma', text: t, mood: /ククッ|クック/.test(t) ? 'laugh' : undefined })));
    if (s.disposed) return;
    s.step.value = 'play';
    if (i === 0 && !resumed) s.quip(pickLine('inquest.roundStart').text);
  };

  const openCourt = async () => {
    const el = camera.current;
    if (el && !motionReduced()) gsap.fromTo(el, { scale: 1.22, yPercent: -4 }, { scale: 1, yPercent: 0, duration: 1.8, ease: 'power3.out' });
    await s.wait(motionReduced() ? 100 : 420);
    audio.sfx('gavel');
    fx.shake(0.9);
    fx.flash('#FF2E63', { opacity: 0.35 });
    await fx.cutIn({ text: '死因審問 開廷', en: 'INQUEST · IN SESSION', tone: 'alarm', hold: 1.0 });
    if (s.disposed) return;
    audio.sfx('gavel');
    const r = s.round.peek();
    const introOpens = !!r?.intro[0] && /開廷/.test(r.intro[0]);
    if (s.firstEntry) {
      if (!introOpens) await s.say([s.holma('inquest.open', 'laugh')]);
      await startRound(false);
    } else {
      await s.say([s.holma('inquest.roundStart')]);
      await startRound(true);
    }
  };

  const enterVerdict = async (resumed: boolean) => {
    s.phase.value = 'verdict';
    s.verdictStep.value = 'write';
    s.target.value = null;
    s.persist();
    cam({ x: -2, scale: 1.08 }, 1.6);
    await fx.cutIn({ text: '死因宣告', en: 'DECLARE THE CAUSE OF DEATH', tone: 'bone', hold: 0.8, character: 'holma', mood: 'serious' });
    if (s.disposed) return;
    if (!resumed) {
      let l = pickLine('inquest.verdictPrompt', 'serious');
      for (let k = 0; k < 3 && l.text === VERDICT_PROMPT; k++) l = pickLine('inquest.verdictPrompt', 'serious');
      if (l.text !== VERDICT_PROMPT) await s.say([{ speaker: 'holma', text: l.text, mood: l.mood }]);
    }
  };

  const enterRecon = async (resumed: boolean) => {
    s.phase.value = 'reconstruction';
    s.persist();
    if (!s.recon.peek()) {
      try {
        await s.loadRecon();
      } catch {
        s.quip('再構成を読み込めませんでした。もう一度お試しください。', 'warn');
      }
    }
    cam({ scale: 1.12, y: -2 }, 1.4);
    await fx.cutIn({ text: '真相再構成', en: 'RECONSTRUCTION', tone: 'cyan', hold: 0.8 });
    if (s.disposed) return;
    if (!resumed) await s.say([s.holma('inquest.reconstructionIntro')]);
    const first = s.blanks.peek().find((p) => typeof s.picks.peek()[p.id] !== 'number');
    if (!narrowRef.current) setChoosing(first?.id ?? s.blanks.peek()[0]?.id ?? null);
  };

  const runFinale = async () => {
    const view = s.recon.peek();
    if (!view) return;
    s.phase.value = 'finale';
    setChoosing(null);
    audio.bgm('truth', 2.4);
    fx.setBackdrop('truth');
    await s.say([s.holma('inquest.reconstructionDone', 'serious')]);
    const lines = s.finaleLines.peek();
    const panels = view.panels;
    let prev = -1;
    await s.say(
      lines.map((t) => ({ speaker: 'holma' as const, text: t, mood: 'serious' as const })),
      (k) => {
        const pi = Math.min(panels.length - 1, Math.floor((k * panels.length) / Math.max(1, lines.length)));
        if (pi !== prev) {
          prev = pi;
          audio.sfx('page');
          s.finaleIndex.value = pi;
          s.activePanel.value = panels[pi].id;
        }
      },
    );
    if (s.disposed) return;
    s.activePanel.value = null;
    s.finaleIndex.value = panels.length - 1;
    audio.sfx('reveal');
    fx.flash('#FFFFFF', { opacity: 0.4 });
    await fx.cutIn({ text: '真相、解明', en: 'THE TRUTH, RESTORED', tone: 'formalin', hold: 1.0 });
    if (s.disposed) return;
    s.finish();
    goto('resolution', { caseId }, { replace: true });
  };

  const boot = async () => {
    await s.load();
    if (s.disposed || s.phase.peek() === 'error') return;
    await waitIdle();
    audio.bgm('inquest');
    fx.setBackdrop('alarm');
    const ph = s.phase.peek();
    if (ph === 'debate') await openCourt();
    else if (ph === 'verdict') {
      audio.sfx('gavel');
      await enterVerdict(true);
    } else if (ph === 'reconstruction') await enterRecon(true);
    else if (ph === 'done') {
      fx.setBackdrop('truth');
      s.finaleIndex.value = (s.recon.peek()?.panels.length ?? 1) - 1;
    }
  };

  useEffect(() => {
    void boot();
    return () => s.dispose();
  }, [s]);

  // The inquest stage is opaque and full-bleed: the living backdrop behind it is never seen,
  // so park its render loop while we are here (big win on phones).
  useEffect(() => {
    fxRefs.backdrop?.setAnimated(false);
    return () => fxRefs.backdrop?.setAnimated(!motionReduced());
  }, []);

  /* ------------------------------------------------------------------ */
  /* debate actions                                                       */
  /* ------------------------------------------------------------------ */
  const suspend = async () => {
    audio.sfx('error');
    fx.pulse('alarm');
    fx.shake(1.3);
    audio.bgm('none', 1.2);
    const l = pickLine('inquest.suspended', 'serious');
    setSusp({ text: l.text, mood: l.mood });
    s.suspend();
  };

  const fire = async () => {
    if (!s.ready.peek() || s.busy.peek() || s.dialogue.peek()) return;
    const t = s.target.peek()!;
    const fact = s.selectedFact.peek();
    if (!fact) return;
    s.busy.value = true;
    s.step.value = 'firing';
    const from =
      (narrowRef.current ? document.querySelector('[data-loaded-slot]') : document.querySelector(`.iq-mag [data-fact-id="${fact.id}"]`)) ?? document.querySelector('[data-loaded-fact]');
    const to = document.querySelector(`.band[data-statement-id="${t.statementId}"] .noise[data-seg="${t.seg}"]`);
    audio.sfx('whoosh');
    fx.speedLines(460, { kind: 'radial', color: 'rgba(198,255,61,0.4)' });
    cam({ scale: 1.1 }, 0.35, 'power3.in');
    const flight = flyBullet(from, to, factTitle(fact));
    const [res] = await Promise.all([s.shoot(), flight.impact]);
    if (s.disposed) return;
    if (!res) {
      void flight.finish(false);
      s.step.value = 'play';
      s.busy.value = false;
      return;
    }
    const r = to?.getBoundingClientRect();
    const cx = r ? r.left + r.width / 2 : undefined;
    const cy = r ? r.top + r.height / 2 : undefined;
    if (res.correct) {
      void flight.finish(true);
      s.broken.value = t;
      s.target.value = null;
      audio.sfx('refute');
      fx.shatter(cx, cy, { color: '#C6FF3D', count: 52 });
      fx.flash('#FFFFFF', { opacity: 0.6 });
      fx.shake(1.4);
      punch(1.16);
      await s.wait(motionReduced() ? 80 : 380);
      await fx.cutIn({ text: '反証！', en: 'REFUTATION', tone: 'formalin', hold: 0.75 });
      if (s.disposed) return;
      s.step.value = 'success';
      s.busy.value = false;
      fx.pulse('cyan', false);
      await s.say(res.lines.map((l) => ({ speaker: successSpeaker(l), text: l, mood: 'serious' as const })));
      if (s.disposed) return;
      s.step.value = 'clear';
      audio.sfx('findingCore');
      const title = s.round.peek()?.title ?? '';
      await showCard({ kicker: 'MEMORY RESTORED', title: '記憶修復', sub: title, tone: 'cyan', hold: 0.9 });
      if (s.disposed) return;
      const last = s.nextRound();
      if (last) await enterVerdict(false);
      else await startRound(false);
      return;
    }
    // miss
    void flight.finish(false);
    s.target.value = null;
    audio.sfx('error');
    fx.shake(1);
    fx.flash('#FF2E63', { opacity: 0.22 });
    cam({ scale: 1, rot: 0.6 }, 0.25, 'power2.out');
    setTimeout(() => cam({ scale: 1.02 }, 0.6), 260);
    s.quip(res.lines[0] ?? pickLine('inquest.wrongShot').text, 'holma', 'laugh');
    const c = s.composure.peek();
    if (c <= 0) {
      s.step.value = 'play';
      s.busy.value = false;
      await s.wait(1100);
      if (!s.disposed) await suspend();
      return;
    }
    if (res.hint) audio.sfx('reveal');
    if (c === 1) {
      fx.pulse('alarm');
      setTimeout(() => !s.disposed && s.phase.peek() === 'debate' && s.quip(pickLine('inquest.composureLow', 'serious').text, 'holma', 'serious'), 2600);
    }
    s.step.value = 'play';
    s.busy.value = false;
  };

  const beg = async () => {
    setBegAsk(false);
    const res = await s.beg();
    if (!res || s.disposed) return;
    setFilter('all');
    if (res.isNew) {
      audio.sfx('finding');
      fx.flash('#C6FF3D', { opacity: 0.25 });
      s.quip(res.line, 'holma', 'laugh');
      requestAnimationFrame(() => {
        const dest = narrowRef.current ? document.querySelector('[data-loaded-slot]') : document.querySelector(`.iq-mag [data-fact-id="${res.fact.id}"]`);
        void flyCard(document.querySelector('.iq__holma'), dest, factTitle(res.fact));
      });
    } else {
      audio.sfx('reveal');
      s.quip('その所見なら、もうお持ちですよ。……撃つ場所を、よくお考えなさい。', 'hint', 'normal');
    }
    requestAnimationFrame(() => document.querySelector(`.iq-mag [data-fact-id="${res.fact.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: motionReduced() ? 'auto' : 'smooth' }));
  };

  /* keyboard (debate): ↑↓ statements, ←→ noise, E evidence, Enter fire, Space pause, Esc unlock */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.phase.peek() !== 'debate' || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector('.modal-root, .sheet-root, .susp')) return;
      if (s.dialogue.peek() || s.step.peek() !== 'play') return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.matches('input, textarea, select, [contenteditable="true"]')) return;
      const sts = s.statements.peek();
      const n = sts.length;
      if (!n) return;
      const cur = s.current.peek();
      const noiseOf = (i: number) => sts[i].segments.map((g, k) => (g.noise ? k : -1)).filter((k) => k >= 0);
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          audio.sfx('page');
          s.target.value = null;
          s.current.value = (cur + (e.key === 'ArrowUp' ? -1 : 1) + n) % n;
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          const t = s.target.peek();
          let si = cur;
          let list = noiseOf(si);
          let pos = t && t.statementId === sts[si].id ? list.indexOf(t.seg) + dir : dir > 0 ? 0 : list.length - 1;
          if (pos < 0 || pos >= list.length) {
            si = (si + dir + n) % n;
            list = noiseOf(si);
            pos = dir > 0 ? 0 : list.length - 1;
            s.current.value = si;
          }
          const k = list[pos];
          if (k === undefined) break;
          audio.sfx('toggle');
          s.setTarget({ statementId: sts[si].id, seg: k, text: sts[si].segments[k].text });
          break;
        }
        case 'e':
        case 'E': {
          e.preventDefault();
          const all = s.evidence.peek();
          const list = filter === 'all' ? all : all.filter((f) => f.category === filter);
          if (!list.length) break;
          const i = list.findIndex((f) => f.id === s.selected.peek());
          const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
          audio.sfx('page');
          s.select(next.id);
          requestAnimationFrame(() => document.querySelector(`.iq-mag [data-fact-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }));
          break;
        }
        case 'Enter': {
          if (ae?.classList.contains('noise')) {
            const t = s.target.peek();
            const isT = t && ae.closest('.band')?.getAttribute('data-statement-id') === t.statementId && Number(ae.dataset.seg) === t.seg;
            if (!isT) return; // the noise handles its own lock / unlock
          } else if (ae?.classList.contains('evl__row')) {
            if (ae.dataset.factId !== s.selected.peek() || !s.ready.peek()) return;
          } else if (ae && ae.tagName === 'BUTTON' && !ae.hasAttribute('data-fire')) return;
          e.preventDefault();
          if (s.ready.peek()) void fire();
          else if (!s.target.peek()) {
            const k = noiseOf(cur)[0];
            if (k !== undefined) s.setTarget({ statementId: sts[cur].id, seg: k, text: sts[cur].segments[k].text });
          } else s.quip('所見を選んで装填してください（E キーで切り替え）。', 'hint');
          break;
        }
        case ' ': {
          if (ae && ae.tagName === 'BUTTON') return;
          e.preventDefault();
          audio.sfx('toggle');
          s.userPaused.value = !s.userPaused.peek();
          break;
        }
        case 'Escape': {
          if (s.target.peek()) {
            e.preventDefault();
            audio.sfx('cancel');
            s.target.value = null;
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, filter]);

  /* phone: locking a noise with an empty chamber opens the magazine right away */
  const tgt = s.target.value;
  useEffect(() => {
    if (!narrow || !tgt || s.selected.peek() || s.step.peek() !== 'play') return;
    const t = setTimeout(() => setDrawer(true), 320);
    return () => clearTimeout(t);
  }, [tgt?.statementId, tgt?.seg, narrow]);

  /* camera follows the speaker of the flowing statement */
  useEffect(() => {
    if (phase !== 'debate' || step !== 'play' || !stmt) return;
    if (s.target.peek()) return;
    cam(stmt.speaker === 'jane' ? { x: 1.4, scale: 1.05, rot: -0.35 } : { x: -1.4, scale: 1.05, rot: 0.35 }, 1.6);
  }, [stmt?.id, phase, step]);
  useEffect(() => {
    if (phase === 'debate' && step === 'play' && s.target.value) cam({ scale: 1.09 }, 0.6, 'power3.out');
  }, [!!s.target.value]);

  /* ------------------------------------------------------------------ */
  /* verdict / reconstruction actions                                     */
  /* ------------------------------------------------------------------ */
  const submitVerdict = async () => {
    if (s.verdictStep.peek() !== 'write' || s.dialogue.peek()) return;
    s.verdictStep.value = 'judging';
    audio.sfx('send');
    cam({ x: 0, scale: 1.14 }, 2.2, 'power1.inOut');
    fx.pulse('alarm');
    const beat = setInterval(() => fx.pulse('alarm'), 1150);
    const t0 = performance.now();
    const view = await s.declare();
    const rest = (motionReduced() ? 600 : 1900) - (performance.now() - t0);
    if (rest > 0) await s.wait(rest);
    clearInterval(beat);
    if (s.disposed) return;
    if (!view) {
      s.verdictStep.value = 'write';
      cam({ x: -2, scale: 1.08 }, 0.8);
      return;
    }
    if (view.support) {
      // The safety reply: no stamp, no joke — a calm line and the support card.
      s.verdictStep.value = 'write';
      cam({ x: -2, scale: 1.04 }, 0.8);
      await s.say(view.lines.map((l) => ({ speaker: 'holma' as const, text: l, mood: 'serious' as const })));
      return;
    }
    setStampKey((k) => k + 1);
    s.verdictStep.value = 'result';
    cam({ x: -2, scale: 1.06 }, 0.5, 'expo.out');
    await s.wait(motionReduced() ? 500 : 1300);
    const lead = view.result === 'correct' ? 'surprised' : view.result === 'wrong' ? 'laugh' : 'normal';
    await s.say(view.lines.map((l, i) => ({ speaker: 'holma' as const, text: l, mood: i === 0 ? lead : ('serious' as const) })));
    if (s.disposed) return;
    if (view.result === 'correct') {
      audio.sfx('reveal');
      fx.flash('#C6FF3D', { opacity: 0.45 });
      fx.shake(1.2);
      await fx.cutIn({ text: '死因確定', en: 'CAUSE OF DEATH CONFIRMED', tone: 'formalin', hold: 1.0 });
      if (s.disposed) return;
      await enterRecon(false);
    } else {
      s.verdictStep.value = 'write';
    }
  };

  const submitRecon = async () => {
    if (s.busy.peek() || !s.allPicked.peek()) return;
    s.busy.value = true;
    audio.sfx('confirm');
    const res = await s.submitRecon();
    s.busy.value = false;
    if (!res || s.disposed) return;
    if (!res.allCorrect) {
      audio.sfx('error');
      fx.shake(0.8);
      setReconShake((k) => k + 1);
      const wrongIdx = (s.recon.peek()?.panels ?? []).filter((p) => res.wrong.includes(p.id)).map((p) => p.id);
      await s.say([s.holma('inquest.reconstructionWrong', 'laugh')]);
      if (s.disposed) return;
      s.clearWrongPicks(res.wrong);
      if (!narrowRef.current) setChoosing(wrongIdx[0] ?? null);
      return;
    }
    audio.sfx('findingCore');
    fx.flash('#3DE0FF', { opacity: 0.35 });
    await runFinale();
  };

  const openPanel = (id: string) => {
    audio.sfx('page');
    setChoosing(id);
    if (narrowRef.current) setChoiceSheet(true);
  };

  /* ------------------------------------------------------------------ */
  /* render                                                               */
  /* ------------------------------------------------------------------ */
  const progress = s.progress.value;
  // Each corrected memory lights a few more of her shards.
  const revealed = Math.min(SHARDS, Math.round((progress?.progress ?? 0) * SHARDS) + s.cleared.value.length * 3);
  const janeFocus = (phase === 'debate' && stmt?.speaker === 'jane') || s.speaking.value === 'jane';
  const holmaFocus = (phase === 'debate' && stmt?.speaker === 'holma') || s.speaking.value === 'holma' || phase === 'verdict';
  const inDebate = phase === 'debate';
  const inRecon = phase === 'reconstruction' || phase === 'finale' || phase === 'done';
  const canBeg = inDebate && step === 'play' && !s.busy.value;
  const title = info ? info.title : '死因審問';

  return (
    <section
      class={`scene iq iq--${phase} ${narrow ? 'is-narrow' : 'is-wide'}`}
      data-phase={phase}
      data-step={inDebate ? step : undefined}
      data-verdict-step={phase === 'verdict' ? s.verdictStep.value : undefined}
      data-dialogue={dialogue ? 'on' : 'off'}
      data-busy={s.busy.value ? 'on' : 'off'}
      data-card={card ? 'on' : 'off'}
      aria-label="死因審問"
    >
      {/* ---------- stage (full bleed; fx anchor) ---------- */}
      <div class="iq__stage" data-stage>
        <div ref={camera} class="iq__camera">
          <div class={`iq__bg ${bg ? 'has-img' : ''}`} aria-hidden="true">
            {bg ? <img src={bg} alt="" /> : <div class="iq__bg-fallback" />}
          </div>
          <div class="iq__spot" aria-hidden="true" />
          <div class={`iq__jane ${janeFocus ? 'is-focus' : ''}`} aria-hidden="true">
            <ShardPortrait image={info?.portrait} revealed={revealed} seed={caseId} shardCount={SHARDS} glow={janeFocus} label="ジェーン・ドゥ" />
          </div>
          <div class={`iq__holma ${holmaFocus ? 'is-focus' : ''}`} aria-hidden="true">
            <HolmaSprite mood={s.holmaMood.value} talking={s.speaking.value === 'holma'} framing="knee" rim={holmaFocus ? 'rgba(255,46,99,0.32)' : undefined} />
          </div>
        </div>
        <div class="iq__tint" aria-hidden="true" />
        <div class="iq__lines" aria-hidden="true" />
      </div>

      {/* ---------- top bar ---------- */}
      <header class="iq__top">
        <div class="iq__title">
          <span class="iq__en">INQUEST</span>
          <span class="iq__jp">死因審問</span>
          {!narrow && <span class="iq__case">{title}</span>}
        </div>
        {!narrow && <PhaseRail phase={phase} />}
        <div class="spacer" />
        {inDebate && (
          <>
            <ComposureMeter value={s.composure.value} compact={narrow} />
            {narrow ? (
              <IconButton icon="rabbit" label="ホルマに泣きつく" disabled={!canBeg} onClick={() => setBegAsk(true)} data-beg />
            ) : (
              <Button variant="ghost" size="sm" icon="rabbit" disabled={!canBeg} onClick={() => setBegAsk(true)} sfx="open" data-beg>
                ホルマに泣きつく
              </Button>
            )}
          </>
        )}
        <IconButton icon="settings" label="設定" onClick={() => openOverlay('settings')} />
      </header>

      {/* ---------- arena ---------- */}
      <div class="iq__arena">
        {phase === 'loading' && (
          <div class="iq__loading" role="status">
            <span class="iq__loading-gavel" aria-hidden="true">
              <Icon name="gavel" size={42} />
            </span>
            <span>開廷の準備をしています…</span>
          </div>
        )}
        {phase === 'error' && (
          <div class="iq__error" role="alert">
            <p class="eyebrow">CONNECTION</p>
            <h2 class="t-display t-xl">審問を開けませんでした</h2>
            <p class="t-sm t-bone2">{s.error.value}</p>
            <div class="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <Button icon="refresh" onClick={() => void boot()}>
                もう一度
              </Button>
              <Button
                variant="ghost"
                icon="back"
                sfx="cancel"
                onClick={() => {
                  s.leaveToInvestigation();
                  goto('investigation', { caseId }, { replace: true });
                }}
              >
                捜査に戻る
              </Button>
            </div>
          </div>
        )}

        {inDebate && (
          <>
            {s.hint.value && step !== 'success' && step !== 'clear' && (
              <div class="iq__hint">
                <HintBanner text={s.hint.value} canBeg={canBeg} onBeg={() => setBegAsk(true)} />
              </div>
            )}
            {bandsOn && <DebateStage session={s} narrow={narrow} hold={drawer || begAsk || evSheet} />}
            {(step === 'play' || step === 'firing') && (
              <div class="iq__strip">
                <InstructionStrip session={s} narrow={narrow} />
              </div>
            )}
          </>
        )}

        {phase === 'verdict' && (
          <div class="iq__verdict">
            <VerdictPanel
              session={s}
              stampKey={stampKey}
              autoFocus={!narrow}
              onSubmit={() => void submitVerdict()}
              onOpenEvidence={() => setEvSheet(true)}
              onStampImpact={() => {
                const v = s.verdict.peek();
                audio.sfx('stamp', { answerClass: v?.result === 'correct' ? 'yes' : v?.result === 'wrong' ? 'no' : 'partial' });
                fx.shake(v?.result === 'correct' ? 1.3 : 0.9, 0.35);
                if (v?.result === 'correct') fx.flash('#C6FF3D', { opacity: 0.3 });
              }}
            />
          </div>
        )}

        {inRecon && (
          <div class="iq__recon">
            <ReconBoard
              session={s}
              narrow={narrow}
              choosing={choosing}
              shakeKey={reconShake}
              onOpenPanel={openPanel}
              onSubmit={() => void submitRecon()}
              onFinish={() => {
                s.finish();
                goto('resolution', { caseId }, { replace: true });
              }}
            />
          </div>
        )}

        <Quip session={s} />
      </div>

      {/* ---------- PC magazine column / phone dock ---------- */}
      {inDebate && !narrow && (
        <aside class="iq-mag" aria-label="所見（弾）">
          <div class="iq-mag__head">
            <span class="iq-mag__en">MAGAZINE</span>
            <h2 class="iq-mag__jp">
              所見 <small>{s.evidence.value.length}</small>
            </h2>
          </div>
          <div class="iq-mag__list">
            <EvidenceList
              facts={s.evidence.value}
              selected={s.selected.value}
              fresh={s.freshFacts.value}
              filter={filter}
              onFilter={setFilter}
              disabled={step === 'firing' || step === 'intro'}
              onPick={(id) => s.select(id)}
            />
          </div>
          <div class="iq-mag__loaded">
            <LoadedCard fact={s.selectedFact.value} />
          </div>
          <div class="iq-mag__fire">
            <FireButton session={s} onFire={() => void fire()} />
          </div>
        </aside>
      )}
      {inDebate && narrow && (
        <div class="iq-dock">
          <button type="button" class="iq-dock__loaded" data-loaded-slot onClick={() => setDrawer(true)} disabled={step === 'firing'} aria-label={`所見を選ぶ（${s.selectedFact.value ? `装填中：${factTitle(s.selectedFact.value)}` : '未装填'}）`}>
            <LoadedCard fact={s.selectedFact.value} compact />
            <span class="iq-dock__open" aria-hidden="true">
              <Icon name="chevronDown" size={16} />
              所見
            </span>
          </button>
          <FireButton session={s} onFire={() => void fire()} compact />
        </div>
      )}

      {/* ---------- dialogue ---------- */}
      {dialogue && (
        <div class={`iq__dialogue speaker-${dialogue.line.speaker}`} data-inquest-dialogue>
          <DialogueBox speaker={dialogue.line.speaker} text={dialogue.line.text} name={dialogue.line.name} lineKey={dialogue.key} onAdvance={() => s.advance()} glitch={dialogue.line.speaker === 'jane'} size={narrow ? 'md' : 'lg'} />
        </div>
      )}

      {card && (
        <TitleCard
          key={card.key}
          spec={card.spec}
          onDone={() => {
            card.resolve();
            setCard(null);
          }}
        />
      )}

      {phase === 'suspended' && susp && (
        <SuspendedOverlay
          line={susp.text}
          mood={susp.mood}
          onBack={() => {
            s.leaveToInvestigation();
            audio.bgm('investigation');
            goto('investigation', { caseId }, { replace: true });
          }}
        />
      )}

      {/* ---------- sheets & dialogs ---------- */}
      <BottomSheet open={drawer} onClose={() => setDrawer(false)} title="所見を装填" en="MAGAZINE" side="bottom">
        <EvidenceList
          facts={s.evidence.value}
          selected={s.selected.value}
          fresh={s.freshFacts.value}
          filter={filter}
          onFilter={setFilter}
          touch
          onPick={(id) => {
            s.select(id);
            setDrawer(false);
          }}
        />
        <div class="iq-drawer__loaded">
          <LoadedCard fact={s.selectedFact.value} />
        </div>
      </BottomSheet>

      <BottomSheet open={evSheet} onClose={() => setEvSheet(false)} title="所見を見返す" en="FINDINGS" side="auto">
        <div class="iq-evsheet">
          {s.evidence.value.map((f, i) => (
            <EvidenceCard key={f.id} fact={f} index={i} />
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={choiceSheet && !!choosing} onClose={() => setChoiceSheet(false)} title="空白のコマ" en="BLANK PANEL" side="bottom">
        {choosing && <ChoicePicker session={s} panelId={choosing} onPicked={() => setTimeout(() => setChoiceSheet(false), 180)} />}
      </BottomSheet>

      <Modal
        open={begAsk}
        onClose={() => setBegAsk(false)}
        title="ホルマに泣きつく"
        en="BEG FOR EVIDENCE"
        size="sm"
        tone="alarm"
        footer={
          <>
            <Button variant="ghost" sfx="cancel" onClick={() => setBegAsk(false)}>
              やめておく
            </Button>
            <Button variant="danger" icon="rabbit" onClick={() => void beg()} data-autofocus data-beg-confirm>
              泣きつく
            </Button>
          </>
        }
      >
        <p class="iq-beg__p">このラウンドを崩すための所見を、ホルマが1枚だけ貸してくれます。</p>
        <p class="iq-beg__note">
          <Icon name="info" size={14} /> 使うと審問官ランクに響きます（{s.grants.value > 0 ? `これまで ${s.grants.value} 回` : 'まだ 0 回'}）。すでに持っている場合は、ヒントだけもらえます。
        </p>
      </Modal>
    </section>
  );
}
