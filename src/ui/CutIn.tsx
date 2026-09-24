import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { HolmaMood } from '../../shared/api';
import { motionReduced } from '../fx/motion';
import { HolmaSprite } from './HolmaSprite';
import { RubyText, stripRuby } from './ruby';
import { ShardPortrait } from './ShardPortrait';
import './cutin.css';

export type CutInTone = 'formalin' | 'alarm' | 'cyan' | 'amber' | 'violet' | 'bone';

export interface CutInProps {
  /** Main line. Furigana notation 「解剖（しらべ）」 renders as ruby. */
  text: string;
  /** Small lead-in above the main line (e.g. 「さァ——」). */
  lead?: string;
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
 * Shrink (and if needed, wrap to two lines) the cut-in copy so it never runs off-screen or
 * under the character art. Layout sizes only (offset*), so the band's rotation is ignored.
 */
function fitCopy(el: HTMLElement) {
  const band = el.querySelector<HTMLElement>('.cutin__band');
  const copy = el.querySelector<HTMLElement>('.cutin__copy');
  const txt = el.querySelector<HTMLElement>('.cutin__text');
  if (!band || !copy || !txt) return;
  const W = el.clientWidth;
  if (!W) return;
  // keep the copy clear of the character art (the sprite's box has ~15% transparent margin)
  const chr = el.querySelector<HTMLElement>('.cutin__char');
  if (chr) {
    const clear = chr.offsetLeft + chr.offsetWidth * 0.84;
    if (parseFloat(getComputedStyle(copy).paddingLeft) < clear) copy.style.paddingLeft = `${Math.round(clear)}px`;
  }
  const cs = getComputedStyle(copy);
  const left = band.offsetLeft + parseFloat(cs.paddingLeft);
  const right = band.offsetLeft + band.offsetWidth - parseFloat(cs.paddingRight);
  const hasChar = copy.classList.contains('has-char');
  // what is actually on screen (the band overhangs the viewport on both sides)
  const visLeft = hasChar ? left : Math.max(left, W * 0.04);
  const visRight = Math.min(right, W * 0.96);
  const avail = Math.max(80, visRight - visLeft);
  const maxH = band.offsetHeight * 0.74;
  const base = parseFloat(getComputedStyle(txt).fontSize);
  let size = base;
  const fits = () => txt.scrollWidth <= avail + 1 && copy.scrollHeight <= band.offsetHeight + 1 && txt.offsetHeight <= maxH + 1;
  if (fits()) return;
  // one line, scaled to width
  size = Math.floor(base * Math.min(1, avail / txt.scrollWidth) * 0.97);
  txt.style.fontSize = `${size}px`;
  // noticeably smaller on one line → let a long line wrap at phrase boundaries into two bigger lines
  if (size < base * 0.8 && stripRuby(txt.textContent ?? '').length >= 7) {
    txt.classList.add('is-wrap');
    txt.style.maxWidth = `${avail}px`;
    size = Math.floor(Math.min(base, size * 1.7));
    txt.style.fontSize = `${size}px`;
  }
  for (let i = 0; i < 12 && !fits(); i++) {
    size = Math.floor(size * 0.92);
    txt.style.fontSize = `${size}px`;
  }
  // the EN kicker follows the same rule (it is one line of wide-tracked Anton)
  const en = el.querySelector<HTMLElement>('.cutin__en');
  if (en && en.scrollWidth > avail + 1) {
    en.style.letterSpacing = '0.22em';
    const f = parseFloat(getComputedStyle(en).fontSize);
    if (en.scrollWidth > avail + 1) en.style.fontSize = `${Math.max(11, Math.floor((f * avail) / en.scrollWidth))}px`;
  }
}

/**
 * Full-width diagonal band with huge Dela Gothic text, optional character and speed lines.
 * Usually shown via fx.cutIn(); can be embedded directly (it plays once on mount).
 */
export function CutIn({ text, lead, en, tone = 'formalin', character = null, mood = 'laugh', hold = 0.75, tilt = -8, onDone }: CutInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const len = [...stripRuby(text)].length;
  // a first guess by length; fitCopy() then shrinks / wraps to what the screen really allows
  const scale = len <= 4 ? 1 : len <= 6 ? 0.82 : len <= 9 ? 0.7 : 0.6;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitCopy(el);
    const band = el.querySelector('.cutin__band');
    const back = el.querySelector('.cutin__back');
    const txt = el.querySelectorAll('.cutin__text, .cutin__lead');
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
      .to([...txt, sub, chr].filter(Boolean), { xPercent: '-=70', opacity: 0, duration: 0.24, ease: 'power3.in' }, '>')
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
          {lead && <div class="cutin__lead">{lead}</div>}
          <div class="cutin__text">
            <RubyText text={text} />
          </div>
          {en && <div class="cutin__en">{en}</div>}
        </div>
      </div>
    </div>
  );
}
