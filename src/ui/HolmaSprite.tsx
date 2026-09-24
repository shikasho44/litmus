import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { HolmaMood } from '../../shared/api';
import { motionReduced } from '../fx/motion';
import { ART, holmaMeta, loadHolmaMeta, useImage, type SpriteMeta } from '../lib/asset';
import { HolmaVector } from './HolmaVector';
import './holma.css';

const MOODS: HolmaMood[] = ['normal', 'laugh', 'surprised', 'serious'];
const DEFAULT_META: SpriteMeta = { w: 1000, h: 1600, face: { x: 0.5, y: 0.2 } };

export type HolmaFraming = 'bust' | 'knee' | 'full';

export interface HolmaSpriteProps {
  mood?: HolmaMood;
  /** Bounce while text is being typed. */
  talking?: boolean;
  /** bust = head+chest (stage default), knee = 3/4, full = whole body. */
  framing?: HolmaFraming;
  flip?: boolean;
  /** Idle breathing (default true; off with reduced motion). */
  idle?: boolean;
  class?: string;
  /** Adds a soft rim light in the given colour (e.g. var(--alarm) during inquest). */
  rim?: string;
}

/** Where the face should land inside the box, and how tall the figure is relative to the box. */
const FRAMES: Record<HolmaFraming, { scale: number; faceY: number }> = {
  bust: { scale: 1.7, faceY: 0.36 },
  knee: { scale: 1.15, faceY: 0.3 },
  full: { scale: 0.98, faceY: -1 },
};

/**
 * Holma, the rabbit specimen. Uses public/art/holma/<mood>.webp + meta.json face anchor to
 * frame the sprite; falls back to a vector illustration when the art is missing.
 * All loaded moods are stacked and cross-faded so switching never flickers.
 */
export function HolmaSprite({ mood = 'normal', talking, framing = 'bust', flip, idle = true, class: cls, rim }: HolmaSpriteProps) {
  const box = useRef<HTMLDivElement>(null);
  const fig = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const urls = {
    normal: useImage(ART.holma('normal')),
    laugh: useImage(ART.holma('laugh')),
    surprised: useImage(ART.holma('surprised')),
    serious: useImage(ART.holma('serious')),
  };
  const activeUrl = urls[mood] ?? urls.normal;
  const shownMood: HolmaMood = urls[mood] ? mood : 'normal';
  const useVector = !activeUrl;

  useEffect(() => {
    loadHolmaMeta();
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // mood switch "pop"
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = fig.current;
    if (!el || motionReduced()) return;
    gsap.killTweensOf(el);
    if (mood === 'surprised') gsap.fromTo(el, { y: 0 }, { y: -22, duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1 });
    else if (mood === 'laugh') gsap.fromTo(el, { rotation: -2.5 }, { rotation: 0, duration: 0.5, ease: 'elastic.out(1.4, 0.35)' });
    else gsap.fromTo(el, { scale: 0.97 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
  }, [mood]);

  const frame = FRAMES[framing];
  const style = (m: HolmaMood) => {
    const meta = holmaMeta.value?.[m] ?? holmaMeta.value?.normal ?? DEFAULT_META;
    const { w: W, h: H } = size;
    if (!W || !H) return { opacity: 0 };
    const ar = meta.w / meta.h;
    let hd = H * frame.scale;
    let wd = hd * ar;
    if (framing === 'full' && wd > W) {
      wd = W;
      hd = wd / ar;
    }
    let left = W * 0.5 - meta.face.x * wd;
    let top = frame.faceY < 0 ? H - hd : H * frame.faceY - meta.face.y * hd;
    if (top + hd < H) top = H - hd; // never leave a gap under the body
    return { width: `${wd}px`, height: `${hd}px`, left: `${left}px`, top: `${top}px` };
  };

  return (
    <div
      ref={box}
      class={`holma holma--${framing} ${talking ? 'is-talking' : ''} ${idle ? 'is-idle' : ''} ${flip ? 'is-flipped' : ''} ${cls ?? ''}`}
      style={rim ? { '--holma-rim': rim } : undefined}
      data-mood={mood}
      aria-hidden="true"
    >
      <div ref={fig} class="holma__fig">
        <div class="holma__breath">
          {useVector ? (
            <HolmaVector mood={mood} class="holma__vector" />
          ) : (
            MOODS.map((m) =>
              urls[m] ? <img key={m} src={urls[m]!} alt="" draggable={false} class={`holma__img ${m === shownMood ? 'is-on' : ''}`} style={style(m)} /> : null,
            )
          )}
        </div>
      </div>
    </div>
  );
}
