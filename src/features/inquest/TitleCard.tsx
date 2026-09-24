/**
 * In-scene title card (round titles, 「記憶修復」). A heavy diagonal slab with a kicker,
 * a huge title and a sub line; slams in, holds, and wipes out. Text is DOM; aria-live.
 * A click / tap / Enter / Space / Esc jumps straight to the end (never the press that
 * brought it up: the first 300 ms are protected).
 */
import { gsap } from 'gsap';
import { Fragment } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { motionReduced } from '../../fx/motion';

export interface TitleCardSpec {
  kicker: string;
  title: string;
  sub?: string;
  tone?: 'alarm' | 'formalin' | 'cyan' | 'bone';
  /** Seconds to hold. */
  hold?: number;
  /** Small counter badge (e.g. "1/2"). */
  badge?: string;
}

/**
 * Split a title into phrases that must not break inside: at full-width spaces and dashes
 * (「記憶のノイズ ①　背後の足音」 → 「記憶のノイズ ①」「背後の足音」), so a narrow screen never
 * strands a lone ① or a final character on its own line.
 */
export function phrases(text: string): string[] {
  return text
    .split(/\u3000+|(?<=\s[—―–])\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Phrases as unbreakable-unless-too-long boxes, joined by a space that may break (and vanishes at a break). */
function Phrased({ text }: { text: string }) {
  const parts = phrases(text);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span class="tcard__ph">{p}</span>
        </Fragment>
      ))}
    </>
  );
}

export function TitleCard({ spec, onDone }: { spec: TitleCardSpec; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const slab = el.querySelector('.tcard__slab');
    const under = el.querySelector('.tcard__under');
    const kick = el.querySelector('.tcard__kicker');
    const title = el.querySelector('.tcard__title');
    const sub = el.querySelector('.tcard__sub');
    const badge = el.querySelector('.tcard__badge');
    const hold = spec.hold ?? 1.3;
    const tl = gsap.timeline({ onComplete: onDone });
    const t0 = performance.now();
    const skip = () => {
      if (performance.now() - t0 < 300 || tl.progress() >= 1) return false;
      if (document.querySelector('.modal-root, .sheet-root')) return false;
      tl.progress(1);
      return true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape')) return;
      if (skip()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (e.button > 0 || (e.target as Element | null)?.closest?.('.iq__top')) return;
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      tl.kill();
    };
    if (motionReduced()) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25 }).to(el, { opacity: 0, duration: 0.3 }, `+=${hold + 0.2}`);
      return cleanup;
    }
    tl.fromTo(under, { scaleX: 0 }, { scaleX: 1, duration: 0.22, ease: 'power3.out' }, 0)
      .fromTo(slab, { xPercent: -110, skewX: -24 }, { xPercent: 0, skewX: 0, duration: 0.42, ease: 'expo.out' }, 0.05)
      .fromTo(kick, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.35, ease: 'power3.out' }, 0.2)
      .fromTo(title, { opacity: 0, scale: 1.35, filter: 'blur(6px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.38, ease: 'back.out(2)' }, 0.24);
    // sub / badge are optional: only tween what exists (GSAP warns on null targets)
    if (sub) tl.fromTo(sub, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3 }, 0.42);
    if (badge) tl.fromTo(badge, { opacity: 0, rotation: -30, scale: 2 }, { opacity: 1, rotation: -8, scale: 1, duration: 0.3, ease: 'back.out(3)' }, 0.34);
    tl.to(title, { x: 18, duration: hold, ease: 'none' }, 0.64)
      .to(slab, { xPercent: 110, skewX: 18, duration: 0.3, ease: 'power3.in' }, '>')
      .to([under], { scaleX: 0, transformOrigin: '100% 50%', duration: 0.24, ease: 'power3.in' }, '<0.06');
    return cleanup;
  }, []);
  return (
    <div ref={ref} class={`tcard tcard--${spec.tone ?? 'alarm'}`} role="status" aria-live="polite">
      <div class="tcard__under" aria-hidden="true" />
      <div class="tcard__slab">
        <div class="tcard__stripes" aria-hidden="true" />
        <div class="tcard__copy">
          <span class="tcard__kicker">{spec.kicker}</span>
          <span class="tcard__title">
            <Phrased text={spec.title} />
          </span>
          {spec.sub && (
            <span class="tcard__sub">
              <Phrased text={spec.sub} />
            </span>
          )}
        </div>
        {spec.badge && <span class="tcard__badge">{spec.badge}</span>}
      </div>
    </div>
  );
}
