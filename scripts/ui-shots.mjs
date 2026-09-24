// UI screenshots for visual review (frontend foundation).
//   node scripts/ui-shots.mjs            → builds if dist/ is missing, serves with vite preview :4191
//                                          (NOT 4190: browsers refuse that port — it is on the fetch "bad ports" list)
//   node scripts/ui-shots.mjs --dev      → dev server on :5190 (reused if one answers, else started
//                                          here with --strictPort and stopped at the end)
//   --port 5194                          → use this port instead (dev or preview)
//   node scripts/ui-shots.mjs --no-build → never builds (dist must exist)
//   --only layout                        → just the title / files layout matrix (fast)
// Output: qa/ui/<scene>-<size>.png, plus a console summary. Exit code 1 on page errors,
// horizontal overflow, or title-menu items covered by the Holma badge / footer / logo at any
// size of the layout matrix (1280×720 … 320×568). Type-floor offenders (text < 11px, Dela
// Gothic One < 16px) are listed as warnings. Headless Chromium + SwiftShader WebGL so the
// backdrop shader renders.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const args = new Set(argv);
const argVal = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const DEV = args.has('--dev');
const ONLY = argVal('--only');
const out = resolve(root, 'qa', 'ui');
mkdirSync(out, { recursive: true });

const PORT = Number(argVal('--port') || (DEV ? 5190 : process.env.UI_SHOTS_PORT || 4191));
const BASE = `http://127.0.0.1:${PORT}/`;
const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');

