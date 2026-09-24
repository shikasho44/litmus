// Screenshots for the ending scenes (Resolution → Science → Quiz → Result).
//
//   node scripts/shots-ending.mjs                       all 3 cases × pc + sp
//   node scripts/shots-ending.mjs --case c02            one case (prefix match)
//   node scripts/shots-ending.mjs --only science        one part: resolution | science | quiz | result
//   node scripts/shots-ending.mjs --size sp             one size: pc | sp | xs (320×640, not in the default run)
//   node scripts/shots-ending.mjs --reduced             reduced motion
//
// Uses a dev server on :5193 (started here with HMR off if nothing answers; closed at the end).
// Each case is jumped to the 'reconstructed' stage with POST /api/admin/mint-token and a
// synthetic save (question log, inquest counters) is seeded so the result screen has stats.
// Output: qa/ending/<case>-<size>-<shot>.png. Exit 1 on page errors / console errors /
// horizontal overflow.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = arg('only');
const CASE = arg('case');
const SIZE = arg('size');
const REDUCED = argv.includes('--reduced');
const PORT = Number(process.env.ENDING_PORT || 5193);
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'ending');
mkdirSync(out, { recursive: true });

const CASES = ['c01-room-without-breath', 'c02-ball-at-dusk', 'c03-shed-in-snow'].filter((c) => !CASE || c.startsWith(CASE));
const SIZES = [
  { tag: 'pc', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { tag: 'sp', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { tag: 'xs', viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
].filter((s) => (SIZE ? s.tag === SIZE : s.tag !== 'xs'));
const want = (part) => !ONLY || ONLY.split(',').includes(part);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function reachable() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}

// Our own Vite dev server (JS API) with HMR off, so edits by other builders (or bench
// reports landing in the tree) never reload the page in the middle of a capture.
let server = null;
if (!(await reachable())) {
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: resolve(root, 'vite.config.ts'),
    root,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  for (let i = 0; i < 120 && !(await reachable()); i++) await wait(250);
  if (!(await reachable())) {
    console.error(`[ending] dev server not reachable at ${BASE}`);
    await server.close();
    process.exit(1);
  }
}

const problems = [];

async function shot(page, name) {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
}
async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.page, .scene')) {
      if (e.scrollWidth > e.clientWidth + 6) res.push(`${e.className.split(' ').slice(0, 3).join('.')} ${e.scrollWidth}>${e.clientWidth}`);
    }
    if (res.length) {
      // name the outermost elements that stick out on the right
      const culprits = [];
      for (const el of document.querySelectorAll('.page *')) {
        const r = el.getBoundingClientRect();
        const pr = el.parentElement?.getBoundingClientRect();
        if (r.width && r.right > vw + 2 && pr && pr.right <= vw + 2) culprits.push(`<${el.tagName.toLowerCase()} class="${String(el.className?.baseVal ?? el.className).slice(0, 40)}"> right=${Math.round(r.right)}`);
        if (culprits.length >= 4) break;
      }
      if (culprits.length) res.push(`culprits: ${culprits.join(' | ')}`);
    }
    return res;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}
const idle = (page) => page.evaluate(() => window.__JD.idle());

/** Mint a token at the given stage and seed a plausible save for the case. */
async function seed(page, caseId, stage = 'reconstructed') {
  await page.evaluate(
    async ({ caseId, stage }) => {
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage }) });
      const { token, progress } = await r.json();
      const n = Number(caseId.slice(1, 3));
      const log = [];
      const qs = 18 + n * 6;
      for (let i = 0; i < qs; i++) {
        log.push({ kind: 'question', text: `質問${i + 1}` });
        log.push({ kind: 'answer', question: `質問${i + 1}`, answerClass: i % 3 ? 'no' : 'yes', line: '……', mood: 'normal', unlocked: i % 5 < 2 ? [`F${String(i + 1).padStart(2, '0')}`] : [], memos: [] });
      }
      window.__JD.resetSave();
      window.__JD.updateCase(caseId, (c) => ({
        ...c,
        stage: 'inquest',
        token,
        snapshot: { ...progress, asked: qs, hintsUsed: n - 1, debateMisses: n, verdictAttempts: n },
        log: log.map((e, i) => ({ ...e, id: `s${i}`, at: Date.now() })),
        hints: Array.from({ length: n - 1 }, (_, i) => ({ level: i + 1, text: 'ヒント' })),
        elapsedMs: (8 + n * 6) * 60_000 + 23_000,
        inquest: { phase: 'done', roundIndex: 1, composure: 4, cleared: ['r1', 'r2'], misses: n, grants: n === 3 ? 1 : 0, verdictAttempts: n, suspensions: 0 },
      }));
      window.__JD.setSettings({ textSpeed: 'fast' });
      window.__JD.flushSave();
    },
    { caseId, stage },
  );
}

