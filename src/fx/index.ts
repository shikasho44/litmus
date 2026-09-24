/**
 * Imperative FX API. Scenes call these; <FxLayer/> (mounted once by the App) renders them.
 *
 *   fx.shake(1)                         screen shake of the scene host (strength 0.3–2)
 *   fx.flash('#fff')                    full-screen flash (rate-limited: ≤ 3 per second)
 *   fx.shatter(x, y)                    glass burst at viewport coords (refutation)
 *   await fx.cutIn({ text: '反証！', en: 'REFUTATION', tone: 'alarm', character: 'holma' })
 *   await fx.stamp('yes')               transient judgement stamp over the stage
 *   fx.speedLines(600)                  radial speed lines
 *   fx.glitch(el)                       one-shot glitch on an element
 *   fx.pulse('alarm')                   heartbeat vignette pulse
 *   fx.setBackdrop('alarm')             retint the living backdrop
 *
 * Every effect respects reduced motion: shakes/flashes/glitches are skipped, cut-ins and
 * stamps fade instead of slamming (they still show, because they carry information).
 */
import { signal } from '@preact/signals';
import { gsap } from 'gsap';
import type { AnswerClass } from '../../shared/case-schema';
import type { HolmaMood } from '../../shared/api';
import { audio } from '../audio';
import type { CutInTone } from '../ui/CutIn';
import type { Backdrop, BackdropTone } from './backdrop';
import { motionReduced } from './motion';
import type { ShatterCanvas } from './shatter';

export interface CutInRequest {
  id: number;
  text: string;
  en?: string;
  tone?: CutInTone;
  character?: 'holma' | 'jane' | null;
  mood?: HolmaMood;
  hold?: number;
  resolve: () => void;
}
export interface StampRequest {
  id: number;
  answerClass: AnswerClass;
  x: number;
  y: number;
  hold: number;
  size: 'md' | 'lg' | 'xl';
  resolve: () => void;
}

export const cutInQueue = signal<CutInRequest | null>(null);
export const stampQueue = signal<StampRequest[]>([]);
export const speedLinesOn = signal<{ kind: 'radial' | 'horizontal'; color: string } | null>(null);
export const fxAnnounce = signal('');

/** Refs registered by FxLayer / App. */
export const fxRefs: {
  flash: HTMLDivElement | null;
  pulse: HTMLDivElement | null;
  shake: HTMLElement | null;
  shatter: ShatterCanvas | null;
  backdrop: Backdrop | null;
} = { flash: null, pulse: null, shake: null, shatter: null, backdrop: null };

let seq = 0;
const flashTimes: number[] = [];
let pendingCutIns: Omit<CutInRequest, 'id'>[] = [];

