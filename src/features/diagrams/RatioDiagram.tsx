import { useMemo } from 'preact/hooks';
import { DiagramFrame } from './DiagramFrame';
import { useInView, useWidth } from './hooks';
import { cloudPoints, niceStep, parseQuantity, ratioMode, type RatioData } from './model';

let uid = 0;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('-', '−');

/**
 * 'ratio' — "1 → N". When both values are positive and N/1 ≥ 5 the diagram is literal: one
 * drop, then N dots of the same size bursting out into a cloud (1 dot = the drop's volume).
 * Two values of the same unit that are not an expansion (e.g. −15℃ → −27℃) become a
 * number line with the shift highlighted. Anything else falls back to two big figures.
 */
export function RatioDiagram({ d, index }: { d: RatioData; index?: number }) {
  const mode = useMemo(() => ratioMode(d), [d]);
  const [viewRef, seen] = useInView<HTMLElement>(0.3);
  const [plotRef, w] = useWidth<HTMLDivElement>();
  const to = parseQuantity(d.to.value);
  const en = mode.kind === 'expand' ? 'EXPANSION' : mode.kind === 'shift' ? 'SHIFT' : 'COMPARISON';

  return (
    <DiagramFrame frameRef={viewRef} kind="ratio" title={d.title} en={en} source={d.source} index={index} seen={seen}>
      {mode.kind !== 'plain' && (
        <div class={`rt__plot rt__plot--${mode.kind}`} ref={plotRef}>
          {w > 0 && mode.kind === 'expand' && <Expand w={w} dots={mode.dots} factorLabel={`×${to?.prefix ?? ''}${fmt(mode.factor)}`} />}
          {w > 0 && mode.kind === 'shift' && <Shift w={w} a={mode.a} b={mode.b} unit={mode.unit} />}
        </div>
      )}
      <div class={`rt__eq rt__eq--${mode.kind}`}>
        <div class="rt__side rt__side--from">
          <span class="rt__value">{d.from.value}</span>
          <span class="rt__label">{d.from.label}</span>
        </div>
        <span class="rt__arrow" aria-hidden="true">
          <svg viewBox="0 0 48 24" width="48" height="24">
            <path d="M2 12H40M32 4l8 8-8 8" />
          </svg>
        </span>
        <span class="sr-only">から</span>
        <div class="rt__side rt__side--to">
          <span class="rt__value">{d.to.value}</span>
          <span class="rt__label">{d.to.label}</span>
        </div>
      </div>
      {mode.kind === 'expand' && (
        <p class="dg__aside">
          <span class="rt__legend-dot" aria-hidden="true" />
          点1つ ＝ {mode.perDot > 1 ? `はじめの体積の${mode.perDot}倍` : 'はじめの液体と同じ体積'}。点の数は{mode.perDot > 1 ? 'およそ' : ''}{mode.dots}個。
        </p>
      )}
      <p class="dg__detail">{d.detail}</p>
    </DiagramFrame>
  );
}