async function advanceDialogue(page, times, gap = 350) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.__JD.skipText());
    await wait(120);
    await page.keyboard.press('Enter');
    await wait(gap);
  }
}

async function scrollPageTo(page, selector, offset = 12) {
  await page.evaluate(
    ({ selector, offset }) => {
      const el = document.querySelector(selector);
      const sc = el?.closest('.page');
      if (!el || !sc) return;
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - offset;
      sc.scrollTo({ top, behavior: 'instant' });
    },
    { selector, offset },
  );
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

try {
  for (const size of SIZES) {
    const { tag, ...ctxOpts } = size;
    for (const caseId of CASES) {
      const c = caseId.slice(0, 3);
      const P = `${c}-${tag}`;
      console.log(`[ending] ${caseId} ${tag}`);
      const ctx = await browser.newContext({ ...ctxOpts, locale: 'ja-JP', reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${P} pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`${P} console: ${m.text()}`);
      });
      await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 30000 });
      await seed(page, caseId);

      /* ---------------- resolution ---------------- */
      if (want('resolution')) {
        await page.evaluate((caseId) => window.__JD.goto('resolution', { caseId }), caseId);
        await idle(page);
        await page.waitForSelector('.res-cer', { timeout: 15000 });
        await wait(1900);
        await shot(page, `${P}-res-1-before`);
        // Holma's solved lines + identity line → assemble
        const holmaLines = await page.evaluate(() => document.querySelectorAll('.dlg').length);
        void holmaLines;
        for (let i = 0; i < 8; i++) {
          const assembling = await page.evaluate(() => !document.querySelector('.res-cer__dock .dlg'));
          if (assembling) break;
          await advanceDialogue(page, 1, 300);
        }
        await wait(REDUCED ? 300 : 1300);
        await shot(page, `${P}-res-2-assembling`);
        await page.waitForSelector('.nameplate.is-done', { timeout: 15000 });
        await wait(1200);
        await shot(page, `${P}-res-3-named`);
        await page.waitForSelector('.dlg--restored', { timeout: 15000 });
        await page.evaluate(() => window.__JD.skipText());
        await wait(900);
        await shot(page, `${P}-res-4-farewell`);
        for (let i = 0; i < 10; i++) {
          if (await page.$('.res-rec')) break;
          await advanceDialogue(page, 1, 300);
        }
        await page.waitForSelector('.res-rec', { timeout: 10000 });
        await wait(1000);
        await overflow(page, `${P} resolution record`);
        await shot(page, `${P}-res-5-record`);
        await scrollPageTo(page, '.disc');
        await wait(400);
        await shot(page, `${P}-res-6-story`);
        await page.click('.disc:nth-of-type(2) .disc__btn').catch(() => {});
        await page.evaluate(() => document.querySelectorAll('.disc__btn')[1]?.click());
        await wait(300);
        await scrollPageTo(page, '.facts');
        await wait(400);
        await shot(page, `${P}-res-7-facts`);
        await page.evaluate(() => document.querySelector('#tab-facts-missed')?.click());
        await wait(300);
        await shot(page, `${P}-res-8-missed`);
        await scrollPageTo(page, '.res-rec__next', 200);
        await wait(300);
        await shot(page, `${P}-res-9-next`);
      }

      /* ---------------- science ---------------- */
      if (want('science')) {
        await page.evaluate((caseId) => window.__JD.goto('science', { caseId }), caseId);
        await idle(page);
        await page.waitForSelector('.sci-article', { timeout: 15000 });
        await wait(900);
        await overflow(page, `${P} science`);
        await shot(page, `${P}-sci-00-top`);
        const ids = await page.evaluate(() => [...document.querySelectorAll('.sci-sec')].map((e) => e.id));
        for (const [i, id] of ids.entries()) {
          await scrollPageTo(page, `#${id}`, tag === 'sp' ? 60 : 16);
          await wait(id === 'sci-chain' ? 2200 : 700);
          await shot(page, `${P}-sci-${String(i + 1).padStart(2, '0')}-${id.slice(4)}`);
        }
        // diagrams: scroll each into view, let it animate, then capture the figure itself
        // (the page scrolls inside .page, so a tall figure is captured with a temporarily
        // taller viewport and the sticky phone bar hidden)
        const n = await page.locator('.dg').count();
        for (let i = 0; i < n; i++) {
          const fig = page.locator('.dg').nth(i);
          await fig.evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await page.evaluate(() => document.querySelector('.page')?.scrollBy(0, -70));
          await wait(3600);
          const h = await fig.evaluate((el) => el.getBoundingClientRect().height);
          const vp = ctxOpts.viewport;
          if (h + 140 > vp.height) {
            await page.setViewportSize({ width: vp.width, height: Math.ceil(h + 160) });
            await wait(250);
          }
          await page.addStyleTag({ content: '.sci-mnav{visibility:hidden!important}' });
          await fig.evaluate((el) => el.scrollIntoView({ block: 'center' }));
          await wait(200);
          await fig.screenshot({ path: resolve(out, `${P}-dg-${i + 1}.png`) });
          await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent?.includes('.sci-mnav{visibility') && s.remove()));
          await page.setViewportSize(vp);
          console.log(`  ✓ ${P}-dg-${i + 1}.png`);
        }
        // myths flipped
        await page.evaluate(() => document.querySelectorAll('.flip')[0]?.click());
        await scrollPageTo(page, '#sci-myths', tag === 'sp' ? 60 : 16);
        await wait(1000);
        await shot(page, `${P}-sci-myth-flipped`);
        if (tag === 'sp') {
          await page.click('.sci-mnav__cur');
          await wait(300);
          await shot(page, `${P}-sci-menu`);
          await page.click('.sci-mnav__cur');
        }
        await scrollPageTo(page, '.sci-end', 300);
        await wait(500);
        await shot(page, `${P}-sci-end`);
      }

      /* ---------------- quiz ---------------- */
      if (want('quiz') || want('result')) {
        const answers = await page.evaluate(async (caseId) => {
          const token = window.__JD.getState().save.cases[caseId].token;
          const r = await fetch('api/solution', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, token }) });
          return (await r.json()).quiz.map((q) => q.answer);
        }, caseId);
        await page.evaluate((caseId) => window.__JD.goto('quiz', { caseId }), caseId);
        await idle(page);
        await page.waitForSelector('.qz-card', { timeout: 15000 });
        await wait(700);
        await overflow(page, `${P} quiz`);
        if (want('quiz')) await shot(page, `${P}-quiz-1-question`);
        for (const [qi, ans] of answers.entries()) {
          if (qi === 0) {
            const wrong = ans === 0 ? 1 : 0;
            await page.locator('.qz-choice').nth(wrong).click();
            await wait(700);
            if (want('quiz')) await shot(page, `${P}-quiz-2-wrong`);
          }
          await page.locator('.qz-choice').nth(ans).click();
          await wait(700);
          if (qi === 0 && want('quiz')) await shot(page, `${P}-quiz-3-right`);
          await page.click('.qz-fb__actions .btn');
          await wait(qi === answers.length - 1 ? 1600 : 700);
        }
        await page.waitForSelector('.qz-done', { timeout: 5000 });
        await overflow(page, `${P} quiz complete`);
        if (want('quiz')) await shot(page, `${P}-quiz-4-complete`);

        /* ---------------- result ---------------- */
        if (want('result')) {
          await page.click('.qz-done .btn');
          await idle(page);
          await page.waitForSelector('.rs-rank__seal', { timeout: 15000 });
          await wait(2600);
          await overflow(page, `${P} result`);
          await shot(page, `${P}-result-1`);
          await scrollPageTo(page, '.rs-actions', 300);
          await wait(400);
          await shot(page, `${P}-result-2-actions`);
          if (c === 'c01') {
            await page.click('.rs-actions__row .btn:nth-child(2)');
            await wait(600);
            await shot(page, `${P}-result-3-confirm`);
            await page.keyboard.press('Escape');
            await wait(400);
            await page.evaluate(() => window.__JD.goto('files'));
            await idle(page);
            await wait(1500);
            await shot(page, `${P}-files-bestrank`);
          }
          const saved = await page.evaluate((caseId) => {
            const c = window.__JD.getState().save.cases[caseId];
            return { stage: c.stage, completed: c.completed, bestRank: c.bestRank, clears: c.clears, title: c.lastResult?.title };
          }, caseId);
          console.log(`  save: ${JSON.stringify(saved)}`);
          if (!saved.completed || !saved.bestRank || saved.stage !== 'complete') problems.push(`${P}: case not marked complete (${JSON.stringify(saved)})`);
        }
      }

      await ctx.close();
    }
  }
} finally {
  await browser.close();
  if (server) await server.close();
}

if (problems.length) {
  console.log('\n[ending] problems:');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n[ending] ok');
