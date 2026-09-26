/**
 * 名探偵度数 on the result screen (design bible §3-6): what this run earned (獲得 +N with its
 * breakdown), whether it beat the case's best, and the cumulative degree with its badge and
 * the bar to the next one. Modest on purpose — the rank seal stays the star.
 *
 * Fresh run (?fresh=1): once the seal has landed AND the block is on screen (phones scroll to
 * it), it slides in and the total counts up from the value before this run; crossing a
 * threshold swaps the badge with a short 「ランクアップ！」. A tap (not a scroll) or a key
 * finishes the count at once; nothing waits on it. Reduced motion / a revisit: the final
 * state, no counting.
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { audio } from '../../audio';
import { DIFFICULTY_META } from '../../features/difficulty/meta';
import { DetectiveBadge } from '../../features/rank/Badge';
import { detectiveLevel, resultPoints, SPLUS_BONUS, type DetectiveLevel } from '../../features/rank';
import { motionReduced } from '../../fx/motion';
import type { CaseResult } from '../../state/types';

/** Write into the element's own text node, so Preact's later render updates the same node. */
function setText(el: HTMLElement | null, v: number | string) {
  if (!el) return;
  const t = el.firstChild;
  if (t && t.nodeType === 3) t.nodeValue = String(v);
  else el.textContent = String(v);
}

const nextLine = (l: DetectiveLevel) => (l.next ? `次の称号「${l.next.name}」まで あと${l.toNext}` : '最高位の称号です');

