import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import './styles/typography.css';
import './styles/utilities.css';
import { App } from './app/App';
import { installDebug } from './app/debug';
import { initRouter } from './app/router';
import { bindAudioSettings } from './audio';
import { APP_CONFIG } from './config/app';
import { ART, probeImage } from './lib/asset';
import { DEBUG } from './lib/env';
import { initViewport } from './lib/viewport';
import { initSave } from './state/save';

// Fonts: the full stylesheet is a separate (non render-blocking) chunk. The faces the first
// paint needs (logo subsets, Zen Kaku kana, Anton Latin) are declared inline in index.html, so
// the boot wait below does not depend on that ≈100 KB (gz) chunk arriving first.
const fontsCss = import('./styles/fonts.css');

/** The boot splash never outlives this, counted from navigation start… */
const BOOT_CAP_MS = 2500;
/** …except that once this script runs, the critical faces always get this long. */
const FONT_GRACE_MS = 700;

function applyDocumentMeta() {
  document.title = APP_CONFIG.OFFICIAL_RELEASE_ENABLED ? APP_CONFIG.APP_TITLE : `${APP_CONFIG.APP_TITLE}（PREVIEW）`;
  // Runtime safety net for crawlers that execute JS: noindex until the official release.
  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!APP_CONFIG.OFFICIAL_RELEASE_ENABLED) {
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
  } else if (robots && /noindex/.test(robots.content)) {
    robots.remove();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Hold the boot splash until the critical faces are in. On a fast link that is also when
 * fonts.css has arrived, so the first paint is unchanged; on a slow one the cap (measured from
 * navigation start, not from when fonts.css lands) wins and the rest swaps in (font-display).
 */
async function waitFonts() {
  const budget = Math.max(BOOT_CAP_MS - performance.now(), FONT_GRACE_MS);
  try {
    await Promise.race([
      Promise.all([
        fontsCss,
        document.fonts.load('400 64px "Dela Gothic One"', APP_CONFIG.GAME_TITLE),
        document.fonts.load('500 16px "Zen Kaku Gothic New"', 'あア'),
        document.fonts.load('400 32px "Anton"', 'CASE'),
      ]),
      sleep(budget),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

const idle = (fn: () => void) =>
  typeof window.requestIdleCallback === 'function' ? void window.requestIdleCallback(() => fn(), { timeout: 1500 }) : void setTimeout(fn, 300);

/**
 * Art warm-up, staged so nothing competes with the first paint on slow links. The title only
 * needs the key art (index.html preloads it at high priority). The second stylesheet waits for
 * it (or 1.2 s), and the prologue's room + Holma's four expressions (≈1.2 MB) are fetched once
 * the title is on screen, the key art is in and the main thread is idle.
 */
function warmArt(rendered: Promise<void>) {
  const keyArt = probeImage(ART.keyArt);
  // bold UI + Jane's mincho: not needed for the first paint
  void rendered
    .then(() => Promise.race([keyArt, sleep(1200)]))
    .then(() => import('./styles/fonts-extra.css'))
    .catch(() => {});
  void Promise.all([rendered, keyArt]).then(() =>
    idle(() => {
      for (const p of [ART.roomZero, ART.holma('normal'), ART.holma('laugh'), ART.holma('surprised'), ART.holma('serious')]) void probeImage(p);
    }),
  );
}

function boot() {
  initSave();
  initViewport();
  initRouter();
  bindAudioSettings();
  applyDocumentMeta();
  if (DEBUG) installDebug();
  const root = document.getElementById('app')!;
  const rendered = waitFonts().then(() => {
    render(<App />, root);
    requestAnimationFrame(() => document.documentElement.classList.add('app-ready'));
  });
  warmArt(rendered);
}

boot();
