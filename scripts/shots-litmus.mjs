// 反証 (litmus test) staging shots — the inquest's core moment, desktop 1280×800 and phone 390×844:
//   00 the round card (LITMUS TEST · ROUND 1)
//   01 a statement with its 誤差 glowing        02 the 誤差 chosen (SAMPLE), 02b a card set (当てる ready)
//   03 the set card gliding to the word          04 反応なし (a wrong card: the pad stays red)
//   05 反応あり: the red → blue bloom            06 the 「反応あり！」 cut-in (developed blue)
//   07 the reacted word (blue, struck through) under Jane's corrected memory
//   08 遊び方 → the 反証 page
// plus a reduced-motion pass on desktop (no flight, no bloom — the word and the cut-in still say it).
//   node scripts/shots-litmus.mjs [--case c05] [--size pc|sp] [--port 5231]   (another case → c01-pc-….png)
// Starts `vite --port <port> --strictPort` itself if nothing answers. Output: qa/terms/<size>-<nn>-<state>.png.
// Exit 1 on page errors, console errors, a failed flow or horizontal overflow.
// Time: the page runs on Playwright's virtual clock (GSAP, timers); CSS animations run in real time.
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
const CASE = arg('--case') ?? 'c05';
const ONLY_SIZE = arg('--size');
const PORT = Number(arg('--port') ?? process.env.LITMUS_PORT ?? 5231);
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'terms');
/** Files of the default case (c05, CASE 01) have no prefix; other cases are prefixed (c01-pc-…). */
const PREFIX = CASE === 'c05' ? '' : `${CASE}-`;
mkdirSync(out, { recursive: true });

const CASES = Object.fromEntries(
  readdirSync(resolve(root, 'content', 'cases')).map((dir) => [dir.slice(0, 3), JSON.parse(readFileSync(resolve(root, 'content', 'cases', dir, 'case.json'), 'utf8'))]),
);
/** The case id the API knows (the folder name, e.g. c05-tiptoe-milk-bottle). */
const CASE_ID = readdirSync(resolve(root, 'content', 'cases')).find((d) => d.startsWith(CASE)) ?? CASE;
const SIZES = {
  pc: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  sp: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
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
  console.log(`[litmus] starting vite on :${PORT}`);
  server = spawn(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  let ok = false;
  for (let i = 0; i < 160 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 250));
    ok = await up();
  }
  if (!ok) {
    console.error('[litmus] dev server did not start');
    server.kill();
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ helpers */
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tick(page, ms) {
  for (let t = 0; t < ms; t += 100) await page.clock.runFor(Math.min(100, ms - t));
}
async function shot(page, name, settle = 250) {
  await sleep(settle); // CSS-only animations run on real time
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.evl__list, .sheet__body, .iq-mag, .scene, .modal__body')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    }
    return res;
  });
  if (o.length) problems.push(`${name}: horizontal overflow → ${o.join(', ')}`);
  await page.screenshot({ path: resolve(out, `${PREFIX}${name}.png`), timeout: 180000 });
  console.log(`  ✓ ${PREFIX}${name}.png`);
}
const state = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.iq');
    return el
      ? { phase: el.dataset.phase, step: el.dataset.step, dlg: el.dataset.dialogue, busy: el.dataset.busy, card: el.dataset.card, cut: !!document.querySelector('.fx-cutin'), sheet: !!document.querySelector('.sheet-root') }
      : { phase: null };
  });
