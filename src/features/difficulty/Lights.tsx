/**
 * Jane's lights (やり直しの灯) — the verdict retries of the chosen difficulty, drawn as small
 * cyan flames (her colour). `LightsRow` is static (chooser cards); `LivesMeter` animates a
 * light going out when a verdict misses.
 */
import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../../../shared/api';
import { motionReduced } from '../../fx/motion';
import { DIFFICULTY_META } from './meta';
import './difficulty.css';

let lightSeq = 0;

/** One of Jane's lights: a small candle with a cyan flame (white core) — a cold wick once out. */
export function Light({ on = true }: { on?: boolean }) {
  const [id] = useState(() => `jl${++lightSeq}`);
  return (
    <svg class={`light ${on ? 'is-on' : 'is-out'}`} viewBox="0 0 12 20" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#E6FDFF" stop-opacity="0.45" />
          <stop offset="0.5" stop-color="#3DE0FF" />
          <stop offset="1" stop-color="#0B7C99" />
        </linearGradient>
      </defs>
      {on ? (
        <g class="light__flame">
          <path
            class="light__outer"
            fill={`url(#${id})`}
            d="M6.5.4C5.4 2.5 8.9 4.2 9.1 7.3c.2 2.4-1.2 4.1-3.1 4.1S2.8 10 2.9 7.9c.1-1.6 1.1-2.4 1.5-3.6.3 1 .8 1.6 1.4 1.8-.5-1.7-.4-3.9.7-5.7z"
          />
          <path class="light__core" d="M6 6.6c.3 1.2 1.4 1.8 1.4 3 0 .9-.6 1.5-1.4 1.5s-1.4-.6-1.4-1.5c0-1 1-1.6 1.4-3z" />
        </g>
      ) : (
        <path class="light__smoke" d="M6 11c-1-1.4.8-2.4 0-3.8S6.6 4.8 7 4" />
      )}
      <path class="light__wick" d="M6 11.4v1" />
      <rect class="light__candle" x="4.1" y="12.2" width="3.8" height="7.4" rx="0.7" />
    </svg>
  );
}

/** A static row of lights (used on the chooser). */
export function LightsRow({ count, label }: { count: number; label?: string }) {
  return (
    <span class="lights" role="img" aria-label={label ?? `やり直し ${count}回`}>
      {Array.from({ length: count }, (_, i) => (
        <Light key={i} />
      ))}
    </span>
  );
}

/**
 * The inquest header meter. Wide: one flame per life. Compact (phones): one flame and the count.
 * A lost light gutters and goes dark (a fade with reduced motion).
 */
export function LivesMeter({ value, max, compact, difficulty }: { value: number; max: number; compact?: boolean; difficulty?: Difficulty }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value < prev.current) {
      const lights = el.querySelectorAll<SVGElement>('.light');
      const lost = compact ? lights[0] : lights[value];
      if (lost) {
        if (motionReduced()) gsap.fromTo(lost, { opacity: 1 }, { opacity: 0.45, duration: 0.4 });
        else
          gsap
            .timeline()
            .fromTo(lost, { scale: 1.8, y: 0 }, { scale: 1.25, duration: 0.18, ease: 'power2.out' })
            .to(lost, { scaleY: 0.35, scaleX: 0.7, y: 3, duration: 0.42, ease: 'power3.in' })
            .to(lost, { scale: 1, y: 0, duration: 0.3, ease: 'back.out(2)' });
      }
    }
    prev.current = value;
  }, [value]);
  const low = value <= 1;
  const d = difficulty ? DIFFICULTY_META[difficulty] : null;
  return (
    <div
      ref={ref}
      class={`lives ${compact ? 'lives--compact' : ''} ${low ? 'is-low' : ''} ${value <= 0 ? 'is-out' : ''}`}
      role="meter"
      aria-label="やり直しの灯"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`やり直し 残り${value}回（${max}回中）${d ? `・難易度 ${d.jp}` : ''}`}
      data-lives={value}
    >
      {!compact && (
        <span class="lives__label" aria-hidden="true">
          <span class="lives__jp">灯</span>
          <span class="lives__en">LIGHTS</span>
        </span>
      )}
      {compact ? (
        <span class="lives__compact" aria-hidden="true">
          <Light on={value > 0} />
          <b class="t-mono">×{value}</b>
        </span>
      ) : (
        <span class="lives__row" aria-hidden="true">
          {Array.from({ length: max }, (_, i) => (
            <Light key={i} on={i < value} />
          ))}
        </span>
      )}
    </div>
  );
}
