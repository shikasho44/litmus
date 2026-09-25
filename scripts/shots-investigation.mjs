// Investigation + Intro QA: plays CASE 01 from the files screen and screenshots every state.
//
//   node scripts/shots-investigation.mjs              uses a dev server on :5191 (starts one if absent, stops it after)
//   node scripts/shots-investigation.mjs --port 5190  another port
//   node scripts/shots-investigation.mjs --only pc    pc | sp | small (1280x720, 360x740, 320x640) | prologue
//   node scripts/shots-investigation.mjs --swiftshader  launch Chromium with the SwiftShader GL flags
//                                                     (renders the same, but screenshots take 3–15 s each,
//                                                     so transient moments — stamps, cut-ins — may be missed)
//
// Output: qa/investigation/<nn>-<state>-<size>.png + a summary. Exit 1 on page errors, unexpected
// console errors, failed checks or horizontal overflow. Needs the API (vite dev server), rules mode is fine.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = Number(arg('port', process.env.SHOTS_PORT || 5191));
const ONLY = arg('only', '');
const SWIFT = argv.includes('--swiftshader');
const BASE = `http://127.0.0.1:${PORT}/`;
const CASE = 'c01-room-without-breath';
const out = resolve(root, 'qa', 'investigation');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.png') && (!ONLY || f.includes(`-${ONLY}`))) rmSync(resolve(out, f));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const notes = [];
const check = (cond, msg) => {
  if (!cond) problems.push(`CHECK FAILED: ${msg}`);
  else console.log(`  ✓ ${msg}`);
};

/* ---------------- server ---------------- */
async function reachable() {
  try {
    return (await fetch(`${BASE}api/health`)).ok;
  } catch {
    return false;
  }
}
let server = null;
if (!(await reachable())) {
  console.log(`[shots] starting vite on :${PORT}`);
  const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    up = await reachable();
    if (!up) await wait(250);
  }
  if (!up) {
    console.error('[shots] server did not start');
    server.kill();
    process.exit(1);
  }
}

/* ---------------- helpers ---------------- */
let expectNetErrors = false;
function attach(page, tag) {
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (expectNetErrors && /Failed to load resource|ERR_FAILED|status of (401|429)/.test(t)) return;
    problems.push(`${tag} console: ${t}`);
  });
}
async function ready(page) {
  await page.waitForFunction(() => window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 120000 });
  await page.evaluate(() => window.__JD.idle());
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(out, `${name}.png`), timeout: 120000 });
  console.log(`  📷 ${name}.png`);
}
async function settled(page, timeout = 90000) {
  await page.waitForFunction(
    () => !document.querySelector('.iv.is-presenting') && !document.querySelector('.dock.is-busy') && !document.querySelector('.flight') && !document.querySelector('.fx-cutin'),
    null,
    { timeout },
  );
  await wait(250);
}
async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.scene, .chat__scroll, .sl__bottom, .sheet__body, .nb__body, .modal__body, .dock')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    }
    return res;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}
async function type(page, q) {
  const ta = page.locator('.dock__input');
  await ta.click();
  await ta.fill(q);
}
/** Types + sends a question; returns once the response arrived (presentation starts). */
async function send(page, q) {
  await type(page, q);
  await page.locator('.dock__input').press('Enter');
  await page.waitForFunction(() => !!document.querySelector('.iv.is-presenting') || !!document.querySelector('.arow--error'), null, { timeout: 30000 });
}
const rowCount = (page) => page.evaluate(() => document.querySelectorAll('.chat__row').length);
const lastAnswer = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('.arow[data-answer]')];
    const r = rows[rows.length - 1];
    return r ? { cls: r.getAttribute('data-answer'), text: r.querySelector('.arow__line')?.textContent ?? '', cards: r.querySelectorAll('.fchip').length, support: r.classList.contains('is-support'), memo: r.querySelectorAll('.memo').length } : null;
  });
/** The start of the newest exchange (question / hint / error row) is inside the chat viewport. */
const newestExchangeVisible = (page) =>
  page.evaluate(() => {
    const sc = document.querySelector('.chat__scroll');
    const starts = [...document.querySelectorAll('.chat__inner > .chat__row[data-start]')];
    const a = starts[starts.length - 1];
    if (!sc || !a) return { ok: false, why: 'no rows' };
    const s = sc.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    return { ok: r.top >= s.top - 1 && r.top < s.bottom - 20, top: Math.round(r.top - s.top), h: Math.round(s.height) };
  });

/** One-shot interception of the next /api/ask. mode: abort | 429 | 401 | inject */
async function interceptAsk(page, mode, inject) {
  let n = 0;
  const handler = async (route) => {
    n++;
    if (mode === 'abort') {
      await route.abort('failed');
      if (n >= 2) await page.unroute('**/api/ask', handler); // the http client retries once
      return;
    }
    if (mode === '429') await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rate_limited', message: 'slow down', retryable: false } }) });
    else if (mode === '401') await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'bad_token', message: 'bad token', retryable: false } }) });
    else {
      const resp = await route.fetch();
      const json = await resp.json();
      inject(json);
      await route.fulfill({ response: resp, json });
    }
    await page.unroute('**/api/ask', handler);
  };
  await page.route('**/api/ask', handler);
}

