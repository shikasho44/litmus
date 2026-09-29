// 死因審問 (inquest) visual QA — drives the whole inquest in a real browser and screenshots
// every state.
//   node scripts/shots-inquest.mjs                 c01 + c02 at pc/sp, c01 at pc720, c02 at sp360,
//                                                  plus resume, suspension, safety, reduced-motion,
//                                                  grant-a-new-card, bad-token and error/loading checks
//   node scripts/shots-inquest.mjs --quick         c01 at pc and sp only
//   node scripts/shots-inquest.mjs --case c02 --size sp
// Uses the dev server on :5192 (starts `vite --port 5192 --strictPort` itself if nothing answers).
// Seeds the save with a dev-only minted token (POST /api/admin/mint-token, stage 'investigated').
//
// Time: every page runs on Playwright's virtual clock (page.clock). The script advances it
// explicitly (tick), so GSAP timelines, typewriters and timers are frame-exact no matter how
// busy the machine is. The API runs in real time; helpers interleave short real sleeps so
// responses can land. CSS-only animations run in real time (tiny settle sleeps before shots).
//
// Output: qa/inquest/<case>-<size>-<nn>-<state>.png. Exit 1 on page errors, console errors,
// failed flows or horizontal overflow. Headless Chromium + SwiftShader.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const QUICK = argv.includes('--quick');
/** --only c02-pc,suspend … run a subset of the full plan (labels as printed). */
const ONLY = arg('--only')?.split(',');
const ONLY_CASE = arg('--case');
const ONLY_SIZE = arg('--size');
const PORT = Number(process.env.INQUEST_PORT || 5192);
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'inquest');
mkdirSync(out, { recursive: true });

const CASES = Object.fromEntries(
  readdirSync(resolve(root, 'content', 'cases')).map((dir) => [dir.slice(0, 3), JSON.parse(readFileSync(resolve(root, 'content', 'cases', dir, 'case.json'), 'utf8'))]),
);
const INCOMPLETE = {
  c01: '酸欠で亡くなったのだと思う。夜なので部屋の換気が止まっていた。',
  c02: 'ボールが胸に当たって、心室細動が起きた。',
  c03: '寒さで体が冷えて亡くなった。',
  c04: 'トリカブトの毒で亡くなった。',
};
const SIZES = {
  pc: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  pc720: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  sp: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  sp360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  sp320: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/* ------------------------------------------------------------------ server */
let server = null;
async function up() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}
if (!(await up())) {
  console.log(`[inquest] starting vite on :${PORT}`);
  server = spawn(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  let ok = false;
  for (let i = 0; i < 160 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 250));
    ok = await up();
  }
  if (!ok) {
    console.error('[inquest] dev server did not start');
    server.kill();
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ helpers */
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Advance the page's virtual clock (in 100 ms slices so rAF renders intermediate frames). */
async function tick(page, ms) {
  for (let t = 0; t < ms; t += 100) await page.clock.runFor(Math.min(100, ms - t));
}

async function shot(page, name) {
  await sleep(250); // let CSS-only transitions settle (they run on real time)
  await overflow(page, name);
  await page.screenshot({ path: resolve(out, `${name}.png`), timeout: 180000 });
  console.log(`  ✓ ${name}.png`);
}
async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.iq__verdict, .recon__pagewrap, .evl__list, .sheet__body, .iq-mag, .scene')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    }
    return res;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}
const state = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.iq');
    return el
      ? {
          phase: el.dataset.phase,
          step: el.dataset.step,
          vstep: el.dataset.verdictStep,
          dlg: el.dataset.dialogue,
          busy: el.dataset.busy,
          card: el.dataset.card,
          cut: !!document.querySelector('.fx-cutin'),
          sheet: !!document.querySelector('.sheet-root'),
          hash: location.hash,
        }
      : { phase: null, hash: location.hash };
  });

