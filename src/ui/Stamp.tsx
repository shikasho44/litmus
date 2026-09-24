import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { AnswerClass } from '../../shared/case-schema';
import { motionReduced } from '../fx/motion';
import './stamp.css';

/** Bible §4-3 — meaning is carried by text AND colour. */
export const STAMP_META: Record<AnswerClass, { jp: string; en: string; color: string; sr: string }> = {
  yes: { jp: 'はい', en: 'YES', color: 'var(--c-yes)', sr: 'はい' },
  no: { jp: 'いいえ', en: 'NO', color: 'var(--c-no)', sr: 'いいえ' },
  partial: { jp: '一部そう', en: 'PARTIAL', color: 'var(--c-partial)', sr: '一部そう' },
  irrelevant: { jp: '関係ない', en: 'IRRELEVANT', color: 'var(--c-irrelevant)', sr: '関係ない' },
  cannot: { jp: '今は答えられない', en: 'CLASSIFIED', color: 'var(--c-cannot)', sr: '今は答えられない' },
  vague: { jp: 'もう少し具体的に', en: 'REPHRASE', color: 'var(--c-vague)', sr: 'もう少し具体的に' },
};

export interface StampProps {
  answerClass: AnswerClass;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Play the slam-in animation on mount. */
  animate?: boolean;
  /** Called at the moment of impact (use for shake / sfx). */
  onImpact?: () => void;
  /** Rotation in degrees (default -9). */
  tilt?: number;
  class?: string;
  /** Hide from AT (when the answer is announced elsewhere). */
  decorative?: boolean;
}

/** The big judgement stamp. */
export function Stamp({ answerClass, size = 'md', animate, onImpact, tilt = -9, class: cls, decorative }: StampProps) {
  const meta = STAMP_META[answerClass] ?? STAMP_META.vague;
  const ref = useRef<HTMLDivElement>(null);
  const len = [...meta.jp].length;
  const jpScale = len <= 2 ? 1 : len === 3 ? 0.9 : len <= 4 ? 0.72 : 0.46;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !animate) return;
    const frame = el.querySelector('.stamp__frame');
    const splat = el.querySelector('.stamp__splat');
    if (motionReduced()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.18 });
      onImpact?.();
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(frame, { scale: 2.8, opacity: 0, rotation: tilt + 14 }, { scale: 0.94, opacity: 1, rotation: tilt, duration: 0.2, ease: 'power4.in' })
      .add(() => onImpact?.())
      .to(frame, { scale: 1, duration: 0.3, ease: 'elastic.out(1.2, 0.5)' })
      .fromTo(splat, { scale: 0.6, opacity: 0.9 }, { scale: 1.5, opacity: 0, duration: 0.45, ease: 'power2.out' }, '<');
    return () => {
      tl.kill();
    };
  }, [answerClass, animate]);

  return (
    <div
      ref={ref}
      class={`stamp stamp--${size} stamp--${answerClass} ${cls ?? ''}`}
      style={{ '--stamp-color': meta.color, '--stamp-tilt': `${tilt}deg`, '--jp-scale': jpScale }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `判定：${meta.sr}`}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <span class="stamp__splat" aria-hidden="true" />
      <div class="stamp__frame" aria-hidden="true">
        <span class="stamp__kicker">ZERO ROOM · VERDICT</span>
        <span class="stamp__jp">{meta.jp}</span>
        <span class="stamp__en">{meta.en}</span>
      </div>
    </div>
  );
}
