import { gsap } from 'gsap';
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../audio';
import { fx } from '../fx';
import { motionReduced } from '../fx/motion';
import { Button } from '../ui/Button';
import { route, transitioning, type Route, type SceneProps, goto } from './router';
import { SCENES } from './scenes';
import './shell.css';

function ErrorScene({ params }: SceneProps) {
  return (
    <section class="scene center">
      <div class="scene-error">
        <p class="eyebrow">LOAD ERROR</p>
        <h1 class="t-display t-xl">画面を読み込めませんでした</h1>
        <p class="t-sm t-bone2">通信状況を確かめて、もう一度お試しください。</p>
        <div class="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <Button onClick={() => location.reload()} icon="refresh">
            再読み込み
          </Button>
          <Button variant="ghost" onClick={() => goto('title')} icon="back" sfx="cancel">
            タイトルへ
          </Button>
        </div>
        <p class="t-2xs t-muted t-mono">{JSON.stringify(params)}</p>
      </div>
    </section>
  );
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const routeKey = (r: Route) => `${r.scene}:${JSON.stringify(r.params)}`;

/** Renders the current scene with a diagonal shutter transition (≤ 600 ms; crossfade with reduced motion). */
export function SceneHost() {
  const [view, setView] = useState<{ key: string; route: Route; Comp: ComponentType<SceneProps> } | null>(null);
  const shutter = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState({ jp: '', en: '' });
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    let token = 0;
    let hasView = false;
    const cover = () =>
      new Promise<void>((resolve) => {
        const el = shutter.current;
        if (!el) return resolve();
        const panels = el.querySelectorAll('.shutter__panel');
        gsap.killTweensOf(panels);
        gsap.set(el, { visibility: 'visible' });
        if (motionReduced()) {
          gsap.set(panels, { xPercent: 0, skewX: -14 });
          gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.16, onComplete: resolve });
          return;
        }
        gsap.set(el, { opacity: 1 });
        audio.sfx('whoosh');
        gsap.fromTo(panels, { xPercent: 84, skewX: -14 }, { xPercent: 0, skewX: -14, duration: 0.2, ease: 'power3.in', stagger: 0.04, onComplete: () => resolve() });
      });
    const reveal = () =>
      new Promise<void>((resolve) => {
        const el = shutter.current;
        if (!el) return resolve();
        const panels = el.querySelectorAll('.shutter__panel');
        const done = () => {
          gsap.set(el, { visibility: 'hidden' });
          resolve();
        };
        if (motionReduced()) {
          gsap.to(el, { opacity: 0, duration: 0.2, onComplete: done });
          return;
        }
        gsap.to([...panels].reverse(), { xPercent: -84, duration: 0.22, ease: 'power3.out', stagger: 0.04, onComplete: done });
      });

    const run = async (r: Route) => {
      const my = ++token;
      const def = SCENES[r.scene];
      transitioning.value = true;
      setLabel({ jp: def.label, en: r.scene.toUpperCase() });
      const load = def.load().catch(() => ErrorScene as ComponentType<SceneProps>);
      const [Comp] = await Promise.all([load, hasView ? cover() : Promise.resolve()]);
      if (my !== token) return;
      fx.reset();
      hasView = true;
      setView({ key: routeKey(r), route: r, Comp });
      if (def.bgm) audio.bgm(def.bgm);
      if (def.backdrop) fx.setBackdrop(def.backdrop);
      await nextFrame();
      if (my !== token) return;
      const w = wrap.current;
      // Don't steal focus if the new scene already placed it somewhere inside itself.
      if (w && !(w.contains(document.activeElement) && document.activeElement !== w)) {
        const auto = w.querySelector<HTMLElement>('[data-autofocus]');
        (auto ?? w).focus({ preventScroll: true });
      }
      setAnnounce(def.label);
      await reveal();
      if (my === token) transitioning.value = false;
    };
    run(route.peek());
    let last = routeKey(route.peek());
    return route.subscribe((r) => {
      const k = routeKey(r);
      if (k === last) return;
      last = k;
      run(r);
    });
  }, []);

  return (
    <>
      {view && (
        <div ref={wrap} key={view.key} class="scene-wrap" tabIndex={-1} data-scene={view.route.scene} aria-label={SCENES[view.route.scene].label}>
          <view.Comp params={view.route.params} />
        </div>
      )}
      <div ref={shutter} class="shutter" aria-hidden="true">
        <div class="shutter__panel shutter__panel--a" />
        <div class="shutter__panel shutter__panel--b" />
        <div class="shutter__panel shutter__panel--c">
          <div class="shutter__label">
            <span class="shutter__en">{label.en}</span>
            <span class="shutter__jp">{label.jp}</span>
          </div>
        </div>
      </div>
      <p class="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  );
}