async function freshApp(page, extra = '') {
  // generous: a cold dev server on a busy machine can take a while to transform the app
  await page.goto(`${BASE}?debug=1&mute=1${extra}`, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await ready(page);
  // the coach-mark tutorial has its own shots (scripts/shots-modes.mjs)
  await page.evaluate(() => window.__JD.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } }));
}
async function openFromFiles(page, tag, n) {
  await page.evaluate(() => window.__JD.goto('files'));
  await page.evaluate(() => window.__JD.idle());
  await page.waitForSelector('.tag__open', { timeout: 30000 });
  await wait(1200);
  await shot(page, `${n}-files-${tag}`);
  await page.locator('.tag__open').first().click();
  // a fresh case asks for the difficulty first (審問官 = the default choice)
  await page.waitForSelector('[data-difficulty-confirm]', { timeout: 30000 });
  await wait(600);
  await page.click('[data-difficulty-confirm]');
  await page.waitForSelector('.intro', { timeout: 30000 });
}
async function waitInvestigation(page) {
  await page.waitForSelector('.iv .dock__input', { timeout: 60000 });
  await page.evaluate(() => window.__JD.idle());
  await wait(900);
}

const browser = await chromium.launch({
  headless: true,
  args: SWIFT ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [],
});

/* ================================================================== */
/* PC 1440x900 — full intro (not skipped) + every investigation state  */
/* ================================================================== */
async function runPc() {
  const tag = 'pc';
  console.log('[shots] PC 1440x900');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP' });
  const page = await ctx.newPage();
  attach(page, tag);
  await freshApp(page);
  await openFromFiles(page, tag, '01');

  // ---- intro, watched in full
  await page.waitForSelector('.itc__num', { timeout: 30000 });
  await wait(1300);
  await shot(page, `02-intro-slam-${tag}`);
  // a slow screenshot can outlast the whole title card (≈5 s): then it has already moved on
  if (await page.$('.intro.is-title')) {
    await page.locator('.intro__stage').click({ position: { x: 700, y: 450 } });
    await page.waitForSelector('.itc__continue, .intro.is-narration');
  }
  if (await page.$('.itc__continue')) {
    await shot(page, `03-intro-titlecard-${tag}`);
    await page.locator('.intro__stage').click({ position: { x: 700, y: 450 } });
  } else notes.push('the title card had already advanced after the slam shot (slow screenshot) — no 03-intro-titlecard shot');
  await page.waitForSelector('.intro.is-narration');
  await wait(1600);
  await page.evaluate(() => window.__JD.skipText());
  await wait(200);
  await shot(page, `04-intro-narration-${tag}`);
  for (let i = 0; i < 20 && !(await page.$('.intro.is-jane')); i++) {
    await page.evaluate(() => window.__JD.skipText());
    await page.keyboard.press('Enter');
    await wait(260);
  }
  await wait(1400);
  await page.evaluate(() => window.__JD.skipText());
  await wait(200);
  await shot(page, `05-intro-jane-${tag}`);
  for (let i = 0; i < 20 && !(await page.$('.intro.is-holma')); i++) {
    await page.evaluate(() => window.__JD.skipText());
    await page.keyboard.press('Enter');
    await wait(260);
  }
  await wait(900);
  await page.evaluate(() => window.__JD.skipText());
  await wait(200);
  await shot(page, `06-intro-holma-${tag}`);
  for (let i = 0; i < 20 && !(await page.$('.icc')); i++) {
    await page.evaluate(() => window.__JD.skipText());
    await page.keyboard.press('Enter');
    await wait(260);
  }
  await wait(750);
  await shot(page, `07-intro-catchphrase-${tag}`);
  await waitInvestigation(page);
  const tok = await page.evaluate((id) => window.__JD.getState().save.cases[id]?.token, CASE);
  check(!!tok, 'intro created the case token (api.newToken)');
  check((await page.evaluate((id) => window.__JD.getState().save.cases[id]?.stage, CASE)) === 'investigation', 'stage = investigation after the intro');
  await shot(page, `08-inv-empty-${tag}`);
  await overflow(page, `${tag} empty`);

  // ---- starter chip fills (does not send)
  await page.locator('.dock__chip').first().click();
  await wait(300);
  const filled = await page.locator('.dock__input').inputValue();
  check(filled.length > 0 && (await rowCount(page)) === 0, 'starter chip fills the input without sending');
  await shot(page, `09-chip-filled-${tag}`);

  // ---- a) NO + finding (sent from the chip)
  await page.locator('.dock__input').press('Enter');
  await page.waitForSelector('.fx-stamp', { state: 'attached', timeout: 30000 });
  await wait(300);
  await shot(page, `10-stamp-no-${tag}`);
  await settled(page);
  check((await lastAnswer(page))?.cls === 'no', 'answer: いいえ (murder? → no)');
  await shot(page, `11-answer-no-${tag}`);

  // ---- b) YES + finding: cut-in → card flight → shards
  await send(page, 'スマホに通知が届いていましたか？');
  await page.waitForSelector('.fx-cutin', { timeout: 30000 });
  await wait(250);
  await shot(page, `12-finding-cutin-${tag}`);
  // the cut-in screenshot can outlast the flight on a busy machine: note it, do not fail
  await page.waitForSelector('.flight', { state: 'attached', timeout: 15000 }).catch(() => notes.push(`missed the '.flight' moment after the cut-in shot (slow screenshot)`));
  await wait(350);
  await shot(page, `13-finding-flight-${tag}`);
  await settled(page);
  const b = await lastAnswer(page);
  check(b?.cls === 'yes' && b.cards === 1, 'answer: はい + 1 finding chip inline');
  const ex = await newestExchangeVisible(page);
  check(ex.ok, `newest question row in view after a finding (top ${ex.top}px of ${ex.h}px)`);
  await shot(page, `14-finding-done-${tag}`);
  // the chip opens the full card in place
  await page.locator('.arow[data-answer]').last().locator('.fchip__btn').first().click();
  await wait(450);
  check(!!(await page.$('.fchip.is-open .ev')), 'finding chip opens the full card');
  await shot(page, `14b-finding-chip-open-${tag}`);
  await page.locator('.arow[data-answer]').last().locator('.fchip__btn').first().click();
  await wait(200);

  // ---- c) irrelevant, d) vague
  await send(page, 'コーヒーはブラックでしたか？');
  await settled(page);
  check((await lastAnswer(page))?.cls === 'irrelevant', 'answer: 関係ない');
  await shot(page, `15-irrelevant-${tag}`);
  await send(page, '何か変わったことはありましたか？');
  await settled(page);
  check((await lastAnswer(page))?.cls === 'vague', 'answer: もう少し具体的に');
  await shot(page, `16-vague-${tag}`);

  // ---- e) CORE finding
  await send(page, 'ホースがつながったままでしたか？');
  await page.waitForSelector('.fx-cutin', { timeout: 30000 });
  await wait(420);
  await shot(page, `17-core-cutin-${tag}`);
  // the cut-in screenshot can outlast the flight on a busy machine: note it, do not fail
  await page.waitForSelector('.flight.is-core', { state: 'attached', timeout: 15000 }).catch(() => notes.push(`missed the '.flight.is-core' moment after the cut-in shot (slow screenshot)`));
  await wait(400);
  await shot(page, `18-core-flight-${tag}`);
  await settled(page);
  await shot(page, `19-core-done-${tag}`);

  // ---- f) multi-question → split answers
  const before = await page.evaluate(() => document.querySelectorAll('.arow[data-answer]').length);
  await send(page, '毒ですか？それとも病気ですか？');
  await settled(page);
  const after = await page.evaluate(() => document.querySelectorAll('.arow[data-answer]').length);
  check(after - before === 2 && (await page.$$('.arow__q')).length >= 2, 'multi-question answered per atomic question (2 rows)');
  await shot(page, `20-multi-${tag}`);

  // ---- g) nearCore
  await send(page, '酸欠ですか？');
  await wait(900);
  await shot(page, `21-nearcore-${tag}`);
  await settled(page);
  check(await page.$('.ivs.is-near'), 'nearCore state lit on stage');
  check(!!(await page.$('.ivs__near')), "persistent 「核心に迫っている」 tag on stage");
  const nearRows = await page.evaluate((id) => window.__JD.getState().save.cases[id].log.filter((e) => e.kind === 'answer' && e.nearCore).length, CASE);
  check(nearRows >= 1 && !!(await page.$('.arow.is-near .arow__near')), `nearCore answer marked ★ in the log (${nearRows})`);
  await shot(page, `22-nearcore-done-${tag}`);

  // ---- h) findings + science memo (F31 is CORE → it keeps the full cut-in)
  await send(page, '壁の酸素濃度計の電池は切れていましたか？');
  const t0 = Date.now();
  await page.waitForSelector('.flight', { state: 'attached', timeout: 30000 });
  check(!(await page.$('.flight.is-compact')), 'a CORE finding keeps the full treatment (cut-in + full flight)');
  await wait(300);
  await shot(page, `23-memo-flight-${tag}`);
  await settled(page);
  notes.push(`core finding: presentation ran ${((Date.now() - t0 - 250) / 1000).toFixed(1)} s (answer received → settled)`);
  const h = await lastAnswer(page);
  check((h?.cards ?? 0) >= 1 && (h?.memo ?? 0) >= 1, `finding chip(s) + a science memo inline (${h?.cards} chip(s))`);
  await shot(page, `24-cards-memo-${tag}`);

  // ---- h1) an ordinary finding after the first reveals → compact flight, no cut-in
  await send(page, '部屋は狭いですか？');
  const tc = Date.now();
  const sawCut = page.waitForSelector('.fx-cutin', { state: 'attached', timeout: 4000 }).then(() => true, () => false);
  await page.waitForSelector('.flight', { state: 'attached', timeout: 30000 });
  check(!!(await page.$('.flight.is-compact')), 'after the first reveals, ordinary findings use the compact flight');
  await wait(250);
  await shot(page, `23b-compact-flight-${tag}`);
  await settled(page);
  check(!(await sawCut), 'compact finding: no 所見入手 cut-in');
  notes.push(`compact (ordinary) finding: presentation ran ${((Date.now() - tc - 250) / 1000).toFixed(1)} s (answer received → settled)`);

  // ---- h2) Enter during the presentation with a question typed: fast-forward + send it after
  const qBefore = await page.evaluate((id) => window.__JD.getState().save.cases[id].log.filter((e) => e.kind === 'question').length, CASE);
  await send(page, '扉は自動で閉まりますか？');
  await type(page, '部屋に誰かいましたか？');
  await page.locator('.dock__input').press('Enter');
  await wait(120);
  const queuedShown = !!(await page.$('.dock.is-queued'));
  await page
    .waitForFunction(([id, n]) => window.__JD.getState().save.cases[id].log.filter((e) => e.kind === 'question').length >= n + 2, [CASE, qBefore], { timeout: 30000, polling: 100 })
    .catch(() => {});
  await settled(page);
  const qAfter = await page.evaluate((id) => window.__JD.getState().save.cases[id].log.filter((e) => e.kind === 'question').length, CASE);
  check(qAfter - qBefore === 2 && (await page.locator('.dock__input').inputValue()) === '', `Enter during the presentation queues the typed question (sent without a 2nd Enter${queuedShown ? ', queued state shown' : ''})`);
  await shot(page, `24b-queued-sent-${tag}`);

  // ---- i) safety → support card
  let realSupport = false;
  await interceptAsk(page, 'inject', (json) => {
    realSupport = json.answers?.some((a) => a.notice === 'support');
    if (!realSupport) {
      // engine safety filter not active yet → inject the contract notice to verify the UI
      json.answers[0].notice = 'support';
      json.answers[0].mood = 'serious';
    }
  });
  await send(page, '死にたいです');
  await settled(page);
  if (!realSupport) notes.push("safety question: the server did not return notice 'support' (engine filter pending) — the support card was verified with an injected notice");
  const sup = await page.evaluate(() => {
    const a = document.querySelector('.support__link');
    return a ? a.getAttribute('href') : null;
  });
  check(sup === 'https://www.mhlw.go.jp/mamorouyokokoro/', 'support card with the MHLW consultation link');
  await shot(page, `25-support-${tag}`);

  // ---- j) degraded badge
  await interceptAsk(page, 'inject', (json) => (json.answers[0].notice = 'degraded'));
  await send(page, '部屋は寒かったですか？');
  await settled(page);
  check(!!(await page.$('.arow__badge')), "'degraded' notice → small 簡易判定 badge");
  await shot(page, `26-degraded-${tag}`);

  // ---- k) network error → Holma error line + retry; question stays in the input
  expectNetErrors = true;
  await interceptAsk(page, 'abort');
  await type(page, '換気扇は回っていましたか？');
  await page.locator('.dock__input').press('Enter');
  await page.waitForSelector('.arow--error', { timeout: 30000 });
  await wait(300);
  check((await page.locator('.dock__input').inputValue()) === '換気扇は回っていましたか？', 'network error keeps the question in the input');
  const errVis = await newestExchangeVisible(page);
  check(errVis.ok && !!(await page.$('.dock__alert')), `network error row scrolled into view + inline alert above the dock (top ${errVis.top}px)`);
  await shot(page, `27-network-error-${tag}`);
  await page.locator('.arow__retry').click();
  await settled(page);
  check((await lastAnswer(page))?.cls === 'no' && !(await page.$('.arow--error')), 'retry sends it again and gets the answer');
  await shot(page, `28-retry-ok-${tag}`);

  // ---- l) rate limited
  await interceptAsk(page, '429');
  await type(page, '部屋に窓はありましたか？');
  await page.locator('.dock__input').press('Enter');
  await page.waitForSelector('.arow--error.is-rate', { timeout: 30000 });
  await wait(300);
  check(await page.locator('.dock__send').isDisabled(), 'rate limited → send waits (countdown)');
  await shot(page, `29-rate-limited-${tag}`);
  expectNetErrors = false;
  await page.locator('.dock__input').fill('');

  // ---- IME: Enter while composing must not send
  const ime = await page.evaluate(async () => {
    const ta = document.querySelector('.dock__input');
    ta.focus();
    const rows = document.querySelectorAll('.chat__row').length;
    ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
    ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { sent: document.querySelectorAll('.chat__row').length !== rows || !!document.querySelector('.dock.is-busy') };
  });
  check(!ime.sent, 'IME: Enter during composition does not send');

  // ---- hint: confirm → whisper
  await page.keyboard.press('Escape');
  await page.locator('.ivtop__hint').click();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await wait(400);
  await shot(page, `30-hint-confirm-${tag}`);
  await page.locator('.modal .btn--primary').click();
  await page.waitForSelector('.whisper', { timeout: 30000 });
  await wait(1200);
  await page.evaluate(() => window.__JD.skipText());
  await wait(300);
  await shot(page, `31-hint-whisper-${tag}`);
  await page.locator('.whisper__close').click();
  await wait(400);
  check((await page.$$('.hrow')).length === 1, 'hint recorded in the chat log');

  // ---- notebook (PC side panel)
  await page.locator('.nb--side .tab', { hasText: '所見' }).click();
  await wait(500);
  await shot(page, `32-notebook-facts-${tag}`);
  await page.locator('.nb--side .tab', { hasText: '質問ログ' }).click();
  await wait(400);
  await shot(page, `33-notebook-log-${tag}`);
  if (await page.$('.nb--side .nb-filter--core')) {
    await page.locator('.nb--side .nb-filter--core').click();
    await wait(300);
    const coreRows = await page.$$eval('.nb--side .nb-row.is-near', (els) => els.length);
    check(coreRows >= 1, `質問ログ ★核心 filter shows the confirmed core question(s) (${coreRows})`);
    await shot(page, `33b-notebook-log-core-${tag}`);
    await page.locator('.nb--side .nb-filter--all').click();
  } else problems.push('notebook log: no ★核心 filter chip after a nearCore answer');
  await page.locator('.nb--side .nb-filter--no').click();
  await page.locator('.nb--side .nb-search input').fill('毒');
  await wait(400);
  const filtered = await page.$$eval('.nb--side .nb-row', (els) => els.length);
  check(filtered >= 1, `notebook log filter (いいえ) + search 「毒」 → ${filtered} row(s)`);
  await shot(page, `34-notebook-log-filtered-${tag}`);
  await page.locator('.nb--side .tab', { hasText: '科学メモ' }).click();
  await wait(400);
  await shot(page, `35-notebook-memos-${tag}`);
  await page.locator('.nb--side .tab', { hasText: '所見' }).click();
  await page.locator('.dock__input').blur();
  await page.locator('body').press('n');
  await wait(700);
  await shot(page, `36-notebook-collapsed-${tag}`);
  await page.locator('body').press('n');
  await wait(600);

  // ---- inquest confirm + menu
  await page.locator('.ivtop__inquest').click();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await wait(400);
  await shot(page, `37-inquest-confirm-${tag}`);
  await page.keyboard.press('Escape');
  await wait(400);
  await page.locator('.ivtop .ibtn').first().click();
  await page.waitForSelector('.ivmenu', { timeout: 10000 });
  await wait(300);
  await shot(page, `38-menu-${tag}`);
  await page.keyboard.press('Escape');
  await wait(300);

  // ---- '/' focuses the input
  await page.locator('body').click({ position: { x: 5, y: 895 } });
  await page.keyboard.press('/');
  check(await page.evaluate(() => document.activeElement?.classList.contains('dock__input')), "'/' focuses the question input");
  await page.keyboard.press('Escape');

  // ---- reload → resume exactly; idle line
  const rowsBefore = await rowCount(page);
  const saveBefore = await page.evaluate((id) => {
    const c = window.__JD.getState().save.cases[id];
    return { log: c.log.length, facts: c.factOrder.length, memos: Object.keys(c.memos).length, hints: c.hints.length, token: c.token };
  }, CASE);
  await page.evaluate(() => window.__JD.flushSave());
  await page.goto(`${BASE}?debug=1&mute=1&idlems=4000#/investigation/${CASE}`, { waitUntil: 'load', timeout: 180000 });
  await ready(page);
  await waitInvestigation(page);
  const saveAfter = await page.evaluate((id) => {
    const c = window.__JD.getState().save.cases[id];
    return { log: c.log.length, facts: c.factOrder.length, memos: Object.keys(c.memos).length, hints: c.hints.length, token: c.token };
  }, CASE);
  check(JSON.stringify(saveBefore) === JSON.stringify(saveAfter), 'reload keeps log / findings / memos / hints / token');
  check((await rowCount(page)) === rowsBefore - 1 || (await rowCount(page)) >= rowsBefore - 2, `chat rows restored (${await rowCount(page)} vs ${rowsBefore}, transient error row excluded)`);
  await shot(page, `39-resumed-${tag}`);
  await page.waitForSelector('.ivs__bubble', { timeout: 20000 });
  await wait(300);
  await shot(page, `40-idle-line-${tag}`);
  await overflow(page, `${tag} resumed`);
  await ctx.close();
}