export function DegreeBlock({ result, total, fresh, revealed }: { result: CaseResult; total: number; fresh: boolean; revealed: boolean }) {
  const pts = useMemo(() => resultPoints(result), [result]);
  const prevBest = result.prevBestPoints;
  const hadBest = typeof prevBest === 'number';
  const gain = Math.max(0, pts.total - (prevBest ?? 0));
  const before = Math.max(0, total - gain);
  const now = detectiveLevel(total);
  const was = detectiveLevel(before);
  const rankUp = fresh && now.level > was.level;
  const animate = fresh && !motionReduced() && total !== before;

  const root = useRef<HTMLElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const nextRef = useRef<HTMLParagraphElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const [shown, setShown] = useState(() => (animate ? was : now));
  const [up, setUp] = useState(rankUp && !animate);
  const [entered, setEntered] = useState(!fresh || motionReduced());
  const [inView, setInView] = useState(false);
  const level = shown.level;

  // the count waits until the block is (mostly) on screen
  useEffect(() => {
    const el = root.current;
    if (!el || entered || inView) return;
    if (typeof IntersectionObserver === 'undefined') return setInView(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setInView(true), { threshold: 0.55 });
    io.observe(el);
    return () => io.disconnect();
  }, [entered, inView]);

  // entrance + count-up, after the seal
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || entered || !revealed || !inView) return;
    const tl = gsap.timeline({ onComplete: () => finish() });
    tlRef.current = tl;
    tl.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }).fromTo(
      el.querySelector('.rs-deg__gain-num'),
      { scale: 1.5, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.34, ease: 'back.out(2.2)', onStart: () => audio.sfx('page') },
      0.2,
    );
    if (animate) {
      const o = { v: before };
      let lv = was.level;
      tl.to(
        o,
        {
          v: total,
          duration: Math.min(1.6, 0.6 + gain / 110),
          ease: 'power2.out',
          onUpdate: () => {
            const v = Math.round(o.v);
            const l = detectiveLevel(v);
            setText(totalRef.current, v);
            setText(nextRef.current, nextLine(l));
            if (barRef.current) barRef.current.style.width = `${Math.round(l.progress * 100)}%`;
            if (l.level !== lv) {
              lv = l.level;
              setShown(l);
              if (l.level > was.level) levelUp();
            }
          },
        },
        0.55,
      );
    }
    // a tap or a key ends the show (the buttons still work: the event is not stopped). `click`,
    // not pointerdown: a finger scrolling the page must not cut it short.
    const skip = () => tl.progress(1);
    window.addEventListener('click', skip, true);
    window.addEventListener('keydown', skip, true);
    return () => {
      window.removeEventListener('click', skip, true);
      window.removeEventListener('keydown', skip, true);
      tl.kill();
    };
  }, [revealed, inView]);

  function levelUp() {
    setUp(true);
    audio.sfx('findingCore');
    requestAnimationFrame(() => {
      const el = root.current;
      if (!el || motionReduced()) return;
      gsap.fromTo(el.querySelector('.rs-deg__badge .detb'), { scale: 1.45, rotation: -14 }, { scale: 1, rotation: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.45)' });
      gsap.fromTo(el.querySelector('.rs-deg__badge .detb'), { '--db-sheen': '-70%' }, { '--db-sheen': '70%', duration: 0.7, ease: 'power2.inOut' });
      gsap.fromTo(el.querySelector('.rs-deg__up'), { scale: 2.2, opacity: 0, rotation: 8 }, { scale: 1, opacity: 1, rotation: -6, duration: 0.3, ease: 'power4.in' });
    });
  }

  function finish() {
    tlRef.current = null;
    setShown(now);
    if (rankUp) setUp(true);
    setEntered(true);
    if (root.current) gsap.set(root.current, { opacity: 1, y: 0 });
    setText(totalRef.current, total);
    setText(nextRef.current, nextLine(now));
    if (barRef.current) barRef.current.style.width = `${Math.round(now.progress * 100)}%`;
  }

  // the save changing under a settled block shows the new numbers
  useEffect(() => {
    if (tlRef.current || !entered) return;
    setShown(now);
  }, [total, entered]);

  const lv = shown.level === now.level ? now : shown;
  const initialValue = animate && !entered ? before : total;
  const initialBar = Math.round((animate && !entered ? was.progress : now.progress) * 100);
  const diff = DIFFICULTY_META[pts.difficulty];

  return (
    <section
      ref={root}
      class={`rs-deg dtier--${level} ${up ? 'is-up' : ''}`}
      aria-label="名探偵度数"
      style={entered ? undefined : { opacity: 0 }}
      data-degree={total}
      data-degree-level={now.level}
    >
      <header class="rs-deg__head">
        <span class="rs-deg__jp">名探偵度数</span>
        <span class="rs-deg__en t-mono">DETECTIVE DEGREE</span>
      </header>
      <div class="rs-deg__body">
        <div class="rs-deg__badge">
          <DetectiveBadge level={level} size="md" />
        </div>
        <div class="rs-deg__text">
          <p class="rs-deg__gain">
            <span class="rs-deg__gain-k">獲得</span>
            <span class="rs-deg__gain-num">+{pts.total}</span>
            <span class="rs-deg__formula">
              <span>事件スコア {pts.score}</span>
              <span class="rs-deg__x">
                ×{pts.multiplier.toFixed(1)}（{diff.jp}）
              </span>
              {pts.bonus > 0 && <span class="rs-deg__bonus">＋S+ボーナス {SPLUS_BONUS}</span>}
            </span>
          </p>
          {hadBest && (
            <p class={`rs-deg__note ${pts.total > prevBest! ? 'is-best' : ''}`}>
              {pts.total > prevBest!
                ? `この事件の最高記録を更新（+${prevBest} → +${pts.total}）`
                : pts.total === prevBest
                  ? `この事件の最高記録 +${prevBest} と同じ。名探偵度数はそのまま`
                  : `この事件の最高記録 +${prevBest} は更新ならず。名探偵度数はそのまま`}
            </p>
          )}
          <p class="rs-deg__total">
            <span class="rs-deg__total-k">累計</span>
            <span class="rs-deg__total-num" ref={totalRef}>
              {initialValue}
            </span>
            <span class="rs-deg__name">{lv.level > 0 ? `Lv.${lv.level} ${lv.name}` : 'まだ称号なし'}</span>
          </p>
          <span class="rs-deg__bar" aria-hidden="true">
            <span ref={barRef} style={{ width: `${initialBar}%` }} />
          </span>
          <p class="rs-deg__next" ref={nextRef}>
            {nextLine(animate && !entered ? was : now)}
          </p>
        </div>
      </div>
      {up && (
        <p class="rs-deg__up" role="status">
          ランクアップ！
        </p>
      )}
    </section>
  );
}
