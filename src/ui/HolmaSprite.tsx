import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { HolmaMood } from '../../shared/api';
import { motionReduced } from '../fx/motion';
import { ART, holmaMeta, loadHolmaMeta, useImage, type HolmaMeta, type SpriteMeta } from '../lib/asset';
import { HolmaVector } from './HolmaVector';
import './holma.css';

const MOODS: HolmaMood[] = ['normal', 'laugh', 'surprised', 'serious'];
const DEFAULT_META: SpriteMeta = { w: 574, h: 918, face: { x: 0.5, y: 0.29 } };

/**
 * Camera framing (novel-game rule: conversation shows bust-up to hip-up, never a tiny full body).
 *  bust  head + chest          — phone conversation, cut-ins, small windows
 *  hip   head to hips          — stage conversation (PC investigation, prologue on phones)
 *  knee  3/4 figure            — wide establishing shots
 *  full  whole figure + crate  — title / gallery
 */
export type HolmaFraming = 'bust' | 'hip' | 'knee' | 'full';

export interface HolmaSpriteProps {
  mood?: HolmaMood;
  /** Bounce while text is being typed. */
  talking?: boolean;
  /** Slow head-tilt sway while waiting for an answer. */
  thinking?: boolean;
  /** Camera framing (default 'bust'). */
  framing?: HolmaFraming;
  flip?: boolean;
  /** Idle breathing (default true; off with reduced motion). */
  idle?: boolean;
  class?: string;
  /** Adds a soft rim light in the given colour (e.g. var(--alarm) during inquest). */
  rim?: string;
  /**
   * Horizontal position of the face inside the box (0..1, default 0.5). Use e.g. 0.42 to
   * leave room for the ears/probe on the right.
   */
  faceX?: number;
}

/**
 * `span`  fraction of the sprite's height that fills the box height
 * `faceY` where the (shared) face anchor lands inside the box, 0 = top
 */
const FRAMES: Record<Exclude<HolmaFraming, 'full'>, { span: number; faceY: number }> = {
  bust: { span: 0.43, faceY: 0.42 },
  hip: { span: 0.6, faceY: 0.33 },
  knee: { span: 0.86, faceY: 0.27 },
};

/**
 * One rig anchor for every mood. The four expression images share one canvas (same size,
 * same crate position), so they must all be placed with the SAME transform — otherwise the
 * body would jump when the mood changes. The anchor is the mean of the per-mood face anchors.
 */
function rigAnchor(meta: HolmaMeta | null): SpriteMeta {
  const list = MOODS.map((m) => meta?.[m]).filter((x): x is SpriteMeta => !!x && x.w > 0 && x.h > 0);
  if (!list.length) return DEFAULT_META;
  const n = list.length;
  return {
    w: list.reduce((s, m) => s + m.w, 0) / n,
    h: list.reduce((s, m) => s + m.h, 0) / n,
    face: { x: list.reduce((s, m) => s + m.face.x, 0) / n, y: list.reduce((s, m) => s + m.face.y, 0) / n },
  };
}

/**
 * Holma, the rabbit specimen. Uses public/art/holma/<mood>.webp + meta.json face anchors to
 * frame the sprite; falls back to a vector illustration when the art is missing.
 * All loaded moods are stacked with one shared transform and cross-faded, so switching moods
 * never flickers or jumps.
 */
export function HolmaSprite({ mood = 'normal', talking, thinking, framing = 'bust', flip, idle = true, class: cls, rim, faceX = 0.5 }: HolmaSpriteProps) {
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
    if (mood === 'surprised') gsap.fromTo(el, { y: 0 }, { y: -18, duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1 });
    else if (mood === 'laugh') gsap.fromTo(el, { rotation: -2.5 }, { rotation: 0, duration: 0.5, ease: 'elastic.out(1.4, 0.35)' });
    else gsap.fromTo(el, { scale: 0.975 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
  }, [mood]);

  const rig = rigAnchor(holmaMeta.value);
  const { w: W, h: H } = size;
  const place = (m: HolmaMood) => {
    const meta = holmaMeta.value?.[m] ?? rig;
    if (!W || !H) return { opacity: 0 };
    const ar = meta.w / meta.h;
    let hd: number;
    let wd: number;
    let left: number;
    let top: number;
    if (framing === 'full') {
      hd = H * 0.98;
      wd = hd * ar;
      if (wd > W) {
        wd = W;
        hd = wd / ar;
      }
      left = (W - wd) / 2;
      top = H - hd;
    } else {
      const f = FRAMES[framing];
      hd = H / f.span;
      wd = hd * ar;
      left = W * faceX - rig.face.x * wd;
      top = H * f.faceY - rig.face.y * hd;
      if (top + hd < H) top = H - hd; // never leave a gap under the figure
    }
    return { width: `${wd.toFixed(1)}px`, height: `${hd.toFixed(1)}px`, left: `${left.toFixed(1)}px`, top: `${top.toFixed(1)}px` };
  };

  return (
    <div
      ref={box}
      class={`holma holma--${framing} ${talking ? 'is-talking' : ''} ${thinking ? 'is-thinking' : ''} ${idle ? 'is-idle' : ''} ${flip ? 'is-flipped' : ''} ${cls ?? ''}`}
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
              urls[m] ? <img key={m} src={urls[m]!} alt="" draggable={false} class={`holma__img ${m === shownMood ? 'is-on' : ''}`} style={place(m)} /> : null,
            )
          )}
        </div>
      </div>
    </div>
  );
}
