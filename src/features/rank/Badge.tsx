/**
 * 名探偵度数 badges (design bible §3-6) — CSS only, no raster art, crisp at any size:
 * a serrated rosette (clip-path) in the tier's metal, an ink disc and the level numeral.
 *   Lv0 empty dashed ring · Lv1 bronze · Lv2 silver · Lv3 gold · Lv4 formalin · Lv5 prismatic
 * Every colour comes from the tokens (degree.css). The numeral is DOM text, the badge is
 * decorative when a label sits next to it (pass `label` when it stands alone).
 */
import { detectiveLevel, formatPenalty, type DetectiveLevel } from './index';
import './degree.css';

/** 24 teeth: a rosette outline in % (computed once). */
const ROSETTE = (() => {
  const pts: string[] = [];
  const teeth = 24;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth - Math.PI / 2;
    const r = i % 2 === 0 ? 50 : 44.5;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)}% ${(50 + r * Math.sin(a)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(',')})`;
})();

export function DetectiveBadge({ level, size = 'md', label, class: cls = '' }: { level: number; size?: 'xs' | 'sm' | 'md' | 'lg'; label?: string; class?: string }) {
  const lv = Math.max(0, Math.min(5, Math.round(level)));
  return (
    <span
      class={`detb detb--${size} detb--lv${lv} ${cls}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-level={lv}
    >
      <span class="detb__rosette" style={{ clipPath: ROSETTE }} />
      <span class="detb__disc">
        {size !== 'xs' && <span class="detb__lv">LV</span>}
        <span class="detb__num">{lv > 0 ? lv : '—'}</span>
      </span>
    </span>
  );
}

/** Compact meter: badge + level name + total + bar to the next badge (Files header). */
export function DegreeMeter({ total, onClick }: { total: number; onClick?: () => void }) {
  const l: DetectiveLevel = detectiveLevel(total);
  const body = (
    <>
      <DetectiveBadge level={l.level} size="sm" />
      <span class="dmeter__text">
        <span class="dmeter__row">
          <span class="dmeter__k">名探偵度数</span>
          <span class="dmeter__total">{l.total}</span>
        </span>
        <span class="dmeter__name">{l.level > 0 ? `Lv.${l.level} ${l.name}` : 'まだ称号なし'}</span>
        <span class="dmeter__bar" aria-hidden="true">
          <span style={{ width: `${Math.round(l.progress * 100)}%` }} />
        </span>
        <span class="dmeter__next">{l.next ? (l.level > 0 ? `次の称号まで あと${l.toNext}` : '事件を解決すると称号がつきます') : '最高位'}</span>
      </span>
    </>
  );
  const aria = `名探偵度数 ${l.total}、${l.level > 0 ? `レベル${l.level} ${l.name}` : 'まだ称号なし'}${l.next ? `。次の称号「${l.next.name}」まで あと${l.toNext}` : ''}`;
  return onClick ? (
    <button type="button" class={`dmeter dtier--${l.level}`} onClick={onClick} aria-label={`${aria}（説明を開く）`} data-degree-meter>
      {body}
    </button>
  ) : (
    <div class={`dmeter dtier--${l.level}`} role="group" aria-label={aria} data-degree-meter>
      {body}
    </div>
  );
}

/** A static 「減点 −n」 tag (game-over / suspension overlays): the same ink as the in-play float. */
export function PenaltyTag({ points, label }: { points: number; label?: string }) {
  if (!(points > 0)) return null;
  return (
    <span class="pen-tag">
      <span class="pen-tag__k">減点</span>
      <span class="pen-tag__n">−{formatPenalty(points)}</span>
      {label && <span class="pen-tag__label">{label}</span>}
    </span>
  );
}
