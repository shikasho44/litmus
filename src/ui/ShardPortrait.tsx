import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { motionReduced } from '../fx/motion';
import { useImage } from '../lib/asset';
import { rng } from '../lib/rng';
import { JANE_SILHOUETTE, SHARD_H, SHARD_W, makeShards, pointsAttr } from './shards';
import './shards.css';

export interface ShardPortraitProps {
  /** Public path of the portrait (e.g. cases/c01/portrait.webp). Missing → vector fallback. */
  image?: string;
  shardCount?: number;
  /** Number of lit shards (in the deterministic reveal order) or explicit shard ids ('s0'…). */
  revealed?: number | string[];
  /** Solved: shards assemble with a flash into the full-colour portrait. */
  solved?: boolean;
  /** Called once the assemble animation has finished (immediately with reduced motion). */
  onAssembled?: () => void;
  /** Seed for the shard layout (use the case id so each Jane Doe breaks differently). */
  seed?: string;
  /** Clip to a bust silhouette until solved (default true). */
  silhouette?: boolean;
  class?: string;
  label?: string;
  /** Brighter edges & halo (e.g. while Jane is speaking). */
  glow?: boolean;
}

let uid = 0;

/**
 * ジェーン・ドゥの破片の肖像. Unrevealed shards are dark glass with faint cyan edges and a
 * slight chromatic flicker; revealed shards show the portrait in cold monochrome blue;
 * `solved` assembles every shard into the full-colour portrait.
 */
