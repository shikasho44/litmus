import { useInView } from './hooks';
import { TONE_META, type CompareData } from './model';
import { DiagramFrame } from './DiagramFrame';

/**
 * 'compare' — two look-alikes side by side (added 2026-09-27 for CASE 04: an edible spring
 * wildflower and the poisonous plant whose young leaves look the same). One row per aspect;
 * the decisive difference (`key`) is marked in words (「決め手」), not by colour alone.
 * ARIA table semantics, so a screen reader reads it row by row. On phones the aspect becomes
 * a heading above its two cells.
 */
export function CompareDiagram({ d, index }: { d: CompareData; index?: number }) {
  const [viewRef, seen] = useInView<HTMLElement>(0.2);
  const L = TONE_META[d.left.tone];
  const R = TONE_META[d.right.tone];
  return (
    <DiagramFrame frameRef={viewRef} kind="compare" title={d.title} en="SIDE BY SIDE" source={d.source} index={index} seen={seen}>
      <div class="cmp" role="table" aria-label={d.title} style={{ '--l': L.color, '--r': R.color }}>
        <div class="cmp__row cmp__row--head" role="row">
          <span class="cmp__aspect" role="columnheader">
            <span class="sr-only">見るところ</span>
          </span>
          <div class="cmp__name cmp__name--l" role="columnheader">
            <strong>{d.left.name}</strong>
            {d.left.note && <small>{d.left.note}</small>}
          </div>
          <div class="cmp__name cmp__name--r" role="columnheader">
            <strong>{d.right.name}</strong>
            {d.right.note && <small>{d.right.note}</small>}
          </div>
        </div>
        {d.rows.map((r, i) => (
          <div key={i} class={`cmp__row${r.key ? ' is-key' : ''}`} role="row" style={{ '--i': i }}>
            <span class="cmp__aspect" role="rowheader">
              {r.aspect}
              {r.key && <em class="cmp__key">決め手</em>}
            </span>
            <span class="cmp__cell cmp__cell--l" role="cell">
              {r.left}
            </span>
            <span class="cmp__cell cmp__cell--r" role="cell">
              {r.right}
            </span>
          </div>
        ))}
      </div>
      {d.verdict && (
        <p class="dg__marker cmp__verdict">
          <span class="dg__marker-pin" aria-hidden="true" />
          <span>{d.verdict}</span>
        </p>
      )}
    </DiagramFrame>
  );
}