/** Advance time until pred(state); finishes and advances dialogue lines on the way when asked. */
async function until(page, pred, { advance = true, timeout = 300000, label = 'condition', step = 120 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await state(page);
    if (pred(st)) return st;
    if (advance && st.dlg === 'on') {
      await page.evaluate(() => window.__JD.skipText());
      await tick(page, 60);
      await page.click('.iq__dialogue .dlg', { timeout: 3000, force: true }).catch(() => {});
    }
    await tick(page, step);
    await sleep(25); // real time for API responses
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(await state(page))}`);
}
async function untilSel(page, sel, { timeout = 240000, gone = false } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const has = await page.evaluate((s) => !!document.querySelector(s), sel);
    if (has !== gone) return;
    await tick(page, 60);
    await sleep(20);
  }
  throw new Error(`timeout waiting for ${gone ? 'no ' : ''}${sel}`);
}

async function open(page, caseId, stage = 'investigated') {
  await page.clock.install();
  await page.goto(`${BASE}?mute=1`, { waitUntil: 'load' });
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !!window.__JD && document.documentElement.classList.contains('app-ready'))) break;
    await tick(page, 100);
    await sleep(20);
  }
  // Freeze page time: from here on it only moves when the script ticks it.
  await freeze(page);
  await page.evaluate(
    async ({ caseId, stage }) => {
      const J = window.__JD;
      J.resetSave();
      J.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
      J.setSettings({ textSpeed: 'fast' });
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage }) });
      const { token, progress } = await r.json();
      // 教授 (free-text verdict): this script covers the 宣告書; the other formats are in shots-modes.mjs
      J.updateCase(caseId, { stage: 'inquest', token, snapshot: progress, difficulty: 'hard' });
      J.flushSave();
      J.goto('inquest', { caseId });
    },
    { caseId, stage },
  );
}
async function reload(page) {
  await page.evaluate(() => window.__JD.flushSave());
  await page.reload({ waitUntil: 'load' });
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !!window.__JD && document.documentElement.classList.contains('app-ready'))) break;
    await tick(page, 100);
    await sleep(20);
  }
  await freeze(page);
}

/** clock.pauseAt(now + margin); on a busy machine the page clock can overtake the margin — retry wider. */
async function freeze(page) {
  for (const margin of [100, 600, 2000, 5000]) {
    try {
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + margin);
      return;
    } catch (e) {
      if (!/past/.test(String(e?.message))) throw e;
    }
  }
  throw new Error('could not pause the page clock');
}

/** Lock the noise that contains `span` in statement `stmtId` (jumps to it first). */
async function lockNoise(page, round, stmtId, span) {
  const i = round.statements.findIndex((s) => s.id === stmtId);
  await page.click(`.debate__dot >> nth=${i}`);
  await untilSel(page, `.band[data-statement-id="${stmtId}"]`);
  await tick(page, 700);
  const handles = await page.$$(`.band[data-statement-id="${stmtId}"] .noise`);
  for (const h of handles) {
    const t = await h.getAttribute('data-noise');
    if (t && (t.includes(span) || span.includes(t))) {
      await h.click({ force: true });
      await tick(page, 400);
      return;
    }
  }
  throw new Error(`noise "${span}" not found in ${stmtId}`);
}

async function pickEvidence(page, factId, narrow) {
  if (narrow) {
    await tick(page, 400); // locking with an empty chamber opens the drawer by itself
    if (!(await page.$('.sheet-root'))) await page.click('[data-loaded-slot]');
    await untilSel(page, `.sheet-root [data-fact-id="${factId}"]`);
    await tick(page, 400);
    const el = page.locator(`.sheet-root [data-fact-id="${factId}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await untilSel(page, '.sheet-root', { gone: true });
  } else {
    const el = page.locator(`.iq-mag [data-fact-id="${factId}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.click();
  }
  await tick(page, 150);
}

async function pickOption(page, panelId, text, narrow) {
  const scope = narrow ? '.sheet-root ' : '.recon__side ';
  // after a pick the chooser moves on to the next blank by itself: only open the panel if needed
  if (!(await page.$(`${scope}[data-choice-for="${panelId}"]`))) {
    if (narrow && (await page.$('.sheet-root'))) {
      await page.keyboard.press('Escape');
      await untilSel(page, '.sheet-root', { gone: true });
    }
    await page.locator(`[data-panel-id="${panelId}"]`).scrollIntoViewIfNeeded();
    await page.click(`[data-panel-id="${panelId}"]`);
  }
  await untilSel(page, `${scope}[data-choice-for="${panelId}"]`);
  await tick(page, narrow ? 400 : 150);
  await page.locator(`${scope}.choice__opt`, { hasText: text }).first().click();
  await tick(page, 700);
}

/** Keyboard only: ↑↓ to the statement, ←→ to the noise, E to the finding, Enter to fire. */
async function keyboardShot(page, round, { focusRow } = {}) {
  const { statement, span, fact } = round.answer;
  const want = round.statements.findIndex((s) => s.id === statement);
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let k = 0; k < 12; k++) {
    const cur = await page.evaluate(() => [...document.querySelectorAll('.debate__dot')].findIndex((d) => d.getAttribute('aria-current') === 'true'));
    if (cur === want) break;
    await page.keyboard.press(cur < want ? 'ArrowDown' : 'ArrowUp');
    await tick(page, 250);
  }
  for (let k = 0; k < 12; k++) {
    await page.keyboard.press('ArrowRight');
    await tick(page, 250);
    const t = await page.evaluate(() => {
      const n = document.querySelector('.noise.is-target');
      return n ? { text: n.dataset.noise, st: n.closest('.band')?.dataset.statementId } : null;
    });
    if (t && t.st === statement && (t.text.includes(span) || span.includes(t.text))) break;
  }
  if (focusRow) {
    // a mouse click on some other finding first leaves the focus on that magazine row:
    // E must carry the focus along, and Enter must fire (not re-load the clicked row)
    const other = page.locator(`.iq-mag .evl__row:not([data-fact-id="${fact}"])`).first();
    await other.scrollIntoViewIfNeeded();
    await other.click();
    await tick(page, 150);
  }
  for (let k = 0; k < 80; k++) {
    const f = await page.evaluate(() => document.querySelector('[data-loaded-fact]')?.getAttribute('data-loaded-fact'));
    if (f === fact) break;
    await page.keyboard.press('e');
    await tick(page, 40);
  }
  await tick(page, 200);
  if (focusRow) {
    const ae = await page.evaluate(() => document.activeElement?.getAttribute('data-fact-id'));
    if (ae && ae !== fact) problems.push(`keyboard: focus stayed on ${ae} after E selected ${fact}`);
  }
  await page.keyboard.press('Enter');
}

/** Rect of the first element matching `sel` (null when absent / hidden). */
const rect = (page, sel) =>
  page.evaluate((q) => {
    const e = document.querySelector(q);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right };
  }, sel);
const overlaps = (a, b) => !!a && !!b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;

/** Phone touch targets of the debate must be ≥ 44 × 44 (visual size may be smaller). */
async function touchTargets(page, tag) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const sel of ['.debate__dot', '.debate__pause', '.debate__navbtn', '.iq-dock__loaded', '[data-fire]', '[data-beg]']) {
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (!r.width || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') continue;
        if (r.width < 43.5 || r.height < 43.5) out.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    // the noise: the word plus its invisible hit area (::after of .noise__txt)
    for (const n of document.querySelectorAll('.band:not(.is-leaving) .noise')) {
      const r = n.getBoundingClientRect();
      const a = getComputedStyle(n.querySelector('.noise__txt'), '::after');
      const h = r.height - parseFloat(a.top) - parseFloat(a.bottom);
      if (h < 43.5) out.push(`.noise ${Math.round(r.width)}x${Math.round(h)}`);
    }
    return out;
  });
  if (small.length) problems.push(`${tag}: touch targets below 44px → ${[...new Set(small)].join(', ')}`);
}

function watch(page, tag) {
  // SwiftShader raster on a busy machine can take many seconds per frame: be patient.
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`);
  });
}