export function ShardPortrait({ image, shardCount = 34, revealed = 0, solved = false, onAssembled, seed = 'jane', silhouette = true, class: cls, label, glow }: ShardPortraitProps) {
  const [u] = useState(() => `sp${++uid}`);
  const url = useImage(image);
  const shards = useMemo(() => makeShards(shardCount, seed), [shardCount, seed]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [assembled, setAssembled] = useState(solved);
  const [animating, setAnimating] = useState(false);
  const prevLit = useRef<Set<string>>(new Set());
  const litInit = useRef(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const lit = useMemo(() => {
    if (Array.isArray(revealed)) return new Set(revealed);
    const n = Math.max(0, Math.min(shards.length, Math.round(revealed)));
    return new Set(shards.filter((s) => s.order < n).map((s) => s.id));
  }, [revealed, shards]);

  // flash newly lit shards
  useEffect(() => {
    const added = [...lit].filter((id) => !prevLit.current.has(id));
    // no flash for what is already lit on mount (but 0 → 1 later on does flash)
    const firstRun = !litInit.current;
    litInit.current = true;
    prevLit.current = new Set(lit);
    if (!added.length || firstRun) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 1400);
    return () => clearTimeout(t);
  }, [lit]);

  // flicker subset (stable)
  const flicker = useMemo(() => {
    const r = rng(`flicker:${seed}`);
    return new Map(shards.map((s) => [s.id, r() < 0.28 ? `${(r() * 6).toFixed(2)}s` : '']));
  }, [shards, seed]);

  // solve animation
  useLayoutEffect(() => {
    if (!solved) {
      setAssembled(false);
      return;
    }
    if (assembled) return;
    const svg = svgRef.current;
    if (!svg || motionReduced()) {
      setAssembled(true);
      onAssembled?.();
      return;
    }
    setAnimating(true);
    const pieces = Array.from(svg.querySelectorAll<SVGGElement>('.shards__piece'));
    const glass = svg.querySelectorAll('.shards__glass polygon');
    const color = svg.querySelector('.shards__color');
    const clipShape = svg.querySelector(`#${u}-sil path`);
    const outline = svg.querySelector('.shards__outline');
    const r = rng(`solve:${seed}`);
    const tl = gsap.timeline({
      onComplete: () => {
        setAssembled(true);
        setAnimating(false);
        onAssembled?.();
      },
    });
    if (glass.length) tl.to(glass, { opacity: 0, duration: 0.35, stagger: { each: 0.008, from: 'center' } }, 0);
    pieces.forEach((p) => {
      const cx = Number(p.dataset.cx);
      const cy = Number(p.dataset.cy);
      const dx = (cx - SHARD_W / 2) * (0.18 + r() * 0.2);
      const dy = (cy - SHARD_H / 2) * (0.14 + r() * 0.18);
      const rot = (r() - 0.5) * 34;
      tl.fromTo(p, { x: 0, y: 0, rotation: 0, svgOrigin: `${cx} ${cy}` }, { x: dx, y: dy, rotation: rot, duration: 0.45, ease: 'power2.out' }, 0.05 + r() * 0.15);
      tl.to(p, { x: 0, y: 0, rotation: 0, duration: 0.42, ease: 'expo.in' }, 0.75 + r() * 0.2);
    });
    tl.addLabel('snap', 1.4);
    tl.fromTo(color, { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power2.out' }, 'snap');
    if (clipShape) tl.to(clipShape, { scale: 2.6, svgOrigin: '150 200', duration: 0.9, ease: 'power3.inOut' }, 'snap');
    if (outline) tl.to(outline, { opacity: 0, duration: 0.4 }, 'snap');
    tl.to(svg.querySelector('.shards__burst'), { opacity: 1, duration: 0.08 }, 'snap').to(svg.querySelector('.shards__burst'), { opacity: 0, duration: 0.7 });
    return () => {
      tl.kill();
    };
  }, [solved]);

  const art = url ? (
    <image href={url} x="0" y="0" width={SHARD_W} height={SHARD_H} preserveAspectRatio="xMidYMid slice" />
  ) : (
    <use href={`#${u}-fallback`} />
  );
  const showColorLayer = solved || assembled;
  const clipped = silhouette && !assembled;

  return (
    <div class={`shards ${assembled ? 'is-solved' : ''} ${animating ? 'is-animating' : ''} ${glow ? 'is-glow' : ''} ${cls ?? ''}`} role="img" aria-label={label ?? (solved ? '復元された肖像' : `ジェーン・ドゥの破片（${lit.size}/${shards.length}）`)}>
      <svg ref={svgRef} viewBox={`0 0 ${SHARD_W} ${SHARD_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={`${u}-sil`}>
            <path d={JANE_SILHOUETTE} />
          </clipPath>
          {shards.map((s) => (
            <clipPath key={s.id} id={`${u}-${s.id}`}>
              <polygon points={pointsAttr(s.points)} />
            </clipPath>
          ))}
          <filter id={`${u}-cold`} color-interpolation-filters="sRGB">
            <feColorMatrix type="matrix" values="0.08 0.16 0.03 0 0.02  0.28 0.55 0.1 0 0.05  0.38 0.75 0.15 0 0.1  0 0 0 1 0" />
          </filter>
          <filter id={`${u}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <linearGradient id={`${u}-glass0`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#1A4353" />
            <stop offset="0.5" stop-color="#0C1E27" />
            <stop offset="1" stop-color="#060C11" />
          </linearGradient>
          <linearGradient id={`${u}-glass1`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#15384A" />
            <stop offset="0.6" stop-color="#0A171F" />
            <stop offset="1" stop-color="#050A0E" />
          </linearGradient>
          <linearGradient id={`${u}-glass2`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="#0B1A22" />
            <stop offset="0.7" stop-color="#11303D" />
            <stop offset="1" stop-color="#1D5063" />
          </linearGradient>
          <linearGradient id={`${u}-sheen`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0.28" stop-color="#FFFFFF" stop-opacity="0" />
            <stop offset="0.36" stop-color="#D8F8FF" stop-opacity="0.16" />
            <stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0" />
            <stop offset="0.62" stop-color="#FFFFFF" stop-opacity="0" />
            <stop offset="0.66" stop-color="#D8F8FF" stop-opacity="0.08" />
            <stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0" />
          </linearGradient>
          <radialGradient id={`${u}-bg`} cx="0.5" cy="0.35" r="0.8">
            <stop offset="0" stop-color="#3B4A5C" />
            <stop offset="1" stop-color="#0E1219" />
          </radialGradient>
          <linearGradient id={`${u}-skin`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#E9CDB9" />
            <stop offset="1" stop-color="#B98F7C" />
          </linearGradient>
          <g id={`${u}-fallback`}>
            <rect width={SHARD_W} height={SHARD_H} fill={`url(#${u}-bg)`} />
            <path d="M40 400 C52 334 98 312 150 308 C202 312 248 334 260 400 Z" fill="#35566A" />
            <path d="M118 262 C124 290 124 300 118 312 L182 312 C176 300 176 290 182 262 Z" fill={`url(#${u}-skin)`} />
            <ellipse cx="150" cy="170" rx="56" ry="72" fill={`url(#${u}-skin)`} />
            <path d="M150 88 C204 88 222 130 220 176 C218 214 226 244 212 262 C204 230 202 190 196 160 C180 150 150 138 128 118 C118 146 104 170 100 196 C96 226 96 248 88 262 C74 240 82 214 80 176 C78 128 98 88 150 88 Z" fill="#241E2B" />
            <ellipse cx="150" cy="190" rx="40" ry="44" fill="#FFFFFF" opacity="0.08" />
          </g>
        </defs>

        <g clip-path={clipped ? `url(#${u}-sil)` : undefined} class="shards__clip">
          <rect width={SHARD_W} height={SHARD_H} fill="#05080C" />
          {/* cold (revealed) layer */}
          <g filter={`url(#${u}-cold)`} class="shards__cold">
            {shards.map((s) =>
              lit.has(s.id) || animating || assembled ? (
                <g key={s.id} class={`shards__piece ${fresh.has(s.id) ? 'is-fresh' : ''}`} data-cx={s.center[0].toFixed(1)} data-cy={s.center[1].toFixed(1)}>
                  <g clip-path={`url(#${u}-${s.id})`}>{art}</g>
                </g>
              ) : null,
            )}
          </g>
          {/* full colour layer (solve) */}
          {showColorLayer && (
            <g class="shards__color" style={{ opacity: assembled ? 1 : 0 }}>
              {art}
            </g>
          )}
          {/* unrevealed glass */}
          {!assembled && (
            <g class="shards__glass">
              {shards.map((s) =>
                lit.has(s.id) ? null : (
                  <polygon
                    key={s.id}
                    points={pointsAttr(s.points)}
                    fill={`url(#${u}-glass${s.index % 3})`}
                    class={flicker.get(s.id) ? 'is-flicker' : ''}
                    style={flicker.get(s.id) ? { animationDelay: flicker.get(s.id) } : undefined}
                  />
                ),
              )}
            </g>
          )}
          {!assembled && <rect class="shards__sheen" width={SHARD_W} height={SHARD_H} fill={`url(#${u}-sheen)`} />}
          {/* leading between pieces */}
          {!assembled && (
            <g class="shards__edges">
              {shards.map((s) => (
                <polygon key={s.id} points={pointsAttr(s.points)} class={lit.has(s.id) ? 'is-lit' : ''} />
              ))}
            </g>
          )}
          {!assembled && (
            <g class="shards__fresh">
              {shards.map((s) => (fresh.has(s.id) ? <polygon key={s.id} points={pointsAttr(s.points)} /> : null))}
            </g>
          )}
          <rect class="shards__burst" width={SHARD_W} height={SHARD_H} fill="#FFFFFF" opacity="0" />
        </g>
        {silhouette && !assembled && <path class="shards__outline" d={JANE_SILHOUETTE} filter={`url(#${u}-glow)`} />}
        {silhouette && !assembled && <path class="shards__outline shards__outline--crisp" d={JANE_SILHOUETTE} />}
      </svg>
    </div>
  );
}
