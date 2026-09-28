/**
 * 事件の導入 (INTRO) — cinematic, skippable case opening.
 *
 *   title   CASE number slam → title (JP + EN) → forensic readout        (auto, click = finish)
 *   story   discovery narration over the case background (slow push-in)
 *   jane    the glass-shard Jane Doe glitches in; her fragmented lines (Shippori Mincho)
 *   holma   Holma steps in (hip framing) with his opening lines
 *   catch   「さァ——解剖（しらべ）を始めましょう」 cut-in → investigation
 *
 * First entry creates the case token (api.newToken). Players who already started the case
 * are forwarded to where they left off; `?replay=1` (from the investigation menu) replays.
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CasePublic, HolmaMood } from '../../../shared/api';
import { sceneForStage } from '../../app/flow';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { motionReduced } from '../../fx/motion';
import { useImage } from '../../lib/asset';
import { layout } from '../../lib/viewport';
import { getCaseProgress, setStage } from '../../state/save';
import { Button, IconButton } from '../../ui/Button';
import { DialogueBox } from '../../ui/DialogueBox';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { caseNo, ensureToken, useCasePublic } from '../../features/investigation/caseData';
import './intro.css';

type Step =
  | { kind: 'title' }
  | { kind: 'narration'; text: string }
  | { kind: 'jane'; text: string }
  | { kind: 'holma'; text: string; mood: HolmaMood }
  | { kind: 'catch' };

function holmaMood(text: string, i: number, n: number): HolmaMood {
  if (/クック|ククッ/.test(text)) return 'laugh';
  if (i === n - 1) return 'laugh';
  if (/^おや|おや、/.test(text)) return 'surprised';
  if (/掟|死因|魂/.test(text)) return 'serious';
  return 'normal';
}

function buildScript(p: CasePublic): Step[] {
  return [
    { kind: 'title' },
    ...p.narration.map((text) => ({ kind: 'narration' as const, text })),
    ...p.janeIntro.map((text) => ({ kind: 'jane' as const, text })),
    ...p.holmaIntro.map((text, i) => ({ kind: 'holma' as const, text, mood: holmaMood(text, i, p.holmaIntro.length) })),
    { kind: 'catch' },
  ];
}

/* ------------------------------------------------------------------ */
/* Title card                                                          */
/* ------------------------------------------------------------------ */
function TitleCard({ pub, onDone, finishKey }: { pub: CasePublic; onDone: () => void; finishKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const q = (s: string) => el.querySelectorAll(s);
    const t = gsap.timeline({ onComplete: () => doneRef.current() });
    tl.current = t;
    if (motionReduced()) {
      t.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3 }).to({}, { duration: 3.2 });
      return () => t.kill();
    }
    t.set(q('.itc__row'), { clipPath: 'inset(0 100% 0 0)' })
      .fromTo(q('.itc__band'), { scaleX: 0 }, { scaleX: 1, duration: 0.32, ease: 'expo.out' }, 0.1)
      .fromTo(q('.itc__case'), { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'expo.out' }, 0.22)
      .fromTo(q('.itc__num'), { scale: 3.2, opacity: 0, rotation: -18 }, { scale: 1, opacity: 1, rotation: -6, duration: 0.24, ease: 'power4.in' }, 0.36)
      .add(() => {
        audio.sfx('gavel');
        fx.shake(1.3, 0.4);
        fx.flash('#C6FF3D', { opacity: 0.28, duration: 0.4 });
      }, 0.6)
      .fromTo(q('.itc__num-shadow'), { opacity: 0, x: 0, y: 0 }, { opacity: 1, x: 10, y: 10, duration: 0.2 }, 0.62)
      .fromTo(q('.itc__kicker'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.8)
      .fromTo(q('.itc__title'), { clipPath: 'inset(0 100% 0 0)', x: 30 }, { clipPath: 'inset(0 0% 0 0)', x: 0, duration: 0.6, ease: 'expo.out' }, 1.05)
      .add(() => audio.sfx('whoosh'), 1.05)
      .fromTo(q('.itc__title-en'), { opacity: 0, letterSpacing: '0.9em' }, { opacity: 1, letterSpacing: '0.38em', duration: 0.8, ease: 'power3.out' }, 1.3);
    q('.itc__row').forEach((row, i) => {
      t.to(row, { clipPath: 'inset(0 0% 0 0)', duration: 0.42, ease: 'steps(18)' }, 1.9 + i * 0.36).add(() => audio.blip('system'), 1.9 + i * 0.36);
    });
    t.fromTo(q('.itc__cause'), { opacity: 0.2 }, { opacity: 1, duration: 0.1, repeat: 4, yoyo: true }, 3.5).addLabel('hold').to({}, { duration: 1.3 });
    return () => t.kill();
  }, []);

  // First click: jump to the fully revealed card and wait (the player now sets the pace).
  // Second click (or 6 s): continue.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!finishKey || !tl.current) return;
    const t = tl.current;
    if (!waiting) {
      t.pause();
      t.seek(t.labels.hold ?? t.duration());
      setWaiting(true);
      return;
    }
    doneRef.current();
  }, [finishKey]);
  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => doneRef.current(), 6000);
    return () => clearTimeout(id);
  }, [waiting]);

  return (
    <div class="itc" ref={ref}>
      <div class="itc__band" aria-hidden="true" />
      <div class="itc__head">
        <span class="itc__case">CASE</span>
        <span class="itc__num-wrap">
          <span class="itc__num-shadow" aria-hidden="true">
            {caseNo(pub.number)}
          </span>
          <span class="itc__num">{caseNo(pub.number)}</span>
        </span>
      </div>
      <p class="itc__kicker t-mono">
        {pub.codename} — CAUSE OF DEATH: UNDETERMINED
      </p>
      <h1 class="itc__title">{pub.title}</h1>
      <p class="itc__title-en">{pub.titleEn}</p>
      <dl class="itc__readout t-mono" aria-label="発見記録">
        <div class="itc__row">
          <dt>LOCATION</dt>
          <dd>{pub.location}</dd>
        </div>
        <div class="itc__row">
          <dt>TIME</dt>
          <dd>{pub.time}</dd>
        </div>
        <div class="itc__row">
          <dt>SUBJECT</dt>
          <dd>{pub.codename}　身元不明</dd>
        </div>
        <div class="itc__row">
          <dt>CAUSE</dt>
          <dd class="itc__cause">
            <span class="itc__redact" aria-hidden="true" />
            未確定
          </dd>
        </div>
      </dl>
      {waiting && (
        <p class="itc__continue t-mono" aria-hidden="true">
          ▼ TAP TO CONTINUE
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Catchphrase cut-in                                                  */
/* ------------------------------------------------------------------ */
function CatchCutIn({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const q = (s: string) => el.querySelectorAll(s);
    const t = gsap.timeline({ onComplete: () => doneRef.current() });
    audio.sfx('cutin');
    if (motionReduced()) {
      t.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25 }).to({}, { duration: 1.6 });
      return () => t.kill();
    }
    fx.speedLines(1500, { kind: 'radial', color: 'rgba(198,255,61,0.45)' });
    t.fromTo(q('.icc__back'), { scaleY: 0 }, { scaleY: 1, duration: 0.18, ease: 'power3.out' }, 0)
      .fromTo(q('.icc__band'), { scaleY: 0 }, { scaleY: 1, duration: 0.2, ease: 'power3.out' }, 0.05)
      .fromTo(q('.icc__holma'), { xPercent: -60, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.45, ease: 'expo.out' }, 0.1)
      .fromTo(q('.icc__sa'), { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'expo.out' }, 0.18)
      .fromTo(q('.icc__main'), { scale: 1.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'power4.in' }, 0.38)
      .add(() => {
        audio.sfx('gavel');
        fx.shake(1.2, 0.36);
      }, 0.6)
      .fromTo(q('.icc__en'), { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.4, ease: 'expo.out' }, 0.64)
      .to(q('.icc__main'), { x: -10, duration: 1.3, ease: 'none' }, 0.62)
      .to(q('.icc__sa, .icc__main, .icc__en, .icc__holma'), { opacity: 0, x: '-=60', duration: 0.24, ease: 'power3.in' }, 2.0)
      .to(q('.icc__band, .icc__back'), { scaleY: 0, duration: 0.22, ease: 'power3.in' }, 2.08);
    return () => t.kill();
  }, []);
  return (
    <div class="icc" ref={ref} role="img" aria-label="さァ——解剖（しらべ）を始めましょう">
      <div class="icc__back" aria-hidden="true" />
      <div class="icc__band" aria-hidden="true">
        <div class="icc__lines" />
        <div class="icc__holma">
          <HolmaSprite mood="laugh" framing="bust" idle={false} />
        </div>
        <div class="icc__copy">
          <span class="icc__sa">さァ——</span>
          <span class="icc__main">
            <ruby>
              解剖<rt>しらべ</rt>
            </ruby>
            を始めましょう
          </span>
          <span class="icc__en">LET THE AUTOPSY BEGIN</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
export function IntroScene({ params }: SceneProps) {
  const caseId = params.caseId!;
  const replay = params.replay === '1';
  const { data: pub, status, retry } = useCasePublic(caseId);
  const steps = useMemo(() => (pub ? buildScript(pub) : [{ kind: 'title' } as Step]), [pub]);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const [finishKey, setFinishKey] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const dlgRef = useRef<HTMLDivElement>(null);
  const janeRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLImageElement>(null);
  const bg = useImage(pub?.background);
  const narrow = layout.value === 'narrow';
  const step = steps[Math.min(i, steps.length - 1)];
  const kind = step.kind;
  const janeIn = steps.slice(0, i + 1).some((s) => s.kind === 'jane');
  const holmaIn = steps.slice(0, i + 1).some((s) => s.kind === 'holma') || kind === 'catch';
  const holmaStep = [...steps.slice(0, i + 1)].reverse().find((s) => s.kind === 'holma') as Extract<Step, { kind: 'holma' }> | undefined;

  // returning players go straight to where they left off
  useEffect(() => {
    if (replay) return;
    const c = getCaseProgress(caseId);
    if (c && c.stage !== 'new' && c.stage !== 'intro' && c.stage !== 'complete') {
      goto(sceneForStage(c.stage), { caseId }, { replace: true });
      return;
    }
    setStage(caseId, 'intro');
    audio.bgm('none', 0.8);
  }, []);

  // token on first entry (in parallel with the cinematic)
  useEffect(() => {
    if (pub && !replay) void ensureToken(caseId, pub);
  }, [pub]);

  // per-step cues
  useEffect(() => {
    if (kind === 'narration' && steps[i - 1]?.kind === 'title') {
      audio.bgm('investigation', 2.4);
    }
    if (kind === 'jane' && steps[i - 1]?.kind !== 'jane') {
      audio.sfx('reveal');
      setTimeout(() => fx.glitch(janeRef.current), 260);
      fx.pulse('cyan', false);
    }
    if (kind === 'holma' && steps[i - 1]?.kind !== 'holma') {
      audio.sfx('whoosh');
    }
  }, [i, kind]);

  // phone staging: Holma stands on the dialogue box → expose its height to CSS (--intro-dlg-h)
  const sceneRef = useRef<HTMLElement>(null);
  const hasDlg = kind === 'narration' || kind === 'jane' || kind === 'holma';
  useLayoutEffect(() => {
    const el = dlgRef.current;
    const scene = sceneRef.current;
    if (!el || !scene || !hasDlg) return;
    const set = () => scene.style.setProperty('--intro-dlg-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDlg]);

  // background slow push-in
  useLayoutEffect(() => {
    const el = bgRef.current;
    if (!el || motionReduced()) return;
    const t = gsap.fromTo(el, { scale: 1.02, xPercent: 0 }, { scale: 1.16, xPercent: -1.5, duration: 42, ease: 'none' });
    return () => t.kill();
  }, [bg]);

  const finish = () => {
    if (leaving) return;
    setLeaving(true);
    const c = getCaseProgress(caseId);
    if (!replay || c?.stage === 'intro' || c?.stage === 'new') setStage(caseId, 'investigation');
    goto('investigation', { caseId }, { replace: true });
  };

  const next = () => {
    if (i < steps.length - 1) setI(i + 1);
  };
  const skip = () => {
    audio.sfx('cancel');
    const catchIdx = steps.findIndex((s) => s.kind === 'catch');
    if (catchIdx >= 0 && i < catchIdx) setI(catchIdx);
    else finish();
  };

  // keyboard: Esc = skip (the DialogueBox handles Enter/Space for lines)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-root, .sheet-root')) {
        e.preventDefault();
        skip();
      } else if ((e.key === 'Enter' || e.key === ' ') && kind === 'title' && !e.repeat) {
        e.preventDefault();
        onStageClick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onStageClick = () => {
    if (kind === 'title') {
      if (!pub) return;
      setFinishKey((k) => k + 1);
      return;
    }
    if (kind === 'catch') return;
    dlgRef.current?.querySelector<HTMLElement>('.dlg')?.click();
  };

  const speaker = kind === 'jane' ? 'jane' : kind === 'holma' ? 'holma' : 'narration';
  const text = kind === 'narration' || kind === 'jane' || kind === 'holma' ? step.text : '';

  return (
    <section ref={sceneRef} class={`scene intro is-${kind} ${janeIn ? 'has-jane' : ''} ${holmaIn ? 'has-holma' : ''}`}>
      <div class="intro__bg" aria-hidden="true">
        {bg && <img ref={bgRef} src={bg} alt="" class="intro__bg-img" />}
        <div class="intro__bg-shade" />
        <div class="intro__bg-tint" />
        <div class="intro__grain" />
      </div>
      <div class="intro__letterbox" aria-hidden="true" />

      <div class="intro__stage" onClick={onStageClick}>
        {kind === 'title' && pub && <TitleCard key={pub.id} pub={pub} finishKey={finishKey} onDone={next} />}
        {kind === 'title' && !pub && (
          <div class="itc itc--loading">
            {status === 'error' ? (
              <div class="intro__error">
                <Icon name="alert" size={26} />
                <p>事件ファイルを開けませんでした。</p>
                <div class="row" style={{ justifyContent: 'center' }}>
                  <Button icon="refresh" onClick={retry}>
                    再読み込み
                  </Button>
                  <Button variant="ghost" icon="back" sfx="cancel" onClick={() => goto('files')}>
                    事件ファイルへ
                  </Button>
                </div>
              </div>
            ) : (
              <p class="intro__loading t-mono">
                OPENING CASE FILE<span class="intro__dots">…</span>
              </p>
            )}
          </div>
        )}

        <div ref={janeRef} class={`intro__jane ${kind === 'jane' ? 'is-speaking' : ''}`} aria-hidden={!janeIn}>
          <ShardPortrait image={pub?.portrait} silhouette={pub?.silhouette} seed={caseId} revealed={0} glow={kind === 'jane'} label={pub?.codename ?? 'ジェーン・ドゥ'} />
        </div>
        <div class={`intro__holma ${kind === 'holma' ? 'is-speaking' : ''}`} aria-hidden="true">
          <HolmaSprite mood={holmaStep?.mood ?? 'normal'} talking={kind === 'holma'} framing={narrow ? 'hip' : 'hip'} rim={kind === 'holma' ? 'rgba(198,255,61,0.3)' : undefined} />
        </div>
      </div>

      {(kind === 'narration' || kind === 'jane' || kind === 'holma') && (
        <div class={`intro__dlg intro__dlg--${speaker}`} ref={dlgRef}>
          <DialogueBox
            speaker={speaker}
            text={text}
            lineKey={i}
            name={kind === 'jane' ? pub?.codename : undefined}
            onAdvance={next}
            auto={auto}
            glitch={kind === 'jane'}
            size="lg"
          />
        </div>
      )}

      {kind === 'catch' && <CatchCutIn onDone={finish} />}

      <header class="intro__top">
        <span class="intro__file t-mono">
          <span class="intro__rec" aria-hidden="true" />
          CASE FILE {caseNo(pub?.number)}
          {replay && <span class="intro__replay">REPLAY</span>}
        </span>
        <div class="spacer" />
        {kind !== 'title' && kind !== 'catch' && (
          <IconButton icon="auto" label={auto ? 'オート（オン）' : 'オート'} pressed={auto} onClick={() => setAuto(!auto)} />
        )}
        {kind !== 'catch' && (
          <Button variant="ghost" size="sm" icon="skip" sfx={false} onClick={skip} class="intro__skip">
            スキップ
          </Button>
        )}
      </header>
      <p class="intro__progress" aria-hidden="true">
        <span style={{ width: `${(i / Math.max(1, steps.length - 1)) * 100}%` }} />
      </p>
    </section>
  );
}