/* ================================================================== */
/* Phone 390x844 — intro skipped, core loop, sheet notebook, bad token  */
/* ================================================================== */
async function runSp() {
  const tag = 'sp';
  console.log('[shots] SP 390x844');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
  const page = await ctx.newPage();
  attach(page, tag);
  await freshApp(page);
  await openFromFiles(page, tag, '01');
  await page.waitForSelector('.itc__num', { timeout: 30000 });
  await wait(1500);
  await shot(page, `02-intro-slam-${tag}`);
  if (await page.$('.intro.is-title')) {
    await page.locator('.intro__stage').tap({ position: { x: 195, y: 400 } });
    await page.waitForSelector('.itc__continue, .intro.is-narration');
  }
  if (await page.$('.itc__continue')) {
    await shot(page, `03-intro-titlecard-${tag}`);
    // watch a little, then skip
    await page.locator('.intro__stage').tap({ position: { x: 195, y: 400 } });
  } else notes.push('phone: the title card had already advanced after the slam shot (slow screenshot)');
  await page.waitForSelector('.intro.is-narration');
  await wait(1500);
  await page.evaluate(() => window.__JD.skipText());
  await shot(page, `04-intro-narration-${tag}`);
  for (let i = 0; i < 20 && !(await page.$('.intro.is-jane')); i++) {
    await page.evaluate(() => window.__JD.skipText());
    await page.locator('.intro__stage').tap({ position: { x: 195, y: 300 } });
    await wait(260);
  }
  await wait(1400);
  await page.evaluate(() => window.__JD.skipText());
  await shot(page, `05-intro-jane-${tag}`);
  for (let i = 0; i < 20 && !(await page.$('.intro.is-holma')); i++) {
    await page.evaluate(() => window.__JD.skipText());
    await page.locator('.intro__stage').tap({ position: { x: 195, y: 300 } });
    await wait(260);
  }
  await wait(900);
  await page.evaluate(() => window.__JD.skipText());
  await shot(page, `06-intro-holma-${tag}`);
  await page.locator('.intro__skip').tap();
  await page.waitForSelector('.icc', { timeout: 10000 });
  await wait(750);
  await shot(page, `07-intro-catchphrase-${tag}`);
  await waitInvestigation(page);
  await shot(page, `08-inv-empty-${tag}`);
  await overflow(page, `${tag} empty`);

  await page.locator('.dock__chip').nth(1).tap();
  await wait(300);
  await shot(page, `09-chip-filled-${tag}`);
  await page.locator('.dock__send').tap();
  await page.waitForSelector('.fx-stamp', { state: 'attached', timeout: 30000 });
  await wait(300);
  await shot(page, `10-stamp-${tag}`);
  await settled(page);
  await shot(page, `11-answer-${tag}`);

  await send(page, 'ホースがつながったままでしたか？');
  await page.waitForSelector('.fx-cutin', { timeout: 30000 });
  await wait(420);
  await shot(page, `17-core-cutin-${tag}`);
  // the cut-in screenshot can outlast the flight on a busy machine: note it, do not fail
  await page.waitForSelector('.flight', { state: 'attached', timeout: 15000 }).catch(() => notes.push(`missed the '.flight' moment after the cut-in shot (slow screenshot)`));
  await wait(420);
  await shot(page, `18-core-flight-${tag}`);
  await settled(page);
  const spEx = await newestExchangeVisible(page);
  check(spEx.ok, `phone: question + stamp row of the core answer in view (top ${spEx.top}px of ${spEx.h}px)`);
  await shot(page, `19-core-done-${tag}`);

  await send(page, '毒ですか？それとも病気ですか？');
  await settled(page);
  const spMulti = await newestExchangeVisible(page);
  check(spMulti.ok, `phone: multi-answer exchange starts in view (top ${spMulti.top}px)`);
  await shot(page, `20-multi-${tag}`);
  await send(page, '酸欠ですか？');
  await settled(page);
  await shot(page, `22-nearcore-done-${tag}`);

  await interceptAsk(page, 'inject', (json) => {
    if (!json.answers?.some((a) => a.notice === 'support')) {
      json.answers[0].notice = 'support';
      json.answers[0].mood = 'serious';
    }
  });
  await send(page, '死にたいです');
  await settled(page);
  await shot(page, `25-support-${tag}`);

  // keyboard open simulation is not possible headless; check dock sits inside the viewport
  const dockBox = await page.locator('.dock').boundingBox();
  check(dockBox && dockBox.y + dockBox.height <= 844 + 1, 'dock fully visible at the bottom');

  // hint → whisper
  await page.locator('.ivtop__hint').tap();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await wait(400);
  await shot(page, `30-hint-confirm-${tag}`);
  await page.locator('.modal .btn--primary').tap();
  await page.waitForSelector('.whisper', { timeout: 30000 });
  await wait(1200);
  await page.evaluate(() => window.__JD.skipText());
  await wait(300);
  await shot(page, `31-hint-whisper-${tag}`);
  await page.locator('.whisper__close').tap();
  await wait(400);

  // notebook sheet
  await page.locator('.ivtop__nb').tap();
  await page.waitForSelector('.sheet .nb', { timeout: 10000 });
  await wait(600);
  await shot(page, `32-notebook-facts-${tag}`);
  await overflow(page, `${tag} notebook`);
  await page.locator('.sheet .tab', { hasText: '質問ログ' }).tap();
  await wait(400);
  await shot(page, `33-notebook-log-${tag}`);
  await page.locator('.sheet .tab', { hasText: '科学メモ' }).tap();
  await wait(400);
  await shot(page, `35-notebook-memos-${tag}`);
  await page.locator('.sheet .ibtn').last().tap();
  await wait(500);

  await page.locator('.ivtop__inquest').tap();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await wait(400);
  await shot(page, `37-inquest-confirm-${tag}`);
  await page.locator('.modal .btn--ghost').first().tap();
  await wait(400);

  // reload → resume
  const n = await rowCount(page);
  await page.evaluate(() => window.__JD.flushSave());
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await waitInvestigation(page);
  check((await rowCount(page)) === n, `phone reload resumes the conversation (${n} rows)`);
  await shot(page, `39-resumed-${tag}`);

  // bad token → the player decides (dialog); nothing is wiped before that
  expectNetErrors = true;
  const oldTok = await page.evaluate((id) => window.__JD.getState().save.cases[id].token, CASE);
  const oldQs = await page.evaluate((id) => window.__JD.getState().save.cases[id].log.filter((e) => e.kind === 'question').length, CASE);
  await interceptAsk(page, '401');
  await type(page, '部屋は狭いですか？');
  await page.locator('.dock__input').press('Enter');
  await page.waitForSelector('.ivdlg--token', { timeout: 20000 });
  await wait(500);
  const kept = await page.evaluate((id) => window.__JD.getState().save.cases[id], CASE);
  check(kept.token === oldTok && kept.log.filter((e) => e.kind === 'question').length === oldQs, 'bad_token → dialog first; the case is untouched until the player chooses');
  await shot(page, `41-bad-token-dialog-${tag}`);
  await page.locator('.modal-root button', { hasText: '最初からやり直す' }).tap();
  await page.waitForFunction(([id, t]) => {
    const c = window.__JD.getState().save.cases[id];
    return !!c.token && c.token !== t;
  }, [CASE, oldTok], { timeout: 20000 });
  await wait(900);
  const after = await page.evaluate((id) => window.__JD.getState().save.cases[id], CASE);
  check(
    after.token !== oldTok && (await page.locator('.dock__input').inputValue()) === '部屋は狭いですか？' && after.previousAttempt?.log?.filter((e) => e.kind === 'question').length === oldQs,
    `start over → new token, question kept, previous attempt backed up (${after.previousAttempt?.log?.length ?? 0} log entries)`,
  );
  await shot(page, `41b-bad-token-restarted-${tag}`);
  expectNetErrors = false;
  await page.locator('.ivtop__nb').tap();
  await page.waitForSelector('.sheet .nb', { timeout: 10000 });
  await page.locator('.sheet .tab', { hasText: '質問ログ' }).tap();
  await wait(300);
  if (await page.$('.sheet .nb-prev')) {
    await page.locator('.sheet .nb-prev__sum').tap();
    await wait(300);
  } else problems.push('notebook: 前回の記録 missing after a restart');
  await shot(page, `42-notebook-previous-attempt-${tag}`);
  await page.locator('.sheet .tab', { hasText: '所見' }).tap();
  await wait(300);
  await shot(page, `43-notebook-facts-after-restart-${tag}`);
  await ctx.close();
}

