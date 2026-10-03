/**
 * 名探偵度数 badges (design bible §3-6) — CSS only, no raster art, crisp at any size:
 * a serrated rosette (clip-path) in the tier's metal, an ink disc and the level numeral.
 *   Lv0 empty dashed ring · Lv1–2 bronze · Lv3–4 silver · Lv5–6 gold · Lv7 formalin (名探偵) ·
 *   Lv8 cyan · Lv9 violet · Lv10 crimson · Lv11 prismatic (伝説の名探偵) · Lv12+ the ★ tail:
 *   prismatic with a 「★n」 tab (2026-10-04, 11 named levels + an endless tail)
 * The second level of a metal is the polished one (brighter, a faint glow). Every colour comes
 * from the tokens (degree.css; the class carries the tier, detectiveTier). The numeral is DOM
 * text, the badge is decorative when a label sits next to it (pass `label` when it stands alone).
 */
import { detectiveLevel, detectiveRank, detectiveTier, formatPenalty, type DetectiveLevel } from './index';
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
  const lv = Math.max(0, Math.round(Number.isFinite(level) ? level : 0));
  const stars = detectiveRank(lv).stars;
  return (
    <span
      class={`detb detb--${size} detb--lv${detectiveTier(lv)} ${lv >= 10 ? 'detb--wide' : ''} ${cls}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-level={lv}
      data-stars={stars > 0 ? stars : undefined}
    >
      <span class="detb__rosette" style={{ clipPath: ROSETTE }} />
      <span class="detb__disc">
        {size !== 'xs' && <span class="detb__lv">LV</span>}
        <span class="detb__num">{lv > 0 ? lv : '—'}</span>
      </span>
      {stars > 0 && <span class="detb__stars">★{stars}</span>}
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
        <span class="dmeter__next">{l.level > 0 ? `次の称号まで あと${l.toNext}` : '事件を解決すると称号がつきます'}</span>
      </span>
    </>
  );
  const aria = `名探偵度数 ${l.total}、${l.level > 0 ? `レベル${l.level} ${l.name}` : 'まだ称号なし'}。次の称号「${l.next.name}」まで あと${l.toNext}`;
  const tier = detectiveTier(l.level);
  return onClick ? (
    <button type="button" class={`dmeter dtier--${tier}`} onClick={onClick} aria-label={`${aria}（説明を開く）`} data-degree-meter>
      {body}
    </button>
  ) : (
    <div class={`dmeter dtier--${tier}`} role="group" aria-label={aria} data-degree-meter>
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
