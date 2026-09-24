import { useMemo } from 'preact/hooks';
import { DiagramFrame } from './DiagramFrame';
import { useInView, useWidth } from './hooks';
import { ecgModel, windowTag, type EcgData } from './model';

let uid = 0;

/**
 * 'ecg' — an ECG trace generated in code at the element's real pixel width (so the labels
 * stay legible on phones): a normal beat with its vulnerable window, a second beat hit by
 * an impact inside that window, then ventricular fibrillation.
 */
export function EcgDiagram({ d, index }: { d: EcgData; index?: number }) {
  const [viewRef, seen] = useInView<HTMLElement>(0.35);
  const [plotRef, w] = useWidth<HTMLDivElement>();
  const id = useMemo(() => `ecg${++uid}`, []);
  const h = Math.round(Math.min(270, Math.max(200, w * 0.34)));
  const m = useMemo(() => (w > 0 ? ecgModel(w, h) : null), [w, h]);
  const tag = windowTag(d.title);
  const small = w < 520;
  const grid = small ? 6 : 8;

  return (
    <DiagramFrame frameRef={viewRef} kind="ecg" title={d.title} en="ELECTROCARDIOGRAM" source={d.source} index={index} seen={seen}>
      <div class="ecg__plot" ref={plotRef} style={{ height: `${h}px` }}>
        {m && (
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`心電図の模式図。1拍目と2拍目のT波の頂上の少し手前に「${tag}」があり、2拍目のその瞬間に衝撃が加わると、波形が心室細動の細かく乱れた波に変わる。`}>
            <defs>
              <pattern id={`${id}-s`} width={grid} height={grid} patternUnits="userSpaceOnUse">
                <path d={`M${grid} 0V${grid}H0`} fill="none" class="ecg__grid-s" />
              </pattern>
              <pattern id={`${id}-l`} width={grid * 5} height={grid * 5} patternUnits="userSpaceOnUse">
                <rect width={grid * 5} height={grid * 5} fill={`url(#${id}-s)`} />
                <path d={`M${grid * 5} 0V${grid * 5}H0`} fill="none" class="ecg__grid-l" />
              </pattern>
              <filter id={`${id}-glow`} x="-10%" y="-30%" width="120%" height="160%">
                <feGaussianBlur stdDeviation="2.4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width={w} height={h} fill={`url(#${id}-l)`} />

            {/* vulnerable windows */}
            {m.windows.map(([a, b], i) => (
              <rect key={i} class={`ecg__win ${i === 1 ? 'is-hit' : ''}`} x={a} y={8} width={b - a} height={h - 16} rx="2" />
            ))}

            {/* wave labels on beat 1 */}
            {m.waves.map((wv) => (
              <text key={wv.key} class="ecg__wave" x={wv.key === 'T' ? wv.x + 9 : wv.x} y={Math.max(14, wv.y - 10)} text-anchor={wv.key === 'T' ? 'start' : 'middle'}>
                {wv.key}
              </text>
            ))}

            {/* trace */}
            <path class="ecg__trace" d={m.normalPath} pathLength={1} filter={`url(#${id}-glow)`} />
            <path class="ecg__vf" d={m.vfPath} pathLength={1} filter={`url(#${id}-glow)`} />

            {/* impact */}
            <g class="ecg__impact">
              <line x1={m.impactX} y1={small ? 22 : 26} x2={m.impactX} y2={m.baseline - m.amp * 0.36 - 8} />
              <path d={`M${m.impactX - 6} ${m.baseline - m.amp * 0.36 - 16} L${m.impactX} ${m.baseline - m.amp * 0.36 - 6} L${m.impactX + 6} ${m.baseline - m.amp * 0.36 - 16}`} />
              <text x={m.impactX} y={small ? 16 : 18} text-anchor="middle">
                衝撃
              </text>
            </g>

            {/* window tag under the hit beat */}
            {/* (left of the window: the area under the ST segment is always clear of the trace) */}
            <g class="ecg__tag">
              <path d={`M${m.windows[1][1]} ${m.baseline + 14} v8 H${m.windows[1][0] - 4}`} />
              <text x={m.windows[1][0] - 8} y={m.baseline + 26} text-anchor="end">
                {tag}
              </text>
            </g>

            {/* VF label */}
            <text class="ecg__vf-label" x={w - 14} y={small ? 18 : 22} text-anchor="end">
              心室細動
            </text>
          </svg>
        )}
      </div>
      <dl class="ecg__legend">
        <div class="ecg__legend-row ecg__legend-row--win">
          <dt>
            <span class="ecg__swatch ecg__swatch--win" aria-hidden="true" />
            {tag}
          </dt>
          <dd>
            <strong>{d.windowLabel}</strong>
            <span>{d.windowDetail}</span>
          </dd>
        </div>
        <div class="ecg__legend-row">
          <dt>
            <span class="ecg__swatch ecg__swatch--ok" aria-hidden="true" />
            ふだんの拍動
          </dt>
          <dd>P波（心房が縮む合図）→ QRS波（心室が縮む合図）→ T波（心室が電気的に元へ戻っていく）の繰り返し。</dd>
        </div>
        <div class="ecg__legend-row">
          <dt>
            <span class="ecg__swatch ecg__swatch--vf" aria-hidden="true" />
            心室細動
          </dt>
          <dd>心室が細かく震えるだけになり、血液を送り出せない状態。この震えを止めるには電気ショック（AED）が要る。</dd>
        </div>
      </dl>
      <p class="dg__aside">※ 見やすくするため、窓の幅は実際より広く描いています。</p>
    </DiagramFrame>
  );
}
