import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { NO_FX } from '../lib/env';
import { CutIn } from '../ui/CutIn';
import { SpeedLines } from '../ui/GlitchText';
import { Stamp } from '../ui/Stamp';
import { Backdrop } from './backdrop';
import { bloomQueue, cutInQueue, fx, fxAnnounce, fxRefs, penaltyAnnounce, penaltyQueue, reactionTagQueue, speedLinesOn, stampQueue, type BloomRequest, type PenaltyRequest, type ReactionTagRequest, type StampRequest } from './index';
import { motionReduced, reduceMotion } from './motion';
import { ShatterCanvas } from './shatter';
import './fx.css';

/** The living WebGL/Canvas backdrop. Mount once, behind everything. */
export function BackdropCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || NO_FX) return;
    const b = new Backdrop(ref.current);
    fxRefs.backdrop = b;
    b.setAnimated(!motionReduced());
    const unsub = reduceMotion.subscribe((rm) => b.setAnimated(!rm));
    return () => {
      unsub();
      b.destroy();
      fxRefs.backdrop = null;
    };
  }, []);
  return <canvas ref={ref} class="backdrop" aria-hidden="true" />;
}

function StampFx({ req }: { req: StampRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tl = gsap.timeline({ onComplete: () => fx._stampDone(req.id) });
    tl.to(el, { opacity: 0, scale: 1.04, duration: 0.28, ease: 'power2.in' }, 0.25 + req.hold);
    return () => tl.kill();
  }, []);
  return (
    <div ref={ref} class="fx-stamp" style={{ left: `${req.x}px`, top: `${req.y}px` }}>
      <Stamp answerClass={req.answerClass} size={req.size} animate decorative />
    </div>
  );
}

/**
 * 「減点 −n」 — pops in beside its anchor, holds, drifts off (≈ 1 s; a fade with reduced motion).
 * Its box follows the anchor every frame (left/top); GSAP only nudges it by a few px (transform).
 */
function PenaltyFx({ req }: { req: PenaltyRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let raf = 0;
    const follow = () => {
      const p = fx._penaltyPos(req, w, h);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      raf = requestAnimationFrame(follow);
    };
    follow();
    const tl = gsap.timeline({ onComplete: () => fx._penaltyDone(req.id) });
    if (motionReduced()) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.12 }).to(el, { opacity: 0, duration: 0.3 }, 0.95);
    } else {
      tl.fromTo(el, { y: 8, scale: 0.7, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.2, ease: 'back.out(2.4)' })
        .to(el, { y: -16, opacity: 0, duration: 0.36, ease: 'power2.in' }, 0.78);
    }
    return () => {
      cancelAnimationFrame(raf);
      tl.kill();
    };
  }, []);
  return (
    <div ref={ref} class="fx-pen" data-place={req.place}>
      <span class="fx-pen__k">減点</span>
      <span class="fx-pen__n">{req.text}</span>
    </div>
  );
}

/**
 * 反応あり — the litmus bloom. A red spot develops into a blue one that spreads past it, two thin
 * ripples run out like a drop on paper, and the whole thing fades (≈ 1.2 s). Reduced motion never
 * queues one (the tested word turns blue by itself).
 */
function BloomFx({ req }: { req: BloomRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const acid = el.querySelector('.fx-bloom__acid');
    const base = el.querySelector('.fx-bloom__base');
    const rings = el.querySelectorAll('.fx-bloom__ring');
    const tl = gsap.timeline({ onComplete: () => fx._bloomDone(req.id) });
    tl.fromTo(acid, { scale: 0.15, opacity: 0 }, { scale: 0.62, opacity: 0.95, duration: 0.16, ease: 'power2.out' }, 0)
      .fromTo(base, { scale: 0.05, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 0.62, ease: 'expo.out' }, 0.14)
      .to(acid, { scale: 0.9, opacity: 0, duration: 0.36, ease: 'power1.in' }, 0.2)
      .fromTo(rings, { scale: 0.1, opacity: 0.9 }, { scale: 1.25, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.16 }, 0.16)
      .to(base, { opacity: 0, duration: 0.5, ease: 'power1.in' }, 0.72);
    return () => tl.kill();
  }, []);
  return (
    <div ref={ref} class="fx-bloom" style={{ left: `${req.x}px`, top: `${req.y}px` }} aria-hidden="true">
      <span class="fx-bloom__acid" />
      <span class="fx-bloom__base" />
      <span class="fx-bloom__ring" />
      <span class="fx-bloom__ring" />
    </div>
  );
}

