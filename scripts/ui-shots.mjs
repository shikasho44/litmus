// UI screenshots for visual review (frontend foundation).
//   node scripts/ui-shots.mjs            → builds if dist/ is missing, serves with vite preview :4191
//                                          (NOT 4190: browsers refuse that port — it is on the fetch "bad ports" list)
//   node scripts/ui-shots.mjs --dev      → uses a running dev server on :5190 (npm run dev)
//   node scripts/ui-shots.mjs --no-build → never builds (dist must exist)
// Output: qa/ui/<scene>-<size>.png, plus a console summary. Exit code 1 on page errors or
// horizontal overflow. Headless Chromium + SwiftShader WebGL so the backdrop shader renders.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev');
const out = resolve(root, 'qa', 'ui');
mkdirSync(out, { recursive: true });

const PORT = DEV ? 5190 : Number(process.env.UI_SHOTS_PORT || 4191);
const BASE = `http://127.0.0.1:${PORT}/`;
const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');

let server = null;
if (!DEV) {
  if (!existsSync(resolve(root, 'dist', 'index.html')) && !args.has('--no-build')) {
    console.log('[ui-shots] building…');
    const b = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit' });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
}
let up = false;
for (let i = 0; i < 120; i++) {
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (const size of SIZES) {
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
  {
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
  {
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

if (problems.length) {
  console.log('\n[ui-shots] problems:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\n[ui-shots] OK — screenshots in qa/ui/');