function stageCenter(): { x: number; y: number } {
  const stage = document.querySelector<HTMLElement>('[data-stage]');
  if (stage) {
    const r = stage.getBoundingClientRect();
    if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function nextCutIn() {
  if (cutInQueue.peek() || !pendingCutIns.length) return;
  const req = pendingCutIns.shift()!;
  cutInQueue.value = { ...req, id: ++seq };
}

export const fx = {
  shake(strength = 1, duration = 0.38) {
    const el = fxRefs.shake;
    if (!el || motionReduced()) return;
    const s = Math.max(0.2, Math.min(2.5, strength));
    gsap.killTweensOf(el, 'x,y,rotation');
    const tl = gsap.timeline({ onComplete: () => gsap.set(el, { clearProps: 'transform' }) });
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = 1 - i / n;
      tl.to(el, { x: (Math.random() - 0.5) * 22 * s * k, y: (Math.random() - 0.5) * 14 * s * k, rotation: (Math.random() - 0.5) * 0.9 * s * k, duration: duration / n, ease: 'none' });
    }
    tl.to(el, { x: 0, y: 0, rotation: 0, duration: 0.06 });
  },

  /** Full-screen flash. Never more than 3 per rolling second (WCAG 2.3.1). */
  flash(color = '#FFFFFF', opts: { opacity?: number; duration?: number } = {}) {
    const el = fxRefs.flash;
    if (!el || motionReduced()) return false;
    const now = performance.now();
    while (flashTimes.length && now - flashTimes[0] > 1000) flashTimes.shift();
    if (flashTimes.length >= 3 || (flashTimes.length && now - flashTimes[flashTimes.length - 1] < 340)) return false;
    flashTimes.push(now);
    gsap.killTweensOf(el);
    gsap.fromTo(el, { opacity: opts.opacity ?? 0.75, backgroundColor: color }, { opacity: 0, duration: opts.duration ?? 0.42, ease: 'power2.out' });
    return true;
  },

  shatter(x?: number, y?: number, opts: { color?: string; count?: number; sound?: boolean } = {}) {
    const c = stageCenter();
    if (opts.sound !== false) audio.sfx('shatter');
    if (motionReduced()) return;
    fxRefs.shatter?.burst(x ?? c.x, y ?? c.y, opts);
  },

  cutIn(opts: { text: string; en?: string; tone?: CutInTone; character?: 'holma' | 'jane' | null; mood?: HolmaMood; hold?: number; sound?: boolean }): Promise<void> {
    return new Promise((resolve) => {
      if (opts.sound !== false) audio.sfx('cutin');
      fxAnnounce.value = opts.text;
      pendingCutIns.push({ ...opts, resolve });
      nextCutIn();
    });
  },

  /** Internal: called by FxLayer when a cut-in finishes. */
  _cutInDone() {
    const cur = cutInQueue.peek();
    cutInQueue.value = null;
    cur?.resolve();
    setTimeout(nextCutIn, 30);
  },

  stamp(answerClass: AnswerClass, opts: { x?: number; y?: number; hold?: number; size?: 'md' | 'lg' | 'xl'; sound?: boolean; shake?: boolean } = {}): Promise<void> {
    return new Promise((resolve) => {
      const c = stageCenter();
      const req: StampRequest = {
        id: ++seq,
        answerClass,
        x: opts.x ?? c.x,
        y: opts.y ?? c.y,
        hold: opts.hold ?? 1.1,
        size: opts.size ?? 'xl',
        resolve,
      };
      stampQueue.value = [...stampQueue.peek().slice(-1), req];
      // impact is ~0.2s in
      setTimeout(() => {
        if (opts.sound !== false) audio.sfx('stamp', { answerClass });
        if (opts.shake !== false) fx.shake(answerClass === 'no' ? 1.1 : 0.7, 0.3);
      }, motionReduced() ? 0 : 190);
    });
  },

  _stampDone(id: number) {
    const list = stampQueue.peek();
    const s = list.find((x) => x.id === id);
    stampQueue.value = list.filter((x) => x.id !== id);
    s?.resolve();
  },

  speedLines(ms = 700, opts: { kind?: 'radial' | 'horizontal'; color?: string } = {}) {
    if (motionReduced()) return;
    speedLinesOn.value = { kind: opts.kind ?? 'radial', color: opts.color ?? 'rgba(242,239,230,0.5)' };
    setTimeout(() => (speedLinesOn.value = null), ms);
  },

  glitch(el: Element | null | undefined, ms = 380) {
    if (!el || motionReduced()) return;
    el.classList.remove('is-glitching');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('is-glitching');
    setTimeout(() => el.classList.remove('is-glitching'), ms);
  },

  /** Heartbeat vignette (two soft pulses). */
  pulse(tone: 'alarm' | 'cyan' | 'formalin' = 'alarm', sound = true) {
    if (sound) audio.sfx('heartbeat');
    const el = fxRefs.pulse;
    if (!el) return;
    el.dataset.tone = tone;
    if (motionReduced()) {
      gsap.fromTo(el, { opacity: 0.5 }, { opacity: 0, duration: 0.8 });
      return;
    }
    gsap.timeline()
      .fromTo(el, { opacity: 0 }, { opacity: 0.9, duration: 0.1 })
      .to(el, { opacity: 0.2, duration: 0.16 })
      .to(el, { opacity: 0.7, duration: 0.1 })
      .to(el, { opacity: 0, duration: 0.6 });
  },

  setBackdrop(tone: BackdropTone) {
    fxRefs.backdrop?.setTone(tone);
  },

  /** Clear any queued effects (scene changes). */
  reset() {
    pendingCutIns.forEach((p) => p.resolve());
    pendingCutIns = [];
    const cur = cutInQueue.peek();
    cutInQueue.value = null;
    cur?.resolve();
    stampQueue.peek().forEach((s) => s.resolve());
    stampQueue.value = [];
    speedLinesOn.value = null;
  },
};

export type Fx = typeof fx;