/** 「反応なし」 — pops above the tested word, holds, drifts off (≈ 1.1 s; a fade with reduced motion). */
function ReactionTagFx({ req }: { req: ReactionTagRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let raf = 0;
    const follow = () => {
      const p = fx._penaltyPos({ id: req.id, text: '', anchor: req.anchor, place: 'above' }, w, h);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      raf = requestAnimationFrame(follow);
    };
    follow();
    const tl = gsap.timeline({ onComplete: () => fx._reactionTagDone(req.id) });
    if (motionReduced()) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.12 }).to(el, { opacity: 0, duration: 0.3 }, 1.05);
    } else {
      tl.fromTo(el, { y: 6, scale: 0.8, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2)' })
        .to(el, { y: -12, opacity: 0, duration: 0.36, ease: 'power2.in' }, 0.95);
    }
    return () => {
      cancelAnimationFrame(raf);
      tl.kill();
    };
  }, []);
  return (
    <div ref={ref} class="fx-noreact">
      <span class="fx-noreact__swatch" aria-hidden="true" />
      <span class="fx-noreact__jp">反応なし</span>
      <span class="fx-noreact__en">NO REACTION</span>
    </div>
  );
}

/** Overlay for flashes, stamps, cut-ins, speed lines, penalty tags and the shatter canvas. Mount once. */
export function FxLayer() {
  const flash = useRef<HTMLDivElement>(null);
  const pulse = useRef<HTMLDivElement>(null);
  const shatter = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fxRefs.flash = flash.current;
    fxRefs.pulse = pulse.current;
    if (shatter.current) fxRefs.shatter = new ShatterCanvas(shatter.current);
    return () => {
      fxRefs.flash = null;
      fxRefs.pulse = null;
      fxRefs.shatter = null;
    };
  }, []);

  const cut = cutInQueue.value;
  const sl = speedLinesOn.value;
  return (
    <div class="fx-layer" aria-hidden="false">
      <div ref={pulse} class="fx-pulse" aria-hidden="true" />
      {sl && <SpeedLines kind={sl.kind} color={sl.color} />}
      <canvas ref={shatter} class="fx-shatter" aria-hidden="true" />
      <div class="fx-blooms" aria-hidden="true">
        {bloomQueue.value.map((b) => (
          <BloomFx key={b.id} req={b} />
        ))}
      </div>
      <div class="fx-stamps" aria-hidden="true">
        {stampQueue.value.map((s) => (
          <StampFx key={s.id} req={s} />
        ))}
      </div>
      {cut && (
        <div class="fx-cutin" aria-hidden="true">
          <CutIn key={cut.id} text={cut.text} lead={cut.lead} en={cut.en} tone={cut.tone} character={cut.character} mood={cut.mood} hold={cut.hold} onDone={() => fx._cutInDone()} />
        </div>
      )}
      <div class="fx-pens" aria-hidden="true">
        {penaltyQueue.value.map((p) => (
          <PenaltyFx key={p.id} req={p} />
        ))}
        {reactionTagQueue.value.map((r) => (
          <ReactionTagFx key={r.id} req={r} />
        ))}
      </div>
      <div ref={flash} class="fx-flash" aria-hidden="true" />
      <p class="sr-only" aria-live="assertive">
        {fxAnnounce.value}
      </p>
      <p class="sr-only" aria-live="polite">
        {penaltyAnnounce.value}
      </p>
    </div>
  );
}
