/**
 * One statement of ノイズ・ブレイク: a diagonal band that slides across the stage.
 * Noise spans ([[…]] in the case file) are real buttons — the targets.
 */
import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { InquestStatementView } from '../../../shared/api';
import { motionReduced } from '../../fx/motion';
import { ART, holmaMeta, useImage } from '../../lib/asset';
import type { Target } from './session';

export interface BandPos {
  y: number; // % of the arena height (centre line)
  tilt: number; // deg
}

// Centre lines sit below Holma's face (upper right) and under Jane's (mid left).
const POS_WIDE: BandPos[] = [
  { y: 52, tilt: -6 },
  { y: 60, tilt: -4 },
  { y: 48, tilt: -7 },
  { y: 63, tilt: -5 },
  { y: 55, tilt: -5.5 },
  { y: 50, tilt: -6.5 },
];
// Phone: above both faces (characters stand in the lower half), below Holma's quips.
const POS_NARROW: BandPos[] = [
  { y: 38, tilt: -4 },
  { y: 44, tilt: -3 },
  { y: 35, tilt: -5 },
  { y: 46, tilt: -3.5 },
  { y: 40, tilt: -4.5 },
  { y: 42, tilt: -3 },
];
export const bandPos = (i: number, narrow: boolean) => (narrow ? POS_NARROW : POS_WIDE)[i % 6];

/** Tiny cyan glass-shard face for Jane's statements. */
export function JaneChip({ size = 40 }: { size?: number }) {
  return (
    <svg class="chip-jane" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="cj-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#9BF0FF" />
          <stop offset="0.55" stop-color="#3DE0FF" />
          <stop offset="1" stop-color="#0B7C99" />
        </linearGradient>
      </defs>
      <path d="M20 3 L31 9 L34 21 L28 33 L20 37 L12 33 L6 21 L9 9 Z" fill="#0B1A22" stroke="url(#cj-g)" stroke-width="1.6" />
      <path d="M20 3 L18 15 L9 9 M18 15 L6 21 M18 15 L24 22 L34 21 M24 22 L28 33 M24 22 L20 37 M18 15 L31 9 M24 22 L12 33" fill="none" stroke="#3DE0FF" stroke-opacity="0.55" stroke-width="0.9" />
      <path d="M18 15 L24 22 L20 37 L12 33 Z" fill="#3DE0FF" fill-opacity="0.22" />
      <path d="M9 9 L18 15 L6 21 Z" fill="#9BF0FF" fill-opacity="0.18" />
    </svg>
  );
}

/** Round crop of Holma's face from the sprite (vector rabbit glyph while art is missing). */
export function HolmaChip({ size = 40 }: { size?: number }) {
  const url = useImage(ART.holma('normal'));
  const meta = holmaMeta.value?.normal;
  if (!url) {
    return (
      <span class="chip-holma is-fallback" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M9 3.5c-1.4 2.2-1.4 5.3 0 7.5M15 3.5c1.4 2.2 1.4 5.3 0 7.5" />
          <circle cx="12" cy="15" r="6" />
          <circle cx="10" cy="14.5" r="0.9" fill="currentColor" />
          <circle cx="14.2" cy="14.5" r="1.2" />
        </svg>
      </span>
    );
  }
  const s = 3.1; // image width relative to chip width
  const ar = meta ? meta.h / meta.w : 1.6;
  const fx = meta?.face.x ?? 0.52;
  const fy = meta?.face.y ?? 0.28;
  const px = ((fx * s - 0.5) / (s - 1)) * 100;
  const py = ((fy * s * ar - 0.5) / (s * ar - 1)) * 100;
  return (
    <span
      class="chip-holma"
      style={{ width: size, height: size, backgroundImage: `url(${url})`, backgroundSize: `${s * 100}% auto`, backgroundPosition: `${px}% ${py}%` }}
      aria-hidden="true"
    />
  );
}

export interface StatementBandProps {
  statement: InquestStatementView;
  index: number;
  total: number;
  pos: BandPos;
  leaving?: boolean;
  holdMs: number;
  halted: boolean;
  target: Target | null;
  broken: Target | null;
  interactive: boolean;
  onNoise?: (t: Target) => void;
  onTap?: () => void;
}

type StatementSegment = InquestStatementView['segments'][number];

