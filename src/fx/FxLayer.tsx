import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { NO_FX } from '../lib/env';
import { CutIn } from '../ui/CutIn';
import { SpeedLines } from '../ui/GlitchText';
import { Stamp } from '../ui/Stamp';
import { Backdrop } from './backdrop';
import { cutInQueue, fx, fxAnnounce, fxRefs, speedLinesOn, stampQueue, type StampRequest } from './index';
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

/** Overlay for flashes, stamps, cut-ins, speed lines and the shatter canvas. Mount once. */
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
      <div class="fx-stamps" aria-hidden="true">
        {stampQueue.value.map((s) => (
          <StampFx key={s.id} req={s} />
        ))}
      </div>
      {cut && (
        <div class="fx-cutin" aria-hidden="true">
          <CutIn key={cut.id} text={cut.text} en={cut.en} tone={cut.tone} character={cut.character} mood={cut.mood} hold={cut.hold} onDone={() => fx._cutInDone()} />
        </div>
      )}
      <div ref={flash} class="fx-flash" aria-hidden="true" />
      <p class="sr-only" aria-live="assertive">
        {fxAnnounce.value}
      </p>
    </div>
  );
}
