import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { HolmaMood } from '../../shared/api';
import { motionReduced } from '../fx/motion';
import { HolmaSprite } from './HolmaSprite';
import { ShardPortrait } from './ShardPortrait';
import './cutin.css';

export type CutInTone = 'formalin' | 'alarm' | 'cyan' | 'amber' | 'violet' | 'bone';

export interface CutInProps {
  text: string;
  en?: string;
  tone?: CutInTone;
  character?: 'holma' | 'jane' | null;
  mood?: HolmaMood;
  /** Hold time in seconds between in and out (default 0.75). */
  hold?: number;
  /** Tilt of the band in degrees (default -8). */
  tilt?: number;
  onDone?: () => void;
}

/**
 * Full-width diagonal band with huge Dela Gothic text, optional character and speed lines.
 * Usually shown via fx.cutIn(); can be embedded directly (it plays once on mount).
 */
export function CutIn({ text, en, tone = 'formalin', character = null, mood = 'laugh', hold = 0.75, tilt = -8, onDone }: CutInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const len = [...text].length;
  const scale = len <= 4 ? 1 : len <= 6 ? 0.82 : len <= 9 ? 0.64 : 0.5;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const band = el.querySelector('.cutin__band');
    const back = el.querySelector('.cutin__back');
    const txt = el.querySelector('.cutin__text');
    const sub = el.querySelector('.cutin__en');
    const chr = el.querySelector('.cutin__char');
    const tl = gsap.timeline({ onComplete: () => onDone?.() });
    if (motionReduced()) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 })
        .to(el, { opacity: 0, duration: 0.25 }, `+=${hold + 0.3}`);
      return () => tl.kill();
    }
    // sub (no `en`) and chr (no character) may be absent: only tween what exists (GSAP warns on null targets)
    tl.fromTo(back, { scaleY: 0 }, { scaleY: 1, duration: 0.16, ease: 'power3.out' }, 0)
      .fromTo(band, { scaleY: 0 }, { scaleY: 1, duration: 0.18, ease: 'power3.out' }, 0.04)
      .fromTo(txt, { xPercent: 60, opacity: 0, skewX: -18 }, { xPercent: 0, opacity: 1, skewX: 0, duration: 0.36, ease: 'expo.out' }, 0.1);
    if (sub) tl.fromTo(sub, { xPercent: -40, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.4, ease: 'expo.out' }, 0.16);
    if (chr) tl.fromTo(chr, { xPercent: -70, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.4, ease: 'expo.out' }, 0.08);
    tl.to(txt, { xPercent: -4, duration: hold, ease: 'none' }, 0.48)
      .to([txt, sub, chr].filter(Boolean), { xPercent: '-=70', opacity: 0, duration: 0.24, ease: 'power3.in' }, '>')
      .to([band, back], { scaleY: 0, duration: 0.2, ease: 'power3.in' }, '<0.08');
    return () => tl.kill();
  }, []);

  return (
    <div ref={ref} class={`cutin cutin--${tone}`} style={{ '--cut-tilt': `${tilt}deg`, '--cut-scale': scale }} aria-hidden="true">
      <div class="cutin__back" />
      <div class="cutin__band">
        <div class="cutin__lines" />
        <div class="cutin__halftone" />
        {character && (
          <div class="cutin__char">
            {character === 'holma' ? <HolmaSprite mood={mood} framing="bust" idle={false} /> : <ShardPortrait revealed={0} seed="cutin" />}
          </div>
        )}
        <div class={`cutin__copy ${character ? 'has-char' : ''}`}>
          <div class="cutin__text">{text}</div>
          {en && <div class="cutin__en">{en}</div>}
        </div>
      </div>
    </div>
  );
}