/** Characters that may not start a line (they follow the noise) / end one (they precede it). */
const NO_START = /^[。、，．,.！？!?…‥」』）)〕］\]｝}〉》ー〜～ァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ]+/;
const NO_END = /[「『（(〔［\[｛{〈《]+$/;

interface GluedSeg {
  seg: StatementSegment;
  k: number;
  /** text moved from the previous plain segment in front of the noise */
  before?: string;
  /** text moved from the next plain segment behind the noise */
  after?: string;
}

/** Split plain text around each noise so kinsoku characters stay glued to it. */
export function glued(segments: readonly StatementSegment[]): GluedSeg[] {
  const out: GluedSeg[] = segments.map((seg, k) => ({ seg, k }));
  for (let i = 0; i < out.length; i++) {
    if (!out[i].seg.noise) continue;
    const prev = out[i - 1];
    if (prev && !prev.seg.noise) {
      const m = prev.seg.text.match(NO_END);
      if (m) {
        out[i].before = m[0];
        prev.seg = { ...prev.seg, text: prev.seg.text.slice(0, -m[0].length) };
      }
    }
    const next = out[i + 1];
    if (next && !next.seg.noise) {
      const m = next.seg.text.match(NO_START);
      if (m) {
        out[i].after = m[0];
        next.seg = { ...next.seg, text: next.seg.text.slice(m[0].length) };
      }
    }
  }
  return out.filter((g) => g.seg.noise || g.seg.text);
}

export function StatementBand({ statement, index, total, pos, leaving, holdMs, halted, target, broken, interactive, onNoise, onTap }: StatementBandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const jane = statement.speaker === 'jane';
  const locked = !leaving && !!target && target.statementId === statement.id;

  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.band__strip');
    if (!el) return;
    const reduced = motionReduced();
    if (leaving) {
      const tw = reduced
        ? gsap.to(el, { opacity: 0, duration: 0.25 })
        : gsap.to(el, { xPercent: -38, opacity: 0, skewX: 14, duration: 0.42, ease: 'power3.in' });
      return () => tw.kill();
    }
    const tl = gsap.timeline();
    if (reduced) tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    else {
      tl.fromTo(el, { xPercent: 46, opacity: 0, skewX: -16 }, { xPercent: 0, opacity: 1, skewX: 0, duration: 0.55, ease: 'expo.out' });
      tl.fromTo(el.querySelectorAll('.band__text > *'), { opacity: 0, x: 26 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.03, ease: 'power3.out' }, 0.1);
    }
    return () => tl.kill();
  }, []);

  return (
    <div
      ref={ref}
      class={`band band--${statement.speaker} ${leaving ? 'is-leaving' : ''} ${halted ? 'is-halted' : ''}`}
      style={{ '--band-y': `${pos.y}%`, '--band-tilt': `${pos.tilt}deg`, '--hold': `${holdMs}ms` }}
      aria-hidden={leaving ? 'true' : undefined}
      data-statement-id={leaving ? undefined : statement.id}
    >
      <div
        class="band__strip"
        role={leaving ? undefined : 'group'}
        aria-label={leaving ? undefined : `発言 ${index + 1}/${total}・${jane ? 'ジェーン・ドゥ' : 'ホルマ'}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.noise')) return;
          onTap?.();
        }}
      >
        <div class="band__lines" aria-hidden="true" />
        <div class="band__drift">
          <div class="band__who">
            {jane ? <JaneChip size={38} /> : <HolmaChip size={38} />}
            <span class="band__name">{jane ? 'ジェーン・ドゥ' : 'ホルマ'}</span>
            {/* phone: the LOCK tag lives in the header row, never on top of the name or counter */}
            {locked && (
              <span class="band__lock" aria-hidden="true">
                LOCK
              </span>
            )}
            <span class="band__idx">
              {String(index + 1).padStart(2, '0')}
              <i>/{String(total).padStart(2, '0')}</i>
            </span>
          </div>
          <p class="band__text">
            {glued(statement.segments).map(({ seg, k, before, after }) => {
              if (!seg.noise) return <span key={k}>{seg.text}</span>;
              const isT = !!target && target.statementId === statement.id && target.seg === k;
              const isB = !!broken && broken.statementId === statement.id && broken.seg === k;
              const activate = () => onNoise?.({ statementId: statement.id, seg: k, text: seg.text });
              // A span (not <button>) so long noise can wrap inside the line on phones.
              const noise = (
                <span
                  key={k}
                  role="button"
                  class={`noise ${isT ? 'is-target' : ''} ${isB ? 'is-broken' : ''}`}
                  data-noise={seg.text}
                  data-seg={k}
                  data-text={seg.text}
                  tabIndex={leaving || !interactive ? -1 : 0}
                  aria-disabled={!interactive ? 'true' : undefined}
                  aria-pressed={isT}
                  aria-label={`ノイズ「${seg.text}」${isT ? '（照準中）' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!interactive) return;
                    activate();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    if (e.isComposing) return;
                    if (e.key === 'Enter' && isT) return; // the scene fires on Enter at the locked target
                    e.preventDefault();
                    e.stopPropagation();
                    if (interactive) activate();
                  }}
                >
                  <span class="noise__txt">{seg.text}</span>
                  {isT && (
                    <span class="noise__lock" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                      <b>LOCK</b>
                    </span>
                  )}
                  {isB && <span class="noise__crack" aria-hidden="true" />}
                </span>
              );
              // An opening bracket before / a stop after the noise travels with it: a line never
              // starts with 「。」 (or ends with 「「」) just because the noise is its own box.
              if (!before && !after) return noise;
              return (
                <span key={`g${k}`} class="noise-glue">
                  {before}
                  {noise}
                  {after}
                </span>
              );
            })}
          </p>
        </div>
        {!leaving && <div class="band__timer" aria-hidden="true" />}
      </div>
    </div>
  );
}
