import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useInView } from './hooks';
import { formatValue, levelsModel, TONE_META, type LevelsData } from './model';
import { DiagramFrame } from './DiagramFrame';

const PAD = 14; // px inside the scale column above the first / below the last position

/**
 * 'levels' — a vertical ladder / thermometer. The scale is proportional to the values; the
 * readable callouts (value, tone, label, detail) are laid out as a list on the right and
 * joined to their exact position on the scale by leader lines (measured after layout, so
 * long Japanese text never overlaps however narrow the screen is).
 */
export function LevelsDiagram({ d, index }: { d: LevelsData; index?: number }) {
  const model = useMemo(() => levelsModel(d), [d]);
  const [viewRef, seen] = useInView<HTMLElement>(0.2);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const gap = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ h: number; gw: number; anchors: number[] } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    const ol = list.current;
    if (!el || !ol) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const anchors = Array.from(ol.querySelectorAll<HTMLElement>('.lv__head')).map((h) => {
        const r = h.getBoundingClientRect();
        return r.top + r.height / 2 - base.top;
      });
      const gw = gap.current?.clientWidth ?? 40;
      setGeo((g) => (g && g.h === base.height && g.gw === gw && g.anchors.every((a, i) => Math.abs(a - anchors[i]) < 0.5) ? g : { h: base.height, gw, anchors }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [d]);

  const y = (p: number) => (geo ? PAD + p * (geo.h - 2 * PAD) : 0);
  const markerPos = d.marker ? model.pos(d.marker.value) : null;
  const levelPos = d.levels.map((l) => model.pos(l.value));
  // hide minor tick labels that would collide with a level / marker label
  const taken = [...levelPos, ...(markerPos !== null ? [markerPos] : [])];
  const h = geo?.h ?? 400;
  const free = (p: number) => taken.every((t) => Math.abs(t - p) * (h - 2 * PAD) > 15);

  return (
    <DiagramFrame frameRef={viewRef} kind="levels" title={d.title} en="THRESHOLD LADDER" source={d.source} index={index} seen={seen} note={d.unit ? `単位：${d.unit}` : undefined}>
      <div class="lv" ref={wrap} style={{ '--lv-pad': `${PAD}px` }}>
        <div class="lv__scale" aria-hidden="true">
          <div class="lv__tube">
            {model.bands.map((b, i) => (
              <span
                key={i}
                class={`lv__band lv__band--${b.tone}`}
                style={{ top: `${b.from * 100}%`, height: `${(b.to - b.from) * 100}%`, '--tone': TONE_META[b.tone].color, '--i': i }}
              />
            ))}
            <span class="lv__gloss" />
          </div>
          {model.ticks.map((t) => (
            <span key={`t${t.value}`} class="lv__tick" style={{ top: `${y(t.pos)}px` }}>
              {free(t.pos) && <em>{formatValue(t.value, '')}</em>}
            </span>
          ))}
          {d.levels.map((l, i) => (
            <span key={`l${i}`} class="lv__notch" style={{ top: `${y(levelPos[i])}px`, '--tone': TONE_META[l.tone].color }}>
              {!(markerPos !== null && Math.abs(markerPos - levelPos[i]) * (h - 2 * PAD) < 15) && <em>{formatValue(l.value, '')}</em>}
            </span>
          ))}
          {d.marker && markerPos !== null && (
            <span class="lv__marker" style={{ top: `${y(markerPos)}px` }}>
              <em>{formatValue(d.marker.value, d.unit)}</em>
            </span>
          )}
        </div>
        <div class="lv__gap" ref={gap} aria-hidden="true">
          {geo && (
            <svg width={geo.gw} height={geo.h} viewBox={`0 0 ${geo.gw} ${geo.h}`}>
              {d.levels.map((l, i) => {
                const ys = y(levelPos[i]);
                const ya = geo.anchors[i] ?? ys;
                const gw = geo.gw;
                return (
                  <g key={i} class="lv__leader" style={{ '--tone': TONE_META[l.tone].color, '--i': i }}>
                    <path pathLength={1} d={`M0 ${ys.toFixed(1)} C ${(gw * 0.55).toFixed(1)} ${ys.toFixed(1)}, ${(gw * 0.45).toFixed(1)} ${ya.toFixed(1)}, ${gw - 2} ${ya.toFixed(1)}`} />
                    <circle cx="1.5" cy={ys} r="3" />
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <ol class="lv__list" ref={list}>
          {d.levels.map((l, i) => (
            <li key={i} class={`lv__item lv__item--${l.tone}`} style={{ '--tone': TONE_META[l.tone].color, '--i': i }}>
              <div class="lv__head">
                <span class="lv__value">
                  {formatValue(l.value, '')}
                  <small>{d.unit}</small>
                </span>
                <span class="lv__tone">{TONE_META[l.tone].label}</span>
                <strong class="lv__label">{l.label}</strong>
              </div>
              <p class="lv__detail">{l.detail}</p>
            </li>
          ))}
        </ol>
      </div>
      {d.marker && (
        <p class="dg__marker">
          <span class="dg__marker-pin" aria-hidden="true" />
          <span class="dg__marker-value">{formatValue(d.marker.value, d.unit)}</span>
          <span>{d.marker.label}</span>
        </p>
      )}
    </DiagramFrame>
  );
}
