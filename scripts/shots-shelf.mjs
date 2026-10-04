/**
 * Screenshots of the 事件ファイル shelves (2026-10-04): every tab, without a switch and with
 * ?proto=lab, on PC 1280×800, phone 390×844 and 320×640. Rules mode (no paid calls).
 *
 *   node scripts/shots-shelf.mjs [--out dir]      (SHELF_PORT, default 5363)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const out = resolve(oi >= 0 ? argv[oi + 1] : resolve(root, 'qa', 'shelf'));
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.SHELF_PORT || 5363);
const BASE = `http://127.0.0.1:${PORT}/`;
const SIZES = {
  pc: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  sp: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  sp320: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const health = async () => {
  try {
    const r = await fetch(`${BASE}api/health`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};
let server = null;
if (!(await health())) {
  server = spawn(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PIPELINE_MODE: 'rules', DECISION_PROVIDER: 'rules', LLM_PROVIDER: 'none', TRACE_FILE: '0' },
  });
  for (let i = 0; i < 200 && !(await health()); i++) await new Promise((r) => setTimeout(r, 250));
}
const problems = [];
const browser = await chromium.launch();
try {
  for (const [size, ctxOpt] of Object.entries(SIZES)) {
    for (const proto of ['', 'lab']) {
      const ctx = await browser.newContext(ctxOpt);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${size} ${proto} pageerror ${e.message}`));
      await page.goto(`${BASE}?debug=1&mute=1${proto ? `&proto=${proto}` : ''}`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => !!window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 60000 });
      await page.evaluate(() => {
        window.__JD.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
        window.__JD.goto('files');
      });
      await page.waitForSelector('[data-files-tab]', { timeout: 60000 });
      await page.waitForTimeout(1500);
      const tabs = await page.$$eval('[data-files-tab]', (els) => els.map((e) => e.getAttribute('data-files-tab')));
      for (const t of tabs) {
        await page.locator(`[data-files-tab="${t}"]`).click();
        await page.waitForTimeout(900);
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (ov > 1) problems.push(`${size} ${proto} ${t}: horizontal overflow ${ov}px`);
        const name = `${size}${proto ? '-lab' : ''}-${t}`;
        await page.screenshot({ path: resolve(out, `${name}.png`) });
        // further down (the page scrolls inside .page): the 「謎を作る」 panel, the next shelf of すべて
        const below = t === 'lab' ? '[data-lab-make]' : t === 'all' ? '[data-shelf="original"]' : null;
        if (below) {
          await page.locator(below).scrollIntoViewIfNeeded();
          await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), below);
          await page.waitForTimeout(500);
          await page.screenshot({ path: resolve(out, `${name}-below.png`) });
          await page.evaluate(() => document.querySelector('.files__page')?.scrollTo(0, 0));
        }
        console.log(`  shot ${name}  (${tabs.join('·')})`);
      }
      // the tab is remembered for this browser tab (sessionStorage): a reload keeps it
      await page.locator('[data-files-tab="original"]').click();
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 60000 });
      await page.evaluate(() => window.__JD.goto('files'));
      await page.waitForSelector('[data-files-tab]');
      const on = await page.getAttribute('[data-files-tab][aria-selected="true"]', 'data-files-tab');
      if (on !== 'original') problems.push(`${size} ${proto}: the tab was not remembered (${on})`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(problems.length ? problems.join('\n') : 'shelf shots OK');
process.exit(problems.length ? 1 : 0);