/* ================================================================== */
/* Other sizes: 1280x720, 360x740, 320x640                             */
/* ================================================================== */
async function runSmall() {
  for (const [tag, vp, mobile] of [
    ['pc720', { width: 1280, height: 720 }, false],
    ['pc1920', { width: 1920, height: 1080 }, false],
    ['sp360', { width: 360, height: 740 }, true],
    ['sp320', { width: 320, height: 640 }, true],
  ]) {
    console.log(`[shots] ${tag} ${vp.width}x${vp.height}`);
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'ja-JP' });
    const page = await ctx.newPage();
    attach(page, tag);
    await freshApp(page);
    if (tag === 'pc1920') {
      // the notebook before the case record exists: hold the new token back (well under the
      // client's 11 s timeout), look at the empty state, then start over for the normal flow
      let releaseToken = () => {};
      const tokenGate = new Promise((r) => (releaseToken = r));
      const holdToken = async (route) => (await Promise.race([tokenGate, wait(8000)]), route.continue());
      await page.route('**/api/token', holdToken);
      await page.evaluate((id) => window.__JD.goto('investigation', { caseId: id }), CASE);
      await page.waitForSelector('.iv .dock__input', { timeout: 30000 });
      await wait(700);
      check(!!(await page.$('.nb--side .nb-start__chip')), `${tag}: empty notebook shows the 「最初の一問を」 state with example chips`);
      await shot(page, `08b-notebook-empty-state-${tag}`);
      await page.locator('.nb--side .nb-start__chip').first().click();
      await wait(200);
      check((await page.locator('.dock__input').inputValue()).length > 0, `${tag}: an example chip in the notebook fills the input`);
      releaseToken();
      // on a busy machine the held request may already have hit the client's 11 s timeout (the
      // next question would fetch a token again); the page is reset right below either way
      await page
        .waitForFunction((id) => !!window.__JD.getState().save.cases[id]?.token, CASE, { timeout: 20000 })
        .catch(() => notes.push(`${tag}: the held token request timed out client-side (slow machine) — not needed for the rest`));
      await page.unroute('**/api/token', holdToken);
      await freshApp(page);
    }
    await page.evaluate((id) => window.__JD.goto('intro', { caseId: id }), CASE);
    await page.waitForSelector('.itc__num', { timeout: 30000 });
    await wait(1200);
    await page.locator('.intro__stage').click({ position: { x: vp.width / 2, y: vp.height / 2 } });
    await page.waitForSelector('.itc__continue, .intro.is-narration');
    if (await page.$('.itc__continue')) {
      await shot(page, `03-intro-titlecard-${tag}`);
      await overflow(page, `${tag} intro`);
    } else notes.push(`${tag}: the title card had already advanced (slow machine) — no title card shot`);
    await page.locator('.intro__skip').click();
    await waitInvestigation(page);
    await shot(page, `08-inv-empty-${tag}`);
    await overflow(page, `${tag} empty`);
    for (const [i, q] of ['スマホに通知が届いていましたか？', 'ホースがつながったままでしたか？', '毒ですか？それとも病気ですか？'].entries()) {
      await send(page, q);
      if (i === 0) {
        // the judgement stamp stays inside the stage frame (measured at the end of the slam)
        const fitP = page.evaluate(
          () =>
            new Promise((res) => {
              // the resting size = the smallest box seen while the stamp is on screen (the slam
              // starts oversized on purpose; a busy machine may render it late)
              const t0 = performance.now();
              let seenAt = 0;
              let best = null;
              const tick = () => {
                const f = document.querySelector('.fx-stamp .stamp__frame');
                const now = performance.now();
                if (f && !seenAt) seenAt = now;
                if (f) {
                  const s = f.getBoundingClientRect();
                  const st = document.querySelector('[data-stage]').getBoundingClientRect();
                  const m = { s: Math.round(s.height), st: Math.round(st.height), inside: s.top >= st.top - 2 && s.bottom <= st.bottom + 2 };
                  if (!best || m.s < best.s) best = m;
                }
                if ((!f && seenAt) || now - t0 > 8000) return res(best);
                requestAnimationFrame(tick);
              };
              tick();
            }),
        );
        await wait(500);
        await shot(page, `10-stamp-${tag}`);
        const fit = await fitP;
        check(!!fit && fit.inside, `${tag}: judgement stamp fits the stage (${fit?.s}px in ${fit?.st}px)`);
      }
      await settled(page);
      if (i === 1) {
        const ex = await newestExchangeVisible(page);
        check(ex.ok, `${tag}: newest question row in view after a core finding (top ${ex.top}px of ${ex.h}px)`);
      }
    }
    await shot(page, `19-after-questions-${tag}`);
    await overflow(page, `${tag} after questions`);
    await page.locator('.ivtop__nb').click();
    await wait(700);
    await shot(page, `32-notebook-${tag}`);
    await overflow(page, `${tag} notebook`);
    await ctx.close();
  }
}

