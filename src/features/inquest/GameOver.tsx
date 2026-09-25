/**
 * GAME OVER — Jane's last light went out. The mystery stays unsolved: her glass silhouette
 * dims shard by shard and fades away, Holma speaks seriously, then back to the title.
 * The restart rule has already been written to the save by InquestSession.applyGameOver.
 * Reduced motion: plain fades, no drifting.
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../../../shared/api';
import { motionReduced } from '../../fx/motion';
import { layout } from '../../lib/viewport';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { DIFFICULTY_META } from '../difficulty/meta';

export const GAME_OVER_LINE = '……謎は、謎のまま。彼女は、名前を持たずに消えていきました。';

export function GameOverOverlay({
  caseId,
  image,
  revealed,
  difficulty,
  outcome,
  onTitle,
}: {
  caseId: string;
  image?: string;
  revealed: number;
  difficulty: Difficulty;
  /** null while the restart rule is being applied (a new token is fetched for normal/hard). */
  outcome: 'inquest' | 'restart' | null;
  onTitle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const d = DIFFICULTY_META[difficulty];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const q = (s: string) => el.querySelectorAll(s);
    const tl = gsap.timeline({ onComplete: () => setReady(true) });
    if (motionReduced()) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.4 })
        .fromTo(q('.gover__jane'), { opacity: 0.5 }, { opacity: 0.12, duration: 0.8 }, 0.2)
        .fromTo(q('.gover__title, .gover__card'), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.3);
      return () => tl.kill();
    }
    const edges = [...el.querySelectorAll<SVGElement>('.gover__jane .shards__edges polygon, .gover__jane .shards__piece')];
    // her lights go out one by one, in no particular order
    const order = edges.map((e, i) => ({ e, k: (i * 7919) % 97 })).sort((a, b) => a.k - b.k).map((x) => x.e);
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: 'power1.out' })
      .fromTo(q('.gover__jane'), { opacity: 0, scale: 1.02 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' }, 0.2)
      .to(order, { opacity: 0.05, duration: 0.5, stagger: { each: 2.2 / Math.max(1, order.length) }, ease: 'power1.in' }, 1.1)
      .to(q('.gover__jane'), { filter: 'brightness(0.35) saturate(0.2) blur(1px)', duration: 2.2, ease: 'none' }, 1.1)
      .to(q('.gover__jane'), { y: -26, opacity: 0, filter: 'brightness(0.1) saturate(0) blur(7px)', duration: 1.9, ease: 'power2.in' }, 3.3)
      .fromTo(q('.gover__title'), { opacity: 0, y: 14, letterSpacing: '0.5em' }, { opacity: 1, y: 0, letterSpacing: '0.18em', duration: 1.6, ease: 'power2.out' }, 1.4)
      .fromTo(q('.gover__card'), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 3.0);
    return () => tl.kill();
  }, []);

  // the only way out takes the focus once it is there
  useEffect(() => {
    if (!ready || !outcome) return;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-gameover-title]')?.focus({ preventScroll: true }), 40);
    return () => clearTimeout(t);
  }, [ready, outcome]);

  return (
    <div ref={ref} class="gover" role="alertdialog" aria-modal="true" aria-labelledby="gover-title" aria-describedby="gover-desc" data-gameover={outcome ?? 'pending'}>
      <div class="gover__vignette" aria-hidden="true" />
      <div class="gover__jane" aria-hidden="true">
        <ShardPortrait image={image} revealed={revealed} seed={caseId} shardCount={34} label="ジェーン・ドゥ" />
      </div>
      <h2 id="gover-title" class="gover__title">
        <span class="gover__jp">未解決</span>
        <span class="gover__en">UNSOLVED — GAME OVER</span>
      </h2>
      <div class="gover__card">
        <div class="gover__holma" aria-hidden="true">
          <HolmaSprite mood="serious" framing="bust" idle={false} />
        </div>
        <div class="gover__body">
          <p class="gover__name">ホルマ</p>
          <p class="gover__line">{GAME_OVER_LINE}</p>
          <p id="gover-desc" class="gover__desc">
            やり直しの灯が、すべて消えました。
            {outcome === 'inquest'
              ? `捜査の記録は残っています。次は審問の最初から——灯はまた${d.lives}つ灯ります。`
              : outcome === 'restart'
                ? 'この事件は、最初からやり直しになります。ほかの事件の記録は、そのまま残っています。'
                : '記録を整えています……'}
          </p>
          <Button variant="primary" size={layout.value === 'narrow' ? 'md' : 'lg'} icon="back" en={layout.value === 'narrow' ? undefined : 'BACK TO TITLE'} onClick={onTitle} disabled={!outcome} data-gameover-title>
            タイトルへ
          </Button>
        </div>
      </div>
    </div>
  );
}
