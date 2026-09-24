/** 集中力 — five glass pips. A lost pip cracks and falls. */
import { gsap } from 'gsap';
import { useEffect, useRef } from 'preact/hooks';
import { motionReduced } from '../../fx/motion';
import { MAX_COMPOSURE } from './session';

export function ComposureMeter({ value, compact }: { value: number; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value < prev.current && !motionReduced()) {
      const lost = el.querySelectorAll<HTMLElement>('.cmp__pip')[value];
      if (lost) {
        gsap.fromTo(lost, { scale: 1.6, rotation: 0 }, { scale: 1, rotation: 45, duration: 0.5, ease: 'elastic.out(1.2, 0.4)' });
      }
      gsap.fromTo(el, { x: -6 }, { x: 0, duration: 0.4, ease: 'elastic.out(1.4, 0.3)' });
    }
    prev.current = value;
  }, [value]);
  const low = value <= 2;
  return (
    <div
      ref={ref}
      class={`cmp ${compact ? 'cmp--compact' : ''} ${low ? 'is-low' : ''} ${value <= 1 ? 'is-critical' : ''}`}
      role="meter"
      aria-label="集中力"
      aria-valuemin={0}
      aria-valuemax={MAX_COMPOSURE}
      aria-valuenow={value}
      aria-valuetext={`集中力 ${value} / ${MAX_COMPOSURE}`}
    >
      <span class="cmp__label">
        <span class="cmp__jp">集中力</span>
        {!compact && <span class="cmp__en">COMPOSURE</span>}
      </span>
      <span class="cmp__pips" aria-hidden="true">
        {Array.from({ length: MAX_COMPOSURE }, (_, i) => (
          <i key={i} class={`cmp__pip ${i < value ? 'is-on' : 'is-lost'}`} />
        ))}
      </span>
    </div>
  );
}