function Expand({ w, dots, factorLabel }: { w: number; dots: number; factorLabel: string }) {
  const vertical = w < 520;
  const H = vertical ? Math.round(Math.min(380, w * 1.12)) : Math.round(Math.min(330, Math.max(250, w * 0.4)));
  const drop = vertical ? { x: w / 2, y: 42 } : { x: Math.max(60, w * 0.14), y: H * 0.54 };
  const center = vertical ? { x: w / 2, y: H * 0.62 } : { x: w * 0.64, y: H * 0.52 };
  const rx = vertical ? w * 0.45 : Math.min(w * 0.3, 250);
  const aspect = vertical ? 0.64 : 0.66;
  const ry = rx * aspect;
  const spacing = Math.sqrt((Math.PI * rx * ry) / Math.max(1, dots));
  const dotR = Math.max(1.2, Math.min(3.2, spacing * 0.3));
  const pts = useMemo(() => cloudPoints(dots, aspect), [dots, aspect]);
  const gid = useMemo(() => `rt-cloud-${++uid}`, []);
  const arrowFrom = vertical ? { x: w / 2, y: drop.y + 22 } : { x: drop.x + 26, y: drop.y };
  const arrowTo = vertical ? { x: w / 2, y: center.y - ry - 14 } : { x: center.x - rx - 18, y: drop.y };
  const mid = { x: (arrowFrom.x + arrowTo.x) / 2, y: (arrowFrom.y + arrowTo.y) / 2 };
  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`しずく1つが、同じ大きさの点${dots}個の雲に広がる図`}>
      <defs>
        <radialGradient id={gid} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#3DE0FF" stop-opacity="0.16" />
          <stop offset="1" stop-color="#3DE0FF" stop-opacity="0" />
        </radialGradient>
      </defs>
      <ellipse class="rt__haze" cx={center.x} cy={center.y} rx={rx * 1.18} ry={ry * 1.25} fill={`url(#${gid})`} />
      <g class="rt__dots">
        {pts.map((p, i) => {
          const x = center.x + p.x * rx;
          const y = center.y + p.y * rx;
          return (
            <circle
              key={i}
              cx={x.toFixed(1)}
              cy={y.toFixed(1)}
              r={dotR}
              style={{ '--dx': `${(drop.x - x).toFixed(1)}px`, '--dy': `${(drop.y - y).toFixed(1)}px`, '--d': `${(p.r * 0.9 + (i % 7) * 0.02).toFixed(2)}s` }}
            />
          );
        })}
      </g>
      <g class="rt__arrow-svg">
        <path d={`M${arrowFrom.x} ${arrowFrom.y} L${arrowTo.x} ${arrowTo.y}`} />
        {vertical ? (
          <path d={`M${arrowTo.x - 7} ${arrowTo.y - 8} L${arrowTo.x} ${arrowTo.y} L${arrowTo.x + 7} ${arrowTo.y - 8}`} />
        ) : (
          <path d={`M${arrowTo.x - 8} ${arrowTo.y - 7} L${arrowTo.x} ${arrowTo.y} L${arrowTo.x - 8} ${arrowTo.y + 7}`} />
        )}
        <text x={vertical ? mid.x + 14 : mid.x} y={vertical ? mid.y + 6 : mid.y - 12} text-anchor={vertical ? 'start' : 'middle'}>
          {factorLabel}
        </text>
      </g>
      <g class="rt__drop">
        <circle cx={drop.x} cy={drop.y} r={16} class="rt__drop-ring" />
        <circle cx={drop.x} cy={drop.y} r={dotR * 1.25} class="rt__drop-core" />
        <text x={drop.x} y={drop.y - 24} text-anchor="middle">
          1
        </text>
      </g>
    </svg>
  );
}

function Shift({ w, a, b, unit }: { w: number; a: number; b: number; unit: string }) {
  const small = w < 520;
  const H = small ? 150 : 170;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const gap = hi - lo || 1;
  const min = lo - gap * 0.45;
  const max = hi + gap * 0.45;
  const m = small ? 22 : 36;
  const X = (v: number) => m + ((v - min) / (max - min)) * (w - 2 * m);
  const axisY = H * 0.66;
  const step = niceStep(max - min, small ? 5 : 8);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
  const xa = X(a);
  const xb = X(b);
  const dir = xb < xa ? -1 : 1;
  const diff = Math.abs(b - a);
  const gid = useMemo(() => `rt-axis-${++uid}`, []);
  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`${fmt(a)}${unit}から${fmt(b)}${unit}へ、${fmt(diff)}${unit}の差を示す数直線`}>
      <defs>
        <linearGradient id={gid} x1={dir < 0 ? '1' : '0'} x2={dir < 0 ? '0' : '1'} y1="0" y2="0">
          <stop offset="0" stop-color="#F2EFE6" stop-opacity="0.5" />
          <stop offset="1" stop-color="#3DE0FF" />
        </linearGradient>
      </defs>
      <rect x={m} y={axisY - 3} width={w - 2 * m} height={6} rx={3} fill={`url(#${gid})`} opacity="0.55" />
      {ticks.map((t) => (
        <g key={t} class="rt__tick">
          <line x1={X(t)} x2={X(t)} y1={axisY + 6} y2={axisY + 12} />
          <text x={X(t)} y={axisY + 26} text-anchor="middle">
            {fmt(t)}
          </text>
        </g>
      ))}
      <rect class="rt__span" x={Math.min(xa, xb)} y={axisY - 7} width={Math.abs(xb - xa)} height={14} rx={3} />
      <g class="rt__mk rt__mk--from">
        <line x1={xa} x2={xa} y1={axisY - 16} y2={axisY + 8} />
        <circle cx={xa} cy={axisY} r={6} />
      </g>
      <g class="rt__mk rt__mk--to" style={{ '--sx': `${(xa - xb).toFixed(1)}px` }}>
        <line x1={xb} x2={xb} y1={axisY - 16} y2={axisY + 8} />
        <circle cx={xb} cy={axisY} r={7} />
      </g>
      <g class="rt__shift">
        <path d={`M${xa} ${axisY - 30} L${xb + dir * -2} ${axisY - 30}`} />
        <path d={`M${xb - dir * 9} ${axisY - 37} L${xb} ${axisY - 30} L${xb - dir * 9} ${axisY - 23}`} />
        <text x={(xa + xb) / 2} y={axisY - 42} text-anchor="middle">
          {`${fmt(diff)}${unit} の差`}
        </text>
      </g>
    </svg>
  );
}