async function until(page, pred, { advance = true, timeout = 240000, label = 'condition', step = 120 } = {}) {
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
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(await state(page))}`);
}
async function untilSel(page, sel, { timeout = 120000, gone = false, step = 60 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const has = await page.evaluate((s) => !!document.querySelector(s), sel);
    if (has !== gone) return;
    await tick(page, step);
    await sleep(20);
  }
  throw new Error(`timeout waiting for ${gone ? 'no ' : ''}${sel}`);
}
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
async function open(page, caseId, { reduce = false } = {}) {
  await page.clock.install();
  await page.goto(`${BASE}?mute=1`, { waitUntil: 'load' });
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !!window.__JD && document.documentElement.classList.contains('app-ready'))) break;
    await tick(page, 100);
    await sleep(20);
  }
  await freeze(page);
  await page.evaluate(
    async ({ caseId, reduce }) => {
      const J = window.__JD;
      J.resetSave();
      J.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
      J.setSettings({ textSpeed: 'fast', reduceMotion: reduce });
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage: 'investigated' }) });
      const { token, progress } = await r.json();
      J.updateCase(caseId, { stage: 'inquest', token, snapshot: progress, difficulty: 'easy' });
      J.flushSave();
      J.goto('inquest', { caseId });
    },
    { caseId, reduce },
  );
}
/** Jump to a statement and choose the 誤差 that contains `span`. */
async function choose(page, round, stmtId, span, after = 150) {
  const i = round.statements.findIndex((s) => s.id === stmtId);
  await page.click(`.debate__dot >> nth=${i}`);
  await untilSel(page, `.band[data-statement-id="${stmtId}"]`);
  await tick(page, 700);
  const handles = await page.$$(`.band[data-statement-id="${stmtId}"] .noise`);
  for (const h of handles) {
    const t = await h.getAttribute('data-noise');
    if (t && (t.includes(span) || span.includes(t))) {
      await h.click({ force: true });
      await tick(page, after);
      return;
    }
  }
  throw new Error(`誤差 "${span}" not found in ${stmtId}`);
}
async function setCard(page, factId, narrow) {
  if (narrow) {
    await tick(page, 400); // choosing a 誤差 with no card set opens the drawer by itself
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
  await tick(page, 200);
}
async function wrongFact(page, round, narrow) {
  const ok = new Set([round.answer.fact, ...(round.alsoAccept ?? [])]);
  if (narrow) {
    await tick(page, 400);
    if (!(await page.$('.sheet-root'))) await page.click('[data-loaded-slot]');
    await untilSel(page, '.sheet-root [data-fact-id]');
  }
  const ids = await page.evaluate((narrow) => {
    const scope = narrow ? '.sheet-root' : '.iq-mag';
    return [...document.querySelectorAll(`${scope} [data-fact-id]`)].map((e) => e.getAttribute('data-fact-id'));
  }, narrow);
  const id = ids.find((x) => !ok.has(x));
  if (!id) throw new Error('no wrong finding to set');
  return id;
}
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel);
const check = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) problems.push(`CHECK FAILED: ${msg}`);
};

/* ------------------------------------------------------------------ flows */
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function withPage(size, fn, opts = {}) {
  const ctx = await browser.newContext({ ...SIZES[size], reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${size} console: ${m.text()}`);
  });
  try {
    await fn(page);
  } catch (e) {
    problems.push(`${size}${opts.reduce ? ' (reduced)' : ''}: ${e?.stack ?? e}`);
    await page.screenshot({ path: resolve(out, `${size}-FAILED.png`) }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

async function litmus(size) {
  const narrow = size === 'sp';
  const round = CASES[CASE].debate[0];
  const { statement, span, fact } = round.answer;
  console.log(`[litmus] ${CASE} ${size}`);
  await withPage(size, async (page) => {
    await open(page, CASE_ID);
    // 00 — the round card: LITMUS TEST · ROUND 1 / 反証 — 記憶の誤差に、所見を当てよ
    await until(page, (st) => st.card === 'on', { label: 'round card' });
    await tick(page, 800);
    await shot(page, `${size}-00-round-card`, 300);
    check(/LITMUS TEST/.test((await text(page, '.tcard__kicker')) ?? ''), `${size}: round card kicker LITMUS TEST`);
    await until(page, (st) => st.phase === 'debate' && st.step === 'play' && st.dlg === 'off' && !st.cut && st.card === 'off', { label: 'debate play' });
    const i = round.statements.findIndex((s) => s.id === statement);
    await page.click(`.debate__dot >> nth=${i}`);
    await untilSel(page, `.band[data-statement-id="${statement}"]`);
    await tick(page, 900);
    await shot(page, `${size}-01-error-glow`, 400);
    check((await text(page, '.fire__en')) === 'TEST', `${size}: the button says TEST`);
    check(/誤差を選ぶ/.test((await text(page, '.fire__jp')) ?? ''), `${size}: before a choice the button asks for a 誤差`);

    // 02 — choose the 誤差 (before the phone drawer opens)
    await choose(page, round, statement, span, 120);
    await shot(page, `${size}-02-sample`, 300);
    check(!!(await page.$('.noise.is-target')), `${size}: the chosen 誤差 is marked`);

    // 03 / 04 — a wrong card: the flight, then 反応なし
    const wrong = await wrongFact(page, round, narrow);
    await setCard(page, wrong, narrow);
    check((await text(page, '.fire__jp')) === '当てる', `${size}: with a card set the button says 当てる`);
    await shot(page, `${size}-02b-card-set`, 300);
    await page.click('[data-fire]');
    await tick(page, 300);
    await shot(page, `${size}-03-applying`, 60);
    check(!!(await page.$('.card-fly--strip')), `${size}: the set card glides as a litmus strip`);
    await untilSel(page, '.fx-noreact', { step: 50 });
    await tick(page, 250);
    await shot(page, `${size}-04-no-reaction`, 120);
    check(/反応なし/.test((await text(page, '.fx-noreact')) ?? ''), `${size}: 反応なし tag`);
    await until(page, (st) => st.step === 'play' && st.busy === 'off', { label: 'back to play after the miss' });
    await tick(page, 1600);

    // 05–07 — the right card: 反応あり
    await choose(page, round, statement, span, 150);
    await setCard(page, fact, narrow);
    await page.click('[data-fire]');
    await untilSel(page, '.fx-bloom', { step: 50 });
    await tick(page, 250);
    await shot(page, `${size}-05-reaction-bloom`, 80);
    check(!!(await page.$('.noise.is-broken')), `${size}: the tested word reacted (blue)`);
    await untilSel(page, '.fx-cutin .cutin--litmus', { step: 50 });
    await tick(page, 300);
    await shot(page, `${size}-06a-reaction-cutin-developing`, 0); // best effort: the band mid red → blue (CSS runs in real time)
    await tick(page, 200);
    await shot(page, `${size}-06-reaction-cutin`, 1100);
    check(/反応あり/.test((await text(page, '.fx-cutin .cutin__text')) ?? ''), `${size}: 反応あり！ cut-in`);
    await until(page, (st) => st.step === 'success' && st.dlg === 'on' && !st.cut, { advance: false, label: 'Jane remembers' });
    await tick(page, 1400);
    await page.evaluate(() => window.__JD.skipText());
    await tick(page, 300);
    await shot(page, `${size}-07-reacted-word`, 500);

    // 08 — 遊び方, the 反証 page
    await page.evaluate(() => window.__JD.openOverlay('howto', { page: 'LITMUS TEST' }));
    await untilSel(page, '.howto__title');
    await tick(page, 700);
    await shot(page, `${size}-08-howto`, 1500);
    check(/記憶の誤差に、所見を当てる/.test((await text(page, '.howto__title')) ?? ''), `${size}: HowTo page title`);
  });
}

async function reduced() {
  const size = 'pc';
  const round = CASES[CASE].debate[0];
  const { statement, span, fact } = round.answer;
  console.log(`[litmus] ${CASE} ${size} reduced motion`);
  await withPage(
    size,
    async (page) => {
      await open(page, CASE_ID, { reduce: true });
      await until(page, (st) => st.phase === 'debate' && st.step === 'play' && st.dlg === 'off' && !st.cut && st.card === 'off', { label: 'debate play' });
      await choose(page, round, statement, span, 150);
      await setCard(page, fact, false);
      await page.click('[data-fire]');
      await untilSel(page, '.fx-cutin .cutin--litmus', { step: 50 });
      await tick(page, 300);
      check(!(await page.$('.card-fly')), `${size} reduced: no card flight`);
      check(!(await page.$('.fx-bloom')), `${size} reduced: no bloom`);
      check(!!(await page.$('.noise.is-broken')), `${size} reduced: the word still turns blue`);
      await shot(page, `${size}-rm-06-reaction-cutin`, 400);
    },
    { reduce: true },
  );
}

try {
  for (const size of ['pc', 'sp']) if (!ONLY_SIZE || ONLY_SIZE === size) await litmus(size);
  if (!ONLY_SIZE || ONLY_SIZE === 'pc') await reduced();
} finally {
  await browser.close();
  server?.kill();
}
if (problems.length) {
  console.error(`\n[litmus] ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\n[litmus] OK');