/* ================================================================== */
/* Prologue — Holma framing (hip on phones, never a tiny full body)      */
/* ================================================================== */
async function runPrologue() {
  for (const [tag, vp, mobile] of [
    ['prologue-pc', { width: 1440, height: 900 }, false],
    ['prologue-sp', { width: 390, height: 844 }, true],
  ]) {
    console.log(`[shots] ${tag}`);
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'ja-JP' });
    const page = await ctx.newPage();
    attach(page, tag);
    await freshApp(page);
    await page.evaluate(() => window.__JD.goto('prologue', { line: '3' }));
    await page.evaluate(() => window.__JD.idle());
    await wait(1600);
    await page.evaluate(() => window.__JD.skipText());
    await wait(400);
    const h = await page.evaluate(() => {
      const img = document.querySelector('.prologue__holma .holma__img.is-on');
      const box = document.querySelector('.prologue__holma');
      return img && box ? { img: img.getBoundingClientRect().height, box: box.getBoundingClientRect().height } : null;
    });
    // phone: hip-up (sprite ≈ box / 0.6); PC: at least knee-up (never the tiny full body)
    const min = mobile ? 1.4 : 1.1;
    check(!!h && h.img > h.box * min, `${tag}: Holma framed ${mobile ? 'hip-up' : 'knee-up or closer'} (sprite ${Math.round(h?.img ?? 0)}px in a ${Math.round(h?.box ?? 0)}px box)`);
    await shot(page, `50-${tag}`);
    await ctx.close();
  }
}

try {
  if (!ONLY || ONLY === 'prologue') await runPrologue();
  if (!ONLY || ONLY === 'pc') await runPc();
  if (!ONLY || ONLY === 'sp') await runSp();
  if (!ONLY || ONLY === 'small') await runSmall();
} catch (e) {
  problems.push(`script error: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser.close();
  if (server) server.kill();
}
for (const n of notes) console.log(`NOTE: ${n}`);
if (problems.length) {
  console.log(`\n[shots] ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n[shots] all checks passed');
