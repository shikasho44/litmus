/**
 * PROTOTYPE I-005 — 近い・遠い after a verdict (wrong and right), with `?proto=i005`.
 * A strip of red-cabbage indicator colours and a marker: far = red, closer = purple,
 * accepted = blue, perfect = green. Only the level and the share the server sent — it never
 * names what is missing. Reduced motion: the marker is placed without sliding.
 */
import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { VerdictCloseness } from '../../../shared/api';
import { motionReduced } from '../../fx/motion';
import { BAND_STOPS, CLOSENESS_LABEL, CLOSENESS_LEVELS, TICK_AT, bandColor, bandPosition } from './closeness';
import './i005.css';

const GRADIENT = `linear-gradient(90deg, ${BAND_STOPS.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`;

export function ClosenessBand({ closeness, animate = false }: { closeness: VerdictCloseness; animate?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  const pos = bandPosition(closeness);
  const color = bandColor(pos);
  const word = CLOSENESS_LABEL[closeness.level];

  useLayoutEffect(() => {
    const el = marker.current;
    if (!el || !animate || motionReduced()) return;
    const tw = gsap.fromTo(el, { left: '0%' }, { left: `${pos * 100}%`, duration: 1.1, ease: 'power3.out', delay: 0.35 });
    return () => tw.kill();
  }, [closeness.level, closeness.ratio, animate]);

  return (
    <div
      class={`cband cband--${closeness.level}`}
      data-closeness={closeness.level}
      style={{ '--cband-color': color }}
      role="img"
      aria-label={`宣告の近さ：${word}`}
      title="赤キャベツの汁の色。遠いほど赤く、近づくほど紫から青へ。完璧な正解は緑。"
    >
      <span class="cband__k" aria-hidden="true">
        近さ
      </span>
      <span class="cband__scale" aria-hidden="true">
        <span class="cband__track">
          <span class="cband__bar" style={{ backgroundImage: GRADIENT }} />
          <span ref={marker} class="cband__marker" style={{ left: `${pos * 100}%` }}>
            <span class="cband__pin" />
          </span>
        </span>
        <span class="cband__ticks">
          {CLOSENESS_LEVELS.map((l) => (
            <span key={l} class={`cband__tick cband__tick--${l} ${l === closeness.level ? 'is-on' : ''}`} style={{ left: `${TICK_AT[l] * 100}%` }}>
              {CLOSENESS_LABEL[l]}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
