/** 集中力 0 → 審問中断. Findings are kept; the player returns to the investigation. */
import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { motionReduced } from '../../fx/motion';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { PenaltyTag } from '../rank/Badge';

export function SuspendedOverlay({ line, mood, penalty = 0, onBack }: { line: string; mood: 'normal' | 'laugh' | 'surprised' | 'serious'; penalty?: number; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tl = gsap.timeline();
    if (motionReduced()) tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    else
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25 })
        .fromTo(el.querySelector('.susp__band'), { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: 'power3.out' }, 0.1)
        .fromTo(el.querySelector('.susp__title'), { xPercent: 30, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, 0.2)
        .fromTo(el.querySelector('.susp__card'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.5);
    return () => tl.kill();
  }, []);
  return (
    <div ref={ref} class="susp" role="alertdialog" aria-modal="true" aria-labelledby="susp-title" aria-describedby="susp-desc">
      <div class="susp__band" aria-hidden="true">
        <div class="susp__stripes" />
      </div>
      <h2 id="susp-title" class="susp__title">
        審問中断<span>SUSPENDED</span>
      </h2>
      <div class="susp__card">
        <div class="susp__holma" aria-hidden="true">
          <HolmaSprite mood={mood} framing="bust" />
        </div>
        <div class="susp__body">
          <p class="susp__line">{line}</p>
          <p id="susp-desc" class="susp__desc">
            集中力が尽きました。集めた所見は失われません。捜査で質問を重ねてから、もう一度審問を開きましょう。
          </p>
          {penalty > 0 && (
            <p class="susp__pen">
              <PenaltyTag points={penalty} label="審問の中断" />
            </p>
          )}
          <Button variant="primary" size="lg" icon="back" en="BACK TO INVESTIGATION" onClick={onBack} data-autofocus data-suspend-back>
            捜査に戻る
          </Button>
        </div>
      </div>
    </div>
  );
}