let server = null;
if (DEV) {
  let running = false;
  try {
    running = (await fetch(BASE)).ok;
  } catch {}
  if (!running) {
    server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stderr.on('data', (d) => process.stderr.write(`[dev] ${d}`));
  }
} else {
  if (!existsSync(resolve(root, 'dist', 'index.html')) && !args.has('--no-build')) {
    console.log('[ui-shots] building…');
    const b = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit' });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
}
let up = false;
for (let i = 0; i < 600; i++) { // up to 150 s: a cold dev server on a busy machine is slow
  try {
    if ((await fetch(BASE)).ok) {
      up = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!up) {
  console.error(`[ui-shots] server not reachable at ${BASE}`);
  server?.kill();
  process.exit(1);
}

const SIZES = [
  { tag: 'pc', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { tag: 'sp', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const problems = [];
const warnings = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Type floor (bible §4-2): text under 11px, or Dela Gothic One under 16px. Warnings only. */
async function typeAudit(page, label) {
  const found = await page.evaluate(() => {
    const res = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const name = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}`;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const text = n.textContent.trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || seen.has(el) || el.closest('rt, .sr-only, #boot, noscript, .seo-fallback')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const fs = parseFloat(cs.fontSize);
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (fs < 10.95) res.push(`${fs.toFixed(1)}px ${name(el)} 「${text.slice(0, 14)}」`);
      else if (fam === 'Dela Gothic One' && fs < 15.95) res.push(`Dela ${fs.toFixed(1)}px ${name(el)} 「${text.slice(0, 14)}」`);
    }
    return res;
  });
  for (const f of found) warnings.set(f, label);
}

/**
 * Title-menu layout: no menu item may be covered by the Holma badge / bubble, the footer, the
 * top bar or the logo; on wide layouts the logo must not start above the viewport and the
 * title must fit without scrolling.
 */
async function titleLayoutCheck(page, label) {
  const bad = await page.evaluate(() => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const hit = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    const items = [...document.querySelectorAll('.menu__item')].map((e) => ({ e, r: rect(e) }));
    const others = ['.holma-badge', '.holma-bubble', '.title__foot', '.title__top', '.logo'].flatMap((sel) => [...document.querySelectorAll(sel)].map((e) => ({ sel, r: rect(e) })));
    const res = [];
    for (const it of items) {
      for (const o of others) {
        const a = hit(it.r, o.r);
        if (a > 40) res.push(`menu「${it.e.querySelector('.menu__jp')?.textContent}」 × ${o.sel} (${Math.round(a)}px²)`);
      }
    }
    const wide = !!document.querySelector('#app[data-layout="wide"]');
    const logo = document.querySelector('.logo');
    if (wide && logo && logo.getBoundingClientRect().top < -2) res.push(`logo starts above the viewport (${Math.round(logo.getBoundingClientRect().top)}px)`);
    const title = document.querySelector('.title');
    if (wide && title && title.scrollHeight > title.clientHeight + 2) res.push(`wide title needs scrolling (${title.scrollHeight}>${title.clientHeight})`);
    return res;
  });
  for (const b of bad) problems.push(`${label}: ${b}`);
}

const LAYOUT_SIZES = [
  { tag: 'pc1280', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { tag: 'pc1366', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  { tag: 'pc1920', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  { tag: 'sp390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { tag: 'sp360', viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { tag: 'sp320', viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { tag: 'sp320s', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

/** Title / files / overlays at every size of LAYOUT_SIZES (fresh save, resumable, completed). */
async function layoutMatrix(browser) {
  for (const size of LAYOUT_SIZES) {
    const { tag, ...ctxOpts } = size;
    const ctx = await browser.newContext({ ...ctxOpts, locale: 'ja-JP', reducedMotion: 'reduce' });
    ctx.setDefaultTimeout(120000); // a cold dev server compiles every module on the first load
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
    await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await wait(600);
    await shot(page, `L-${tag}-title-gate`);
    await page.keyboard.press('Space');
    await wait(900);
    await titleLayoutCheck(page, `${tag} title menu`);
    await overflowCheck(page, `${tag} title menu`);
    await typeAudit(page, `${tag} title`);
    await shot(page, `L-${tag}-title-menu`);
    // continue variant: 6 items, 続きから first and primary
    await page.evaluate(() => {
      const J = window.__JD;
      J.setMeta({ prologueSeen: true, lastCaseId: 'c02-ball-at-dusk' });
      J.updateCase('c02-ball-at-dusk', { stage: 'investigation' });
      J.flushSave();
    });
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await wait(500);
    await page.keyboard.press('Space');
    await wait(900);
    const first = await page.evaluate(() => document.querySelector('.menu__item')?.dataset.id);
    if (first !== 'continue') problems.push(`${tag}: 続きから is not the first menu item (${first})`);
    await titleLayoutCheck(page, `${tag} title continue`);
    await shot(page, `L-${tag}-title-continue`);
    // files: first-visit tip, then a completed case with its restored name (fictional placeholder)
    await page.evaluate(() => {
      const J = window.__JD;
      J.updateCase('c02-ball-at-dusk', { stage: 'new' });
      J.goto('files');
    });
    await page.evaluate(() => window.__JD.idle());
    await wait(800);
    await overflowCheck(page, `${tag} files`);
    await typeAudit(page, `${tag} files`);
    await shot(page, `L-${tag}-files`);
    await page.evaluate(() => {
      window.__JD.updateCase('c01-room-without-breath', {
        stage: 'complete',
        completed: true,
        clears: 1,
        bestRank: 'S',
        lastResult: { rank: 'S', title: '見本', at: Date.now(), elapsedMs: 600000, stats: {} },
        restored: { name: '見本 灯子', kana: 'みほん とうこ' },
      });
    });
    await wait(500);
    await shot(page, `L-${tag}-files-after`);
    // how-to: the pager must stay on screen
    await page.evaluate(() => window.__JD.openOverlay('howto'));
    await wait(600);
    const howto = await page.evaluate(() => {
      const f = document.querySelector('.modal__foot')?.getBoundingClientRect();
      return f ? { bottom: Math.round(f.bottom), vh: innerHeight } : null;
    });
    if (!howto || howto.bottom > howto.vh + 1) problems.push(`${tag}: HowTo footer (pager) is off-screen ${JSON.stringify(howto)}`);
    await typeAudit(page, `${tag} howto`);
    await shot(page, `L-${tag}-howto`);
    await page.evaluate(() => window.__JD.closeOverlay());
    await wait(400);
    // settings: initial focus must be visible
    await page.evaluate(() => window.__JD.openOverlay('settings'));
    await wait(600);
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      const r = a?.getBoundingClientRect();
      return a ? { name: a.getAttribute('aria-label') || a.textContent?.trim().slice(0, 20), inView: !!r && r.top >= 0 && r.bottom <= innerHeight } : null;
    });
    if (!focus?.inView) problems.push(`${tag}: settings opens with focus off-screen ${JSON.stringify(focus)}`);
    await shot(page, `L-${tag}-settings`);
    await ctx.close();
  }
}

async function ready(page) {
  await page.waitForFunction(() => window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 30000 });
  await page.evaluate(() => window.__JD.idle());
}
async function overflowCheck(page, label) {
  const o = await page.evaluate(() => {
    // Anything the user could scroll sideways: the viewport itself, or a scroll container
    // whose overflow-x is not hidden/clip.
    const vw = window.innerWidth;
    const out = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.page, .scene, .modal__body, .sl__bottom, .sheet__body')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) out.push(`${e.className} ${e.scrollWidth}>${e.clientWidth}`);
      // content clipped by overflow-x:hidden (tolerate a few px of tilted cards)
      else if (e.scrollWidth > e.clientWidth + 6) out.push(`clipped: ${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    }
    return out;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  await layoutMatrix(browser);
  if (ONLY !== 'layout') for (const size of SIZES) {
    const { tag, ...ctxOpts } = size;
    console.log(`[ui-shots] ${tag} ${ctxOpts.viewport.width}x${ctxOpts.viewport.height}`);
    const ctx = await browser.newContext({ ...ctxOpts, locale: 'ja-JP', reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`);
    });
    await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await wait(1600);
    await shot(page, `title-gate-${tag}`);

    // enter → menu
    await page.mouse.click(ctxOpts.viewport.width / 2, ctxOpts.viewport.height / 2);
    await wait(1400);
    await overflowCheck(page, `${tag} title`);
    await shot(page, `title-${tag}`);

    // prologue (first play)
    await page.click('.menu__item.is-primary');
    await page.evaluate(() => window.__JD.idle());
    await wait(500);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__JD.skipText());
      await wait(120);
      await page.keyboard.press('Enter');
      await wait(700);
    }
    await wait(1500);
    await shot(page, `prologue-${tag}`);
    // a Jane line (shard silhouette + mincho + glitch), started mid-script via the debug param
    await page.evaluate(() => {
      const lines = window.__JD.prologue.lines;
      const k = lines.findIndex((l) => l.speaker === 'jane');
      window.__JD.goto('prologue', { line: String(Math.max(0, k)) });
    });
    await page.evaluate(() => window.__JD.idle());
    await wait(1800);
    await page.evaluate(() => window.__JD.skipText());
    await wait(300);
    await shot(page, `prologue-jane-${tag}`);

    // files
    await page.evaluate(() => window.__JD.goto('files'));
    await page.evaluate(() => window.__JD.idle());
    await wait(1400);
    await overflowCheck(page, `${tag} files`);
    await shot(page, `files-${tag}`);
    if (tag === 'sp') {
      await page.evaluate(() => document.querySelector('.page')?.scrollBy(0, 700));
      await wait(500);
      await shot(page, `files-scrolled-${tag}`);
    }

    // settings
    await page.evaluate(() => window.__JD.openOverlay('settings'));
    await wait(900);
    await overflowCheck(page, `${tag} settings`);
    await shot(page, `settings-${tag}`);
    await page.evaluate(() => window.__JD.closeOverlay());
    await wait(500);

    // how to play
    await page.evaluate(() => window.__JD.openOverlay('howto'));
    await wait(900);
    await overflowCheck(page, `${tag} howto`);
    await shot(page, `howto-${tag}`);
    for (const step of [2, 4]) {
      await page.evaluate((n) => document.querySelectorAll('.howto-dot')[n]?.click(), step);
      await wait(700);
      await shot(page, `howto-${step + 1}-${tag}`);
    }
    await page.evaluate(() => window.__JD.closeOverlay());
    await wait(500);

    // credits
    await page.evaluate(() => window.__JD.openOverlay('credits'));
    await wait(800);
    await shot(page, `credits-${tag}`);
    await page.evaluate(() => window.__JD.closeOverlay());
    await wait(400);

    // fx sampler: stamp + cut-in on the files screen
    await page.evaluate(() => {
      window.__JD.fx.stamp('yes');
    });
    await wait(800);
    await shot(page, `fx-stamp-${tag}`);
    await wait(1000);
    await page.evaluate(() => {
      window.__JD.fx.cutIn({ text: '反証！', en: 'REFUTATION', tone: 'alarm', character: 'holma', mood: 'laugh' });
    });
    await wait(520);
    await shot(page, `fx-cutin-${tag}`);
    await wait(1500);

    // dev UI gallery (component catalogue in a sheet)
    await page.evaluate(() => window.__JD.gallery());
    await wait(1300);
    await overflowCheck(page, `${tag} gallery`);
    await shot(page, `gallery-${tag}`);
    for (const [k, y] of [[2, 900], [3, 1800], [4, 2700]]) {
      await page.evaluate((dy) => document.querySelector('.sheet__body')?.scrollTo(0, dy), y);
      await wait(500);
      await shot(page, `gallery-${k}-${tag}`);
    }
    await page.evaluate(() => window.__JD.closeOverlay());
    await wait(500);

    // placeholder scene
    await page.evaluate(() => window.__JD.goto('investigation', { caseId: 'c01-room-without-breath' }));
    await page.evaluate(() => window.__JD.idle());
    await wait(600);
    await shot(page, `placeholder-${tag}`);

    if (tag === 'pc') {
      // audio smoke: every BGM + every SFX must run without throwing (output is muted)
      const res = await page.evaluate(async () => {
        const jd = window.__JD;
        await jd.audio.unlock();
        const w = (ms) => new Promise((r) => setTimeout(r, ms));
        for (const id of ['title', 'investigation', 'inquest', 'truth', 'science']) {
          jd.audio.bgm(id, 0.2);
          await w(700);
        }
        for (const n of ['hover', 'confirm', 'cancel', 'error', 'stamp', 'finding', 'findingCore', 'shatter', 'whoosh', 'cutin', 'gavel', 'heartbeat', 'page', 'open', 'close', 'toggle', 'refute', 'reveal', 'send']) {
          jd.audio.sfx(n, { answerClass: 'yes' });
          await w(40);
        }
        for (const s of ['holma', 'jane', 'narration', 'system']) {
          jd.audio.blip(s);
          await w(60);
        }
        jd.fx.shatter(700, 400);
        jd.fx.pulse('alarm');
        await w(300);
        jd.audio.bgm('none');
        return jd.getState();
      });
      console.log(`  audio unlocked=${res.audio.unlocked} backdrop=${res.backdrop}`);
      if (!res.audio.unlocked) problems.push('audio did not unlock');
    }
    await ctx.close();
  }

  // 320px: no horizontal scroll on title / files
  if (ONLY !== 'layout') {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`320 pageerror: ${e.message}`));
    await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load' });
    await ready(page);
    await page.mouse.click(160, 320);
    await wait(1200);
    await overflowCheck(page, '320 title');
    await shot(page, 'title-320');
    await page.evaluate(() => window.__JD.goto('files'));
    await page.evaluate(() => window.__JD.idle());
    await wait(1200);
    await overflowCheck(page, '320 files');
    await shot(page, 'files-320');
    await ctx.close();
  }

  // reduced motion + largest font scale on a phone: no errors, no horizontal overflow
  if (ONLY !== 'layout') {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`rm pageerror: ${e.message}`));
    await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    const rm = await page.evaluate(() => window.__JD.getState().save.settings.reduceMotion);
    if (!rm) problems.push('reduceMotion did not default from prefers-reduced-motion');
    await page.evaluate(() => window.__JD.setSettings({ fontScale: 130 }));
    await page.mouse.click(195, 420);
    await wait(900);
    await overflowCheck(page, 'rm+130 title');
    await shot(page, 'title-rm130-sp');
    await page.evaluate(() => window.__JD.goto('files'));
    await page.evaluate(() => window.__JD.idle());
    await wait(600);
    await overflowCheck(page, 'rm+130 files');
    await shot(page, 'files-rm130-sp');
    await page.evaluate(() => window.__JD.goto('prologue'));
    await page.evaluate(() => window.__JD.idle());
    await wait(600);
    await overflowCheck(page, 'rm+130 prologue');
    await shot(page, 'prologue-rm130-sp');
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

if (warnings.size) {
  console.log(`\n[ui-shots] type-floor warnings (${warnings.size}; text < 11px or Dela Gothic One < 16px):`);
  for (const [w, where] of warnings) console.log(`  ! ${where}: ${w}`);
}
if (problems.length) {
  console.log('\n[ui-shots] problems:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\n[ui-shots] OK — screenshots in qa/ui/');