/* ------------------------------------------------------------------ one full run */
async function runCase(browser, key, sizeKey, opts = {}) {
  const c = CASES[key];
  const size = SIZES[sizeKey];
  const narrow = sizeKey.startsWith('sp');
  const tag = `${key}-${sizeKey}`;
  let n = 0;
  const name = (s) => `${tag}-${String(++n).padStart(2, '0')}-${s}`;
  console.log(`[inquest] ${tag} ${size.viewport.width}x${size.viewport.height}`);
  const ctx = await browser.newContext({ ...size, locale: 'ja-JP', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  watch(page, tag);
  try {
    await open(page, c.id);
    // opening: the 開廷 cut-in
    await untilSel(page, '.fx-cutin');
    await tick(page, 700);
    await shot(page, name('opening'));
    await until(page, (s) => s.card === 'on', { label: 'round card' }); // (some cases: Holma's 開廷 line first)
    await tick(page, 900);
    await shot(page, name('round-card'));
    await until(page, (s) => s.dlg === 'on', { advance: false, label: 'intro line' });
    await page.evaluate(() => window.__JD.skipText());
    await tick(page, 300);
    await shot(page, name('round-intro-line'));
    if (narrow) {
      const next = await rect(page, '.iq__dialogue .dlg__next');
      if (next && (next.w < 43.5 || next.h < 43.5)) problems.push(`${tag}: dialogue advance button ${Math.round(next.w)}x${Math.round(next.h)} (< 44)`);
      if (await rect(page, '.iq-dock')) problems.push(`${tag}: the dock shows under a dialogue line`);
    }
    await until(page, (s) => s.step === 'play' && s.dlg === 'off', { label: 'debate play' });
    await tick(page, 1200);
    await shot(page, name('debate'));
    if (narrow) await touchTargets(page, tag);

    const round = c.debate[0];
    const ok = [round.answer.fact, ...(round.alsoAccept ?? [])];
    const wrongFacts = c.facts.filter((f) => f.spoilerLevel <= 3 && f.importance >= 1 && !ok.includes(f.id)).map((f) => f.id);

    // miss #1
    await lockNoise(page, round, round.answer.statement, round.answer.span);
    await pickEvidence(page, wrongFacts[0], narrow);
    await shot(page, name('locked'));
    await page.click('[data-fire]');
    await tick(page, 380);
    await shot(page, name('miss-flight'));
    await until(page, (s) => s.step === 'play' && s.busy === 'off', { advance: false, label: 'after miss' });
    await tick(page, 500);
    await shot(page, name('miss'));

    if (opts.reloadAfterMiss) {
      await reload(page);
      await until(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && !s.cut, { label: 'resume debate' });
      await tick(page, 900);
      const cmp = await page.evaluate(() => document.querySelector('.cmp')?.getAttribute('aria-valuenow'));
      if (cmp !== '4') problems.push(`${tag}: composure after reload is ${cmp}, expected 4`);
      await shot(page, name('resumed-debate'));
    }

    // miss #2 → hint
    await lockNoise(page, round, round.answer.statement, round.answer.span);
    await pickEvidence(page, wrongFacts[3] ?? wrongFacts[1], narrow);
    await page.click('[data-fire]');
    await until(page, (s) => s.step === 'play' && s.busy === 'off', { advance: false, label: 'after miss 2' });
    await untilSel(page, '.hintb');
    await tick(page, 600);
    await shot(page, name('hint'));

    // correct shot (mouse / touch, or keyboard only)
    if (opts.keyboard) {
      await keyboardShot(page, round, { focusRow: true });
      await tick(page, 120);
      const st = await state(page);
      if (st.step !== 'firing' && st.step !== 'success' && !st.cut) problems.push(`${tag}: keyboard Enter did not fire (step ${st.step})`);
      await shot(page, name('keyboard-fire'));
    } else {
      await lockNoise(page, round, round.answer.statement, round.answer.span);
      await pickEvidence(page, round.answer.fact, narrow);
      await shot(page, name('loaded-correct'));
      await page.click('[data-fire]');
    }
    await tick(page, 330);
    await shot(page, name('impact'));
    await untilSel(page, '.fx-cutin');
    await tick(page, 450);
    await shot(page, name('refute-cutin'));
    if (opts.skip) {
      // cut-ins can be skipped (Enter)
      await page.keyboard.press('Enter');
      await tick(page, 260);
      if (await page.$('.fx-cutin')) problems.push(`${tag}: Enter did not skip the 反応あり！ cut-in`);
    }
    await until(page, (s) => s.step === 'success' && s.dlg === 'on', { advance: false, label: 'success lines' });
    await page.evaluate(() => window.__JD.skipText());
    await tick(page, 300);
    await shot(page, name('success-line'));
    if (!(await page.$('.iq__dialogue.speaker-jane'))) problems.push(`${tag}: the corrected memory is not spoken by Jane`);
    if (narrow && (await rect(page, '.iq-dock'))) problems.push(`${tag}: the dock shows under Jane's line`);
    await until(page, (s) => s.card === 'on', { label: 'memory restored card' });
    await tick(page, 700);
    await shot(page, name('memory-restored'));
    if (opts.skip) {
      await page.keyboard.press(' ');
      await tick(page, 160);
      // (the next round's card may already be up: check this one is gone)
      if (await page.evaluate(() => [...document.querySelectorAll('.tcard__title')].some((e) => e.textContent.includes('記憶修復'))))
        problems.push(`${tag}: Space did not skip the 記憶修復 card`);
    }

    // later rounds
    for (let r = 1; r < c.debate.length; r++) {
      const rd = c.debate[r];
      await until(page, (s) => s.step === 'play' && s.dlg === 'off' && s.card === 'off', { label: `round ${r + 1}` });
      await tick(page, 900);
      if (r === 1) await shot(page, name(`round${r + 1}`));
      if (r === 1 && (await page.$('[data-loaded-fact]'))) problems.push(`${tag}: round ${r + 1} starts with last round's finding still loaded`);
      if (opts.grant && r === 1) {
        await page.click('[data-beg]');
        await untilSel(page, '[data-beg-confirm]');
        await tick(page, 300);
        await shot(page, name('beg-confirm'));
        await page.click('[data-beg-confirm]');
        await until(page, (s) => s.busy === 'off', { advance: false, label: 'grant' });
        await tick(page, 700);
        await shot(page, name('beg-granted'));
      }
      await lockNoise(page, rd, rd.answer.statement, rd.answer.span);
      await pickEvidence(page, rd.answer.fact, narrow);
      await page.click('[data-fire]');
      await until(page, (s) => s.step === 'success' || s.phase === 'verdict', { advance: false, label: `hit ${r + 1}` });
    }

    // verdict: Holma's prompt first — the sheet must not steal the keyboard meanwhile
    await until(page, (s) => s.phase === 'verdict' && s.dlg === 'on' && !s.cut, { label: 'verdict prompt' });
    await tick(page, 300);
    {
      const ae = await page.evaluate(() => document.activeElement?.id);
      if (ae === 'verdict-text') problems.push(`${tag}: the verdict sheet has focus while Holma's prompt is on screen`);
      if (!narrow) {
        const d = await rect(page, '.iq__dialogue');
        const btn = await rect(page, '[data-verdict-submit]');
        if (overlaps(d, btn)) problems.push(`${tag}: Holma's prompt covers the 宣告する button`);
      }
      await page.keyboard.press('Enter');
      await tick(page, 200);
      await page.keyboard.press('Enter');
      await tick(page, 300);
      const v = await page.inputValue('#verdict-text');
      if (v !== '') problems.push(`${tag}: Enter during Holma's prompt typed into the verdict (${JSON.stringify(v)})`);
    }
    await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut, { label: 'verdict' });
    await tick(page, 2400);
    await shot(page, name('verdict'));
    if (!narrow && (await page.evaluate(() => document.activeElement?.id)) !== 'verdict-text') problems.push(`${tag}: the verdict sheet is not focused once Holma is done`);
    await page.fill('#verdict-text', INCOMPLETE[key]);
    await tick(page, 200);
    await page.click('[data-verdict-submit]');
    await tick(page, 900);
    await shot(page, name('verdict-judging'));
    await until(page, (s) => s.vstep === 'result', { advance: false, label: 'verdict result' });
    await tick(page, 750); // after the slam, before the stamp becomes a corner seal
    await shot(page, name('verdict-result'));
    await until(page, (s) => s.dlg === 'on', { advance: false, label: 'verdict lines' });
    await page.evaluate(() => window.__JD.skipText());
    await tick(page, 250);
    await sleep(700); // smooth scroll (phone) runs on real time
    await shot(page, name('verdict-lines'));
    {
      const d = await rect(page, '.iq__dialogue');
      const chk = await rect(page, '.vresult');
      if (overlaps(d, chk)) problems.push(`${tag}: Holma's verdict line covers the element checklist`);
      if (!(await page.$('.vsheet__stamp.is-sealed'))) problems.push(`${tag}: the verdict stamp did not shrink to a corner seal`);
    }
    await until(page, (s) => s.vstep === 'write' && s.dlg === 'off', { label: 'rewrite' });
    await tick(page, 400);
    await shot(page, name('verdict-retry'));
    if (!(await page.$('.vnote'))) problems.push(`${tag}: Holma's pointed note is gone after the verdict lines`);

    if (opts.reloadAtVerdict) {
      await tick(page, 700); // draft autosave debounce
      await reload(page);
      await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut, { label: 'resume verdict' });
      await tick(page, 2400);
      const draft = await page.inputValue('#verdict-text');
      if (draft !== INCOMPLETE[key]) problems.push(`${tag}: verdict draft not restored after reload (${JSON.stringify(draft)})`);
      await shot(page, name('resumed-verdict'));
    }

    if (opts.safety) {
      await page.fill('#verdict-text', 'もう死にたい。つらい。');
      await page.click('[data-verdict-submit]');
      await until(page, (s) => s.dlg === 'on', { advance: false, label: 'safety line' });
      await page.evaluate(() => window.__JD.skipText());
      await tick(page, 300);
      await shot(page, name('verdict-support'));
      await until(page, (s) => s.vstep === 'write' && s.dlg === 'off', { label: 'after safety' });
      if (!(await page.$('.vsupport'))) problems.push(`${tag}: support card not shown for a self-harm verdict`);
      if (await page.$('.vstamp')) problems.push(`${tag}: a stamp was shown for a self-harm verdict`);
    }

    await page.fill('#verdict-text', c.truth.summary);
    await page.click('[data-verdict-submit]');
    await until(page, (s) => s.vstep === 'result', { advance: false, label: 'verdict correct' });
    await tick(page, 1100);
    await shot(page, name('verdict-correct'));
    await until(page, (s) => s.dlg === 'off' && s.cut, { label: 'cause confirmed cut-in' });
    await tick(page, 450);
    await shot(page, name('cause-confirmed'));

    // reconstruction
    await until(page, (s) => s.phase === 'reconstruction' && s.dlg === 'off' && !s.cut, { label: 'recon' });
    await tick(page, 600);
    await until(page, (s) => s.dlg === 'off' && !s.cut, { label: 'recon settled' });
    await tick(page, 900);
    await shot(page, name('recon'));
    const blanks = c.reconstruction.panels.filter((p) => p.choice);
    const first = blanks[0];
    for (const [i, p] of blanks.entries()) {
      const good = p.choice.options.find((o) => o.correct).text;
      const bad = p.choice.options.find((o) => !o.correct).text;
      await pickOption(page, p.id, p === first ? bad : good, narrow);
      const nxt = blanks[i + 1];
      if (nxt && !(await page.$(`[data-choice-for="${nxt.id}"]`))) problems.push(`${tag}: after picking ${p.id} the chooser did not move on to ${nxt.id}`);
    }
    await untilSel(page, '.sheet-root', { gone: true });
    await tick(page, 500);
    if (!(await page.evaluate(() => document.activeElement?.hasAttribute('data-recon-submit')))) problems.push(`${tag}: 確定 is not focused after the last blank`);
    await shot(page, name('recon-picked'));
    await page.click('[data-recon-submit]');
    await until(page, (s) => s.dlg === 'on', { advance: false, label: 'recon wrong line' });
    await page.evaluate(() => window.__JD.skipText());
    await tick(page, 400);
    await shot(page, name('recon-wrong'));
    await until(page, (s) => s.dlg === 'off' && s.busy === 'off', { label: 'recon retry' });
    await tick(page, 300);
    await pickOption(page, first.id, first.choice.options.find((o) => o.correct).text, narrow);
    await untilSel(page, '.sheet-root', { gone: true });
    await tick(page, 300);
    await page.click('[data-recon-submit]');
    await until(page, (s) => s.phase === 'finale' && s.dlg === 'on', { advance: false, label: 'finale' });
    // advance a few narration lines so a middle frame is lit
    for (let k = 0; k < 4; k++) {
      await page.evaluate(() => window.__JD.skipText());
      await tick(page, 100);
      await page.click('.iq__dialogue .dlg', { force: true }).catch(() => {});
      await tick(page, 1300);
    }
    await page.evaluate(() => window.__JD.skipText());
    await tick(page, 500);
    const lit = await page.evaluate(() => [...document.querySelectorAll('.cpanel')].map((e) => (e.classList.contains('is-active') ? 'A' : e.classList.contains('is-lit') ? 'L' : e.classList.contains('is-dim') ? '.' : '?')).join(''));
    if (!/^L*A\.*$/.test(lit)) problems.push(`${tag}: finale frames not lit in order (${lit})`);
    await shot(page, name('finale'));
    await until(page, (s) => s.cut, { label: 'finale cut-in' });
    await tick(page, 450);
    await shot(page, name('truth-cutin'));
    await until(page, (s) => s.hash.includes('#/resolution'), { label: 'resolution' });
    const stage = await page.evaluate((id) => window.__JD.getState().save.cases[id]?.stage, c.id);
    if (stage !== 'resolution') problems.push(`${tag}: stage after finale is ${stage}`);
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${tag}-FAIL.png`) }).catch(() => {});
    console.error(`  ✗ ${tag}: ${e.message.split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
}

/** Five misses → 審問中断 → back to the investigation with findings kept. */
async function runSuspend(browser, key, sizeKey) {
  const c = CASES[key];
  const tag = `${key}-${sizeKey}-suspend`;
  const narrow = sizeKey.startsWith('sp');
  console.log(`[inquest] ${tag}`);
  const ctx = await browser.newContext({ ...SIZES[sizeKey], locale: 'ja-JP' });
  const page = await ctx.newPage();
  watch(page, tag);
  try {
    await open(page, c.id);
    await until(page, (s) => s.step === 'play' && s.dlg === 'off', { label: 'play' });
    const round = c.debate[0];
    const ok = [round.answer.fact, ...(round.alsoAccept ?? [])];
    const wrong = c.facts.filter((f) => f.spoilerLevel <= 3 && f.importance >= 1 && !ok.includes(f.id)).map((f) => f.id);
    for (let i = 0; i < 5; i++) {
      await lockNoise(page, round, round.answer.statement, round.answer.span);
      await pickEvidence(page, wrong[i], narrow);
      await page.click('[data-fire]');
      if (i < 4) await until(page, (s) => s.step === 'play' && s.busy === 'off', { advance: false, label: `miss ${i + 1}` });
      if (i === 3) {
        await tick(page, 2800);
        await shot(page, `${tag}-01-composure1`);
      }
    }
    await until(page, (s) => s.phase === 'suspended', { advance: false, label: 'suspended' });
    await tick(page, 1200);
    await shot(page, `${tag}-02-overlay`);
    await page.click('[data-suspend-back]');
    await until(page, (s) => s.hash.includes('#/investigation'), { advance: false, label: 'back to investigation' });
    const st = await page.evaluate((id) => window.__JD.getState().save.cases[id], c.id);
    if (st.stage !== 'investigation') problems.push(`${tag}: stage ${st.stage}`);
    if (st.inquest?.composure !== 5) problems.push(`${tag}: composure not refilled (${st.inquest?.composure})`);
    if (!st.token) problems.push(`${tag}: token lost`);
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/**
 * 「ホルマに泣きつく」 for a card the player does NOT have: a token straight from the start of the
 * case (stage 'fresh') holds none of the answer findings. The granted card must join the magazine,
 * load itself, and win the round; round 2 must start with an empty chamber.
 */
async function runGrant(browser, key, sizeKey) {
  const c = CASES[key];
  const tag = `${key}-${sizeKey}-grant`;
  const narrow = sizeKey.startsWith('sp');
  let n = 0;
  const name = (x) => `${tag}-${String(++n).padStart(2, '0')}-${x}`;
  console.log(`[inquest] ${tag}`);
  const ctx = await browser.newContext({ ...SIZES[sizeKey], locale: 'ja-JP' });
  const page = await ctx.newPage();
  watch(page, tag);
  try {
    await open(page, c.id, 'fresh');
    for (const [r, rd] of c.debate.entries()) {
      await until(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, { label: `round ${r + 1}` });
      await tick(page, 700);
      const have = await page.evaluate(({ id, f }) => !!window.__JD.getState().save.cases[id]?.facts?.[f], { id: c.id, f: rd.answer.fact });
      if (have) problems.push(`${tag}: the fresh token already holds ${rd.answer.fact}`);
      if (r > 0 && (await page.$('[data-loaded-fact]'))) problems.push(`${tag}: round ${r + 1} starts with a card loaded`);
      await shot(page, name(`r${r + 1}-empty`));
      await page.click('[data-beg]');
      await untilSel(page, '[data-beg-confirm]');
      await tick(page, 300);
      if (r === 0) await shot(page, name('beg-confirm'));
      await page.click('[data-beg-confirm]');
      await until(page, (s) => s.busy === 'off' && !s.sheet, { advance: false, label: 'grant' });
      await tick(page, 900);
      await shot(page, name(`r${r + 1}-granted`));
      const got = await page.evaluate(() => document.querySelector('[data-loaded-fact]')?.getAttribute('data-loaded-fact'));
      if (got !== rd.answer.fact) problems.push(`${tag}: round ${r + 1}: granted card is not loaded (${got}, want ${rd.answer.fact})`);
      if (!narrow && !(await page.$(`.iq-mag [data-fact-id="${rd.answer.fact}"].is-fresh`))) problems.push(`${tag}: round ${r + 1}: granted card is not in the magazine with a NEW mark`);
      const save = await page.evaluate((id) => window.__JD.getState().save.cases[id], c.id);
      if (!save.facts?.[rd.answer.fact]) problems.push(`${tag}: round ${r + 1}: granted card not stored in the notebook`);
      if (save.inquest?.grants !== r + 1) problems.push(`${tag}: round ${r + 1}: grant count ${save.inquest?.grants}`);
      // lock the answer and fire the granted card (the chamber is full: no drawer on phones)
      await lockNoise(page, rd, rd.answer.statement, rd.answer.span);
      await tick(page, 500);
      if (await page.$('.sheet-root')) problems.push(`${tag}: the magazine opened although a card was loaded`);
      await page.click('[data-fire]');
      await until(page, (s) => s.step === 'success' || s.phase === 'verdict', { advance: false, label: `hit ${r + 1}` });
      await until(page, (s) => s.dlg === 'on', { advance: false, label: `success ${r + 1}` });
      if (r === 0) {
        await page.evaluate(() => window.__JD.skipText());
        await tick(page, 300);
        await shot(page, name('success-line'));
      }
    }
    await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut, { label: 'verdict' });
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/** A token the server rejects (401 bad_token) during a shot / the verdict: a blocking dialog, then a clean restart. */
async function runBadToken(browser, key, sizeKey, where) {
  const c = CASES[key];
  const tag = `${key}-${sizeKey}-badtoken-${where}`;
  const narrow = sizeKey.startsWith('sp');
  console.log(`[inquest] ${tag}`);
  const ctx = await browser.newContext({ ...SIZES[sizeKey], locale: 'ja-JP' });
  const page = await ctx.newPage();
  watch(page, tag);
  page.on('console', (m) => {
    // the rejected call is expected to log a 401
    const i = problems.indexOf(`${tag} console: ${m.text()}`);
    if (m.type() === 'error' && /401|Unauthorized/.test(m.text()) && i >= 0) problems.splice(i, 1);
  });
  const tokenCalls = [];
  page.on('response', (r) => {
    if (/\/api\/token$/.test(new URL(r.url()).pathname)) tokenCalls.push(r.status());
  });
  try {
    await open(page, c.id, where === 'verdict' ? 'debated' : 'investigated');
    const bad = await page.evaluate((id) => {
      const J = window.__JD;
      const t = J.getState().save.cases[id].token;
      const b = t.slice(0, -6) + (t.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
      return b;
    }, c.id);
    if (where === 'shot') {
      await until(page, (s) => s.step === 'play' && s.dlg === 'off', { label: 'play' });
      await page.evaluate(({ id, bad }) => window.__JD.updateCase(id, { token: bad }), { id: c.id, bad });
      const round = c.debate[0];
      await lockNoise(page, round, round.answer.statement, round.answer.span);
      await pickEvidence(page, round.answer.fact, narrow);
      await page.click('[data-fire]');
    } else {
      await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut, { label: 'verdict' });
      // (the 死因宣告 cut-in may not have started yet: wait until the sheet can be written)
      await untilSel(page, '#verdict-text:not([readonly])', { timeout: 60000 });
      await page.evaluate(({ id, bad }) => window.__JD.updateCase(id, { token: bad }), { id: c.id, bad });
      await page.fill('#verdict-text', INCOMPLETE[key]);
      await page.click('[data-verdict-submit]');
    }
    await untilSel(page, '[data-badtoken-restart]', { timeout: 30000 });
    await tick(page, 600);
    await shot(page, `${tag}-01-dialog`);
    if (!(await page.$('.modal[role="alertdialog"]'))) problems.push(`${tag}: the bad-token dialog is not an alertdialog`);
    if (await page.$('[data-fire]:not([disabled])')) problems.push(`${tag}: 当てる (TEST) stays enabled behind the bad-token dialog`);
    if (await page.$('[data-verdict-submit]:not([disabled])')) problems.push(`${tag}: 宣告 stays enabled behind the bad-token dialog`);
    const toTitle = where === 'verdict';
    await page.click(toTitle ? '[data-badtoken-title]' : '[data-badtoken-restart]');
    for (let i = 0; i < 200; i++) {
      const h = await page.evaluate(() => location.hash);
      if (toTitle ? !h.includes('inquest') : h.includes('#/investigation')) break;
      await tick(page, 100);
      await sleep(30);
    }
    const st = await page.evaluate((id) => ({ hash: location.hash, c: window.__JD.getState().save.cases[id] }), c.id);
    if (toTitle ? st.hash.includes('inquest') : !st.hash.includes('#/investigation')) problems.push(`${tag}: did not leave the inquest (${st.hash})`);
    if (st.c?.token === bad) problems.push(`${tag}: the dead token is still in the save`);
    else if (!st.c?.token) problems.push(`${tag}: no fresh token after the restart (POST /api/token → ${JSON.stringify(tokenCalls)})`);
    if (st.c?.stage !== 'investigation') problems.push(`${tag}: stage after restart is ${st.c?.stage}`);
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/** Loading and connection-error states of the inquest (the start call held back / failing). */
async function runStatus(browser, key, sizeKey) {
  const c = CASES[key];
  const tag = `${key}-${sizeKey}-status`;
  console.log(`[inquest] ${tag}`);
  const ctx = await browser.newContext({ ...SIZES[sizeKey], locale: 'ja-JP' });
  const page = await ctx.newPage();
  watch(page, tag);
  page.on('console', (m) => {
    const i = problems.indexOf(`${tag} console: ${m.text()}`);
    if (m.type() === 'error' && /Failed to load resource|ERR_FAILED|500/.test(m.text()) && i >= 0) problems.splice(i, 1);
  });
  try {
    let release;
    const gate = new Promise((r) => (release = r));
    let mode = 'hold';
    await page.route('**/api/inquest/start', async (route) => {
      if (mode === 'hold') {
        await gate;
        return route.continue();
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'server', message: 'qa' } }) });
    });
    await open(page, c.id);
    await untilSel(page, '.iqstat--loading');
    await tick(page, 600);
    await shot(page, `${tag}-01-loading`);
    {
      // the title slot shows the real case title (from the case file) or nothing — never a placeholder
      const slot = await page.evaluate(() => [...document.querySelectorAll('.iq__top .iq__case')].map((e) => e.textContent.trim()));
      if (slot.some((t) => !t || t === '死因審問')) problems.push(`${tag}: the case title slot shows a placeholder (${JSON.stringify(slot)})`);
    }
    mode = 'fail';
    release();
    await untilSel(page, '.iq-mag, .iq-dock, .fx-cutin', { timeout: 30000 });
    // now make a reload fail
    await reload(page);
    await untilSel(page, '.iqstat--error', { timeout: 30000 });
    await tick(page, 600);
    await shot(page, `${tag}-02-error`);
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/** Reduced motion: the debate still reads and plays (no shake / flight / camera). */
async function runReduced(browser, key, sizeKey) {
  const c = CASES[key];
  const tag = `${key}-${sizeKey}-reduced`;
  console.log(`[inquest] ${tag}`);
  const ctx = await browser.newContext({ ...SIZES[sizeKey], locale: 'ja-JP', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  watch(page, tag);
  try {
    await open(page, c.id);
    await page.evaluate(() => window.__JD.setSettings({ reduceMotion: true }));
    await until(page, (s) => s.step === 'play' && s.dlg === 'off', { label: 'play' });
    await tick(page, 600);
    await shot(page, `${tag}-01-debate`);
    const round = c.debate[0];
    // switching statements never stacks two bands (the old one leaves at once)
    await page.click('.debate__dot >> nth=1');
    await tick(page, 120);
    const bands = await page.evaluate(() => document.querySelectorAll('.band').length);
    if (bands > 1) problems.push(`${tag}: ${bands} statement bands on screen at once`);
    await lockNoise(page, round, round.answer.statement, round.answer.span);
    await pickEvidence(page, round.answer.fact, sizeKey.startsWith('sp'));
    await page.click('[data-fire]');
    await untilSel(page, '.fx-cutin');
    await tick(page, 300);
    await shot(page, `${tag}-02-refute`);
    await until(page, (s) => s.step === 'success' && s.dlg === 'on', { advance: false, label: 'success' });
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const plan = [];
  if (ONLY_CASE || ONLY_SIZE) {
    for (const k of ONLY_CASE ? [ONLY_CASE] : ['c01', 'c02']) for (const sz of ONLY_SIZE ? [ONLY_SIZE] : ['pc', 'sp']) plan.push(() => runCase(browser, k, sz, { grant: k === 'c02' }));
  } else if (QUICK) {
    plan.push(() => runCase(browser, 'c01', 'pc'), () => runCase(browser, 'c01', 'sp'));
  } else {
    const full = {
      'c01-pc': () => runCase(browser, 'c01', 'pc', { reloadAfterMiss: true, reloadAtVerdict: true, safety: true, skip: true }),
      'c01-sp': () => runCase(browser, 'c01', 'sp'),
      'c02-pc': () => runCase(browser, 'c02', 'pc', { grant: true }),
      'c02-sp': () => runCase(browser, 'c02', 'sp', { grant: true }),
      'c01-pc720': () => runCase(browser, 'c01', 'pc720', { keyboard: true }),
      'c02-sp360': () => runCase(browser, 'c02', 'sp360'),
      'c02-sp320': () => runCase(browser, 'c02', 'sp320'),
      suspend: () => runSuspend(browser, 'c01', 'pc'),
      reduced: () => runReduced(browser, 'c02', 'sp'),
      'grant-pc': () => runGrant(browser, 'c01', 'pc'),
      'grant-sp': () => runGrant(browser, 'c02', 'sp'),
      'badtoken-shot': () => runBadToken(browser, 'c01', 'pc', 'shot'),
      'badtoken-verdict': () => runBadToken(browser, 'c03', 'sp', 'verdict'),
      'status-pc': () => runStatus(browser, 'c01', 'pc'),
      'status-sp': () => runStatus(browser, 'c01', 'sp'),
    };
    for (const [k, fn] of Object.entries(full)) if (!ONLY || ONLY.includes(k)) plan.push(fn);
  }
  for (const p of plan) await p();
} finally {
  await browser.close();
  server?.kill();
}

if (problems.length) {
  console.error(`\n[inquest] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n[inquest] OK — no page errors, console errors, failed flows or overflow.');
