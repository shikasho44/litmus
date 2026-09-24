/**
 * Viewport sync. The app root (#app) is sized to the *visual* viewport so that on phones
 * the input bar is never hidden by the on-screen keyboard or iOS toolbars.
 *
 * CSS variables on :root
 *   --vvh     visual viewport height (px)
 *   --vv-top  visual viewport offsetTop (px)
 *   --kb      estimated on-screen keyboard height (px, 0 when closed)
 * Attributes on #app
 *   data-layout="wide" | "narrow"     (narrow = phone portrait / small windows)
 *   data-kb="open" | "closed"
 */
import { signal } from '@preact/signals';

export type Layout = 'wide' | 'narrow';
export const layout = signal<Layout>('wide');
export const keyboardOpen = signal(false);
export const viewportSize = signal({ w: 1280, h: 720 });

function computeLayout(w: number, h: number): Layout {
  if (w < 760) return 'narrow';
  if (w < 1024 && h > w) return 'narrow';
  return 'wide';
}

let raf = 0;
function sync() {
  raf = 0;
  const root = document.documentElement;
  const app = document.getElementById('app');
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  const kb = Math.max(0, window.innerHeight - h - top);
  root.style.setProperty('--vvh', `${Math.round(h)}px`);
  root.style.setProperty('--vv-top', `${Math.round(top)}px`);
  root.style.setProperty('--kb', `${Math.round(kb)}px`);
  const l = computeLayout(window.innerWidth, window.innerHeight);
  const kbOpen = kb > 120;
  if (layout.value !== l) layout.value = l;
  if (keyboardOpen.value !== kbOpen) keyboardOpen.value = kbOpen;
  viewportSize.value = { w: Math.round(w), h: Math.round(h) };
  if (app) {
    app.dataset.layout = l;
    app.dataset.kb = kbOpen ? 'open' : 'closed';
  }
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(sync);
}

export function initViewport() {
  sync();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  // iOS sometimes scrolls the layout viewport when focusing inputs; pin it back.
  window.addEventListener(
    'scroll',
    () => {
      if (window.scrollY !== 0 && !document.activeElement?.matches('input, textarea')) window.scrollTo(0, 0);
    },
    { passive: true },
  );
}
