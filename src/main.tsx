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
import { preloadCoreArt } from './lib/asset';
import { DEBUG } from './lib/env';
import { initViewport } from './lib/viewport';
import { initSave } from './state/save';

// Fonts: loaded as a separate (non render-blocking) stylesheet chunk; the boot splash in
// index.html stays until the logo face is ready (or 2.5 s at most).
const fontsCss = import('./styles/fonts.css');

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

async function waitFonts() {
  try {
    await fontsCss;
    await Promise.race([
      Promise.all([
        document.fonts.load('400 64px "Dela Gothic One"', APP_CONFIG.GAME_TITLE),
        document.fonts.load('500 16px "Zen Kaku Gothic New"', 'あア亜'),
        document.fonts.load('400 32px "Anton"', 'CASE'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

function boot() {
  initSave();
  initViewport();
  initRouter();
  bindAudioSettings();
  applyDocumentMeta();
  preloadCoreArt();
  if (DEBUG) installDebug();
  const root = document.getElementById('app')!;
  waitFonts().then(() => {
    render(<App />, root);
    requestAnimationFrame(() => document.documentElement.classList.add('app-ready'));
    // bold UI + Jane's mincho: not needed for the first paint
    setTimeout(() => void import('./styles/fonts-extra.css'), 60);
  });
}

boot();
