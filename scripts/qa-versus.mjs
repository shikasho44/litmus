// Online versus QA — two real browsers (desktop 1440×900 + phone 390×844) race each other on the
// dev API in rules mode (docs/versus.md).
//
//   npm run qa:versus                 (own dev server on :5199, or reuses one in rules mode)
//   node scripts/qa-versus.mjs --case c02 --port 5199
//
// Flow: desktop keeps a single-player run of the case in its save (marker) → title shows 対戦 →
// desktop creates a room (見習い) → the phone joins with the code (invite link) → lobby on both,
// the streamer code mask → host starts → synchronized countdown → both in the investigation
// with the VERSUS HUD → the phone asks real questions (the desktop HUD follows) → the phone
// reloads mid-race and resumes → the desktop jumps to the verdict (dev: a minted 'debated' token
// bound to its run) and declares the right choice → the server records the win → 勝利！ cut-in
// on the desktop, 「〇〇が先に真相にたどり着いた！」 on the phone → the phone finishes 2nd
// (bound 'solved' token) → result panel on both → the single-player save is untouched (storage
// and memory) → the phone leaves (退出 on the desktop).
// Screenshots: qa/versus/<nn>-<device>-<state>.png. Exit 1 on page / console errors, failed
// checks or horizontal overflow. Real time (no virtual clock: the countdown follows the server).
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = Number(arg('--port', process.env.QA_VERSUS_PORT || 5199)); // not qa.mjs's 5198: both may run at once
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'versus');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.png')) rmSync(resolve(out, f));

const CASES = readdirSync(resolve(root, 'content', 'cases'))
  .filter((d) => /^c\d\d/.test(d))
  .sort()
  .map((d) => JSON.parse(readFileSync(resolve(root, 'content', 'cases', d, 'case.json'), 'utf8')))
  // a prototype case (case.json `proto`) never goes into a versus room (shared/proto.ts)
  .filter((c) => !c.proto);
const C = CASES.find((c) => c.id.startsWith(arg('--case', 'c01'))) ?? CASES[0];
const HOST_NAME = 'ホスト審問官';
const GUEST_NAME = 'スマホの審問官';
const MARKER = 'QA-SINGLE-PLAYER-MARKER';
/** API-only players (no browser): they fill the room to 4 and leave after the win. */
const BOT_NAMES = ['ねむい助手', 'Kuro_Stream12'.slice(0, 12)];

/* ------------------------------------------------------------------ server */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function health() {
  try {
    const r = await fetch(`${BASE}api/health`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
let server = null;
{
  const h = await health();
  if (h) {
    if (h.mode !== 'rules') {
      console.error(`[qa:versus] a server on :${PORT} runs in "${h.mode}" mode — stop it or pick another --port`);
      process.exit(1);
    }
    console.log(`[qa:versus] reusing the server on :${PORT} (rules mode)`);
  } else {
    Object.assign(process.env, { PIPELINE_MODE: 'rules', DECISION_PROVIDER: 'rules', LLM_PROVIDER: 'none', TRACE_FILE: '0' });
    const { createServer } = await import('vite');
    server = await createServer({
      configFile: resolve(root, 'vite.config.ts'),
      root,
      logLevel: 'warn',
      server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
    });
    await server.listen();
    let hh = null;
    for (let i = 0; i < 160 && !hh; i++) {
      hh = await health();
      if (!hh) await sleep(250);
    }
    if (!hh || hh.mode !== 'rules') {
      console.error(`[qa:versus] dev server not ready on :${PORT}`);
      await server.close();
      process.exit(1);
    }
    console.log(`[qa:versus] vite dev server on :${PORT}, API mode ${hh.mode}`);
  }
}
const cfg = await (await fetch(`${BASE}api/versus/config`)).json();
if (!cfg.enabled) {
  console.error(`[qa:versus] /api/versus/config says versus is disabled: ${JSON.stringify(cfg)}`);
  await server?.close();
  process.exit(1);
}

/* ------------------------------------------------------------------ helpers */
const problems = [];
const passed = [];
const check = (cond, msg) => {
  if (cond) passed.push(msg);
  else problems.push(`CHECK FAILED: ${msg}`);
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  return !!cond;
};
async function waitFor(page, fn, arg, { timeout = 30000, label = 'condition', step = 150 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    await sleep(step);
  }
  throw new Error(`timeout waiting for ${label}`);
}
const waitSel = (page, sel, opts = {}) => waitFor(page, (s) => !!document.querySelector(s), sel, { label: sel, ...opts });
const waitScene = (page, scene, opts = {}) =>
  waitFor(page, (s) => window.__JD?.getState().route.scene === s && !window.__JD.getState().transitioning, scene, { label: `scene ${scene}`, ...opts });
const saveOf = (page, id) => page.evaluate((id) => window.__JD.getState().save.cases[id] ?? null, id);
const storedCase = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem('janedoe:save:v1') || '{}').cases?.[id] ?? null, id);
const room = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('janedoe:vs:session') || 'null'));

async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.scene, .page, .vs-hud, .vs-hud__list, .modal__body, .vsx-code, .vs-standings')) {
      const cs = getComputedStyle(e);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${String(e.className).split(' ').slice(0, 2).join('.')} ${e.scrollWidth}>${e.clientWidth}`);
    }
    // a HUD chip whose content spills out of its box
    for (const e of document.querySelectorAll('.vs-chip__top, .vs-chip__bottom, .vs-row__who')) if (e.scrollWidth > e.clientWidth + 2) res.push(`${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    // versus UI boxes cut off by the right edge of the screen (the page itself clips overflow-x)
    for (const e of document.querySelectorAll('.vsx .page__inner *, .vs-hud > *')) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 3 && !e.closest('.vsx-code')) res.push(`${String(e.className).split(' ')[0] || e.tagName} right ${Math.round(r.right)}>${vw}`);
      if (res.length > 6) break;
    }
    return res;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}
let shotNo = 0;
async function shot(page, tag, state) {
  await sleep(250);
  const name = `${String(++shotNo).padStart(2, '0')}-${tag}-${state}`;
  await overflow(page, name);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  📷 ${name}.png`);
}
function watch(page, tag) {
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 409/.test(m.text())) problems.push(`${tag} console: ${m.text()}`);
  });
}
async function open(page, hash = '') {
  await page.goto(`${BASE}?mute=1&nofx=1${hash}`, { waitUntil: 'load' });
  await waitFor(page, () => !!window.__JD && document.documentElement.classList.contains('app-ready'), null, { label: 'app ready' });
  await waitFor(page, () => !window.__JD.getState().transitioning, null, { label: 'boot transition' });
}
async function api(page, path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(`api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.json();
    },
    { path, body },
  );
}
/** A dev-minted token at `stage`, bound to this page's race (dev-only route), put into the race copy. */
async function jumpTo(page, stage, sceneStage) {
  const s = await room(page);
  const minted = await api(page, 'admin/mint-token', { caseId: s.caseId, stage });
  const bound = await api(page, 'admin/versus-bind', { seat: s.seat, token: minted.token });
  if (!bound.token) throw new Error(`versus-bind failed: ${JSON.stringify(bound)}`);
  await page.evaluate(
    ({ id, token, progress, stage }) => window.__JD.updateCase(id, { token, snapshot: progress, ...(stage ? { stage } : {}) }),
    { id: s.caseId, token: bound.token, progress: bound.progress, stage: sceneStage },
  );
  return bound;
}
const hudChips = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.vs-chip')].map((c) => ({ name: c.querySelector('.vs-chip__name')?.textContent, q: c.querySelector('.vs-chip__q')?.textContent, cls: c.className })));

/* ------------------------------------------------------------------ run */
// Two windows play at once: neither may be throttled as a "background" page (rAF-driven scene
// transitions would stall in the one without focus).
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', permissions: ['clipboard-read', 'clipboard-write'] });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
const A = await desk.newPage();
const B = await phone.newPage();
watch(A, 'desktop');
watch(B, 'phone');
const t0 = Date.now();
try {
  console.log(`\n[qa:versus] ${C.id} — ${C.title}`);
  // --- the desktop player has a single-player run of this case (must survive the race)
  await open(A);
  await A.evaluate(() => {
    window.__JD.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
    window.__JD.setSettings({ textSpeed: 'instant' });
  });
  const solo = await api(A, 'admin/mint-token', { caseId: C.id, stage: 'investigated' });
  await A.evaluate(
    ({ id, token, progress, marker }) => {
      window.__JD.updateCase(id, { stage: 'investigation', difficulty: 'hard', token, snapshot: progress, notes: marker, elapsedMs: 123456, bestRank: 'A', clears: 1, completed: true, bestPoints: 777 });
      window.__JD.flushSave();
    },
    { id: C.id, token: solo.token, progress: solo.progress, marker: MARKER },
  );
  const before = JSON.stringify(await storedCase(A, C.id));
  check(before.includes(MARKER), 'desktop: a single-player run of the case is in the save before the race');

  // --- title: the 対戦 item
  await A.click('.title__enter').catch(() => {});
  // (the first visit compiles the versus chunk on the dev server: allow for a slow machine)
  await waitSel(A, '.menu__item[data-id="versus"]', { label: 'the 対戦 menu item', timeout: 90000 });
  await sleep(700);
  await shot(A, 'pc', 'title-menu');
  await A.click('.menu__item[data-id="versus"]');
  await waitScene(A, 'versus');
  await waitSel(A, '[data-vs-create]');
  await sleep(500);
  await shot(A, 'pc', 'entry');

  // --- create (見習い = choice verdict)
  await A.fill('[data-vs-name]', HOST_NAME);
  await A.click(`.vsx-case:has(input[value="${C.id}"])`);
  await A.click('.vsx-diff[data-difficulty="easy"]');
  await A.click('[data-vs-create]');
  await waitSel(A, '[data-vs-roomcode]', { label: 'lobby with the room code' });
  const code = await A.getAttribute('[data-vs-roomcode]', 'data-vs-roomcode');
  check(/^[A-HJKMNP-Z2-9]{6}$/.test(code ?? ''), `desktop: room created, code ${code} (no 0/O/1/I/L)`);

  // --- the phone joins through the invite link
  await open(B, `#/versus?join=${code}`);
  await B.evaluate(() => window.__JD.setSettings({ textSpeed: 'instant' }));
  await waitSel(B, '[data-vs-join]');
  check((await B.inputValue('[data-vs-code]')) === code, 'phone: the invite link pre-fills the code');
  await sleep(400);
  await shot(B, 'sp', 'entry');
  await B.fill('[data-vs-name]', GUEST_NAME);
  await B.click('[data-vs-join]');
  await waitSel(B, '.vsx-lobby', { label: 'phone lobby' });
  const bots = [];
  for (const name of BOT_NAMES) {
    const r = await fetch(`${BASE}api/versus/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name }) });
    bots.push(await r.json());
  }
  check(bots.every((b) => typeof b.seat === 'string'), `two more players join over the API (${bots.map((b) => b.room?.players?.length).join(', ')} in the room)`);
  const full = await fetch(`${BASE}api/versus/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'five' }) });
  check(full.status === 409, 'a 5th player is refused (room full)');
  await waitFor(A, () => document.querySelectorAll('.vsx-player:not(.is-empty)').length === 4, null, { label: 'desktop sees 4 players' });
  check(true, 'desktop lobby lists all four players');
  await sleep(600);
  await shot(A, 'pc', 'lobby');
  await shot(B, 'sp', 'lobby');
  const bottom = await B.evaluate(() => {
    const p = document.querySelector('.vsx__page');
    return p ? p.scrollHeight - p.clientHeight : 0;
  });
  if (bottom > 0) {
    await B.evaluate(() => document.querySelector('.vsx__page')?.scrollTo(0, 99999));
    await sleep(300);
    await shot(B, 'sp', 'lobby-bottom');
  }
  // streamer mask
  await A.click('.vsx-code__hide [role="switch"]');
  await sleep(300);
  const masked = await A.evaluate(() => document.querySelector('.vsx-code__value')?.textContent ?? '');
  check(!masked.includes(code) && /●{6}/.test(masked), 'desktop: 配信用にコードを隠す masks the code on screen');
  await shot(A, 'pc', 'lobby-masked');
  await A.click('[data-vs-copy]');
  const clip = await A.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(clip === code, 'desktop: the copy button copies the code even while it is masked');
  await A.click('.vsx-code__hide [role="switch"]');

  // --- start → countdown → investigation on both
  await A.click('[data-vs-start]');
  await waitSel(A, '.vsx-count');
  await waitSel(B, '.vsx-count', { label: 'phone countdown' });
  const digit = (page) => waitFor(page, () => /^[123]$/.test(document.querySelector('.vsx-count__num')?.textContent?.trim() ?? ''), null, { label: 'a countdown digit', step: 50 });
  await Promise.all([digit(A), digit(B)]);
  await sleep(380);
  await Promise.all([shot(A, 'pc', 'countdown'), shot(B, 'sp', 'countdown')]);
  await Promise.all([waitScene(A, 'investigation', { timeout: 20000 }), waitScene(B, 'investigation', { timeout: 20000 })]);
  await Promise.all([waitSel(A, '.vs-hud'), waitSel(B, '.vs-hud')]);
  const [ra, rb] = [await saveOf(A, C.id), await saveOf(B, C.id)];
  check(ra?.difficulty === 'easy' && rb?.difficulty === 'easy', 'both race on the room difficulty (見習い)');
  check(!!ra?.token && ra.token !== solo.token && ra.notes !== MARKER, 'desktop: the race runs on its own copy (not the single-player run)');
  const tokPayload = (t) => JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  check(tokPayload(ra.token).vs?.startsWith(code), 'desktop: the race token is bound to the room (vs field)');
  check(JSON.stringify(await storedCase(A, C.id)) === before, 'desktop: storage still holds the single-player run during the race');
  await sleep(900);
  await shot(A, 'pc', 'investigation-hud');
  await shot(B, 'sp', 'investigation-hud');

  // --- the phone asks real questions; the desktop HUD follows
  const probes = C.probes.filter((p) => ['yes', 'no', 'partial'].includes(p.answer) && p.kind !== 'multi' && p.kind !== 'typo').slice(0, 2);
  for (const p of probes) {
    const n = (await saveOf(B, C.id)).log.filter((e) => e.kind === 'answer').length;
    await B.locator('.dock__input').fill(p.q);
    await B.locator('.dock__input').press('Enter');
    await waitFor(B, ({ id, n }) => (window.__JD.getState().save.cases[id]?.log ?? []).filter((e) => e.kind === 'answer').length > n, { id: C.id, n }, { label: `answer to ${p.q}` });
    await waitFor(B, () => !document.querySelector('.iv.is-presenting') && !document.querySelector('.dock.is-busy'), null, { label: 'phone settled', timeout: 30000 });
  }
  await waitFor(A, (name) => [...document.querySelectorAll('.vs-chip')].some((c) => c.textContent.includes(name) && /Q2/.test(c.textContent)), GUEST_NAME, { label: 'desktop HUD shows the phone at Q2', timeout: 15000 });
  check(true, 'desktop HUD follows the phone player (Q2)');
  await shot(A, 'pc', 'hud-follows');
  await shot(B, 'sp', 'after-questions');

  // --- the phone reloads mid-race and resumes the same race
  const logBefore = (await saveOf(B, C.id)).log.length;
  await B.evaluate(() => window.__JD.flushSave());
  await sleep(900); // the race copy is mirrored to sessionStorage
  await B.reload({ waitUntil: 'load' });
  await waitFor(B, () => !!window.__JD && document.documentElement.classList.contains('app-ready'), null, { label: 'phone reloaded' });
  await waitScene(B, 'investigation');
  await waitSel(B, '.vs-hud', { label: 'HUD after reload' });
  const afterReload = await saveOf(B, C.id);
  check(afterReload.log.length === logBefore && tokPayload(afterReload.token).vs?.startsWith(code), `phone: a reload resumes the race copy (${afterReload.log.length} log entries, bound token)`);

  // --- the desktop jumps to the verdict and declares the right choice → wins
  await jumpTo(A, 'debated', 'inquest');
  await A.evaluate((id) => window.__JD.goto('inquest', { caseId: id }), C.id);
  await waitScene(A, 'inquest');
  await waitFor(
    A,
    () => {
      const el = document.querySelector('.iq');
      if (el?.dataset.dialogue === 'on') {
        window.__JD.skipText();
        document.querySelector('.iq__dialogue .dlg')?.click();
      }
      return el?.dataset.phase === 'verdict' && el.dataset.verdictStep === 'write' && !!document.querySelector('.vpanel[data-writable="on"]') && !document.querySelector('.fx-cutin');
    },
    null,
    { label: 'desktop verdict', timeout: 45000, step: 300 },
  );
  await sleep(600);
  check((await A.getAttribute('.vpanel', 'data-verdict-mode')) === 'choice', 'desktop: the room difficulty sets the verdict format (choice)');
  await shot(A, 'pc', 'verdict');
  const right = C.verdictModes.choice.options.find((o) => o.correct);
  await A.locator(`.vopt[data-option-id="${right.id}"]`).scrollIntoViewIfNeeded();
  await A.click(`.vopt[data-option-id="${right.id}"]`);
  await A.click('[data-verdict-submit]');
  // both see the announcement (watched in parallel: each client learns of the win on its own poll)
  const cutIn = (page, re, label) =>
    waitFor(page, (src) => {
      const t = document.querySelector('.fx-cutin .cutin')?.textContent ?? '';
      return new RegExp(src).test(t) ? t : null;
    }, re, { label, timeout: 20000, step: 60 });
  const [winSeen, loseSeen] = await Promise.all([
    cutIn(A, '勝利', 'desktop 勝利！ cut-in').then(async (t) => (await sleep(300), await shot(A, 'pc', 'win-cutin'), t)),
    cutIn(B, `${HOST_NAME}が先に真相にたどり着いた`, 'phone winner cut-in').then(async (t) => (await sleep(300), await shot(B, 'sp', 'winner-cutin'), t)),
  ]);
  check(winSeen.includes('勝利'), 'desktop: 「勝利！」 cut-in');
  check(!!loseSeen, `phone: 「${HOST_NAME}が先に真相にたどり着いた！」 cut-in`);
  await waitFor(B, () => !document.querySelector('.fx-cutin'), null, { label: 'phone cut-in over', timeout: 15000 });
  await sleep(400);
  await shot(B, 'sp', 'hud-winner');
  // the HUD opens the standings
  await B.click('.vs-hud__lead');
  await waitSel(B, '.modal [data-vs-room]');
  await sleep(500);
  await shot(B, 'sp', 'hud-standings');
  await B.keyboard.press('Escape');
  await waitFor(B, () => !document.querySelector('.modal-root'), null, { label: 'standings closed' });

  // --- the API players leave, the phone finishes second (a bound 'solved' token), both look at the result
  for (const b of bots) await fetch(`${BASE}api/versus/leave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seat: b.seat }) });
  await jumpTo(B, 'solved');
  await waitFor(A, (name) => [...document.querySelectorAll('.vs-chip')].some((c) => c.textContent.includes(name) && c.classList.contains('is-done')), GUEST_NAME, {
    label: 'desktop HUD shows the phone finished',
    timeout: 20000,
  }).catch(() => null);
  await waitFor(A, () => !document.querySelector('.fx-cutin'), null, { label: 'desktop cut-in over', timeout: 15000 });
  await A.evaluate(() => window.__JD.goto('versus'));
  await B.evaluate(() => window.__JD.goto('versus'));
  await Promise.all([waitScene(A, 'versus'), waitScene(B, 'versus')]);
  const ranked = () => document.querySelector('[data-vs-view]')?.getAttribute('data-vs-view') === 'race' && document.querySelectorAll('.vs-row.is-win, .vs-row.is-done').length === 2 && /対戦結果/.test(document.querySelector('.vsx__title')?.textContent ?? '');
  await waitFor(A, ranked, null, { label: 'desktop result panel', timeout: 15000 });
  await waitFor(B, ranked, null, { label: 'phone result panel', timeout: 15000 });
  const standings = await A.evaluate(() => [...document.querySelectorAll('.vs-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  check(standings[0]?.includes(HOST_NAME) && standings[1]?.includes(GUEST_NAME), `result: 1st ${HOST_NAME}, 2nd ${GUEST_NAME} (${standings.join(' | ')})`);
  check(await A.evaluate(() => document.querySelector('.vsx')?.textContent?.includes('対戦結果') ?? false), 'result panel titled 対戦結果 once everyone finished');
  await sleep(600);
  await shot(A, 'pc', 'result');
  await shot(B, 'sp', 'result');

  // --- the single-player save survived: in storage, and back in memory after the race
  check(JSON.stringify(await storedCase(A, C.id)) === before, 'desktop: storage still holds the untouched single-player run after the race');
  await A.evaluate(() => window.__JD.goto('title'));
  await waitScene(A, 'title');
  const mem = await saveOf(A, C.id);
  check(mem?.notes === MARKER && mem.bestRank === 'A' && mem.clears === 1 && mem.bestPoints === 777 && mem.token === solo.token, 'desktop: back at the title the single-player run is in memory again (rank / clears / points / token unchanged)');
  await waitSel(A, '.menu__item[data-id="versus"]');
  check(await A.evaluate(() => document.querySelector('.menu__item[data-id="versus"]')?.textContent?.includes('対戦に戻る') ?? false), 'title offers 対戦に戻る while the tab is in a room');
  await shot(A, 'pc', 'title-in-room');

  // --- the phone leaves; the desktop sees 退出
  await B.click('[data-vs-leave]');
  await waitSel(B, '[data-vs-leave-confirm]');
  await sleep(300);
  await shot(B, 'sp', 'leave-confirm');
  await B.click('[data-vs-leave-confirm]');
  await waitSel(B, '[data-vs-create]', { label: 'phone back to the entry' });
  await A.click('.menu__item[data-id="versus"]');
  await waitScene(A, 'versus');
  const leftSeen = await waitFor(A, (name) => [...document.querySelectorAll('.vs-row')].some((r) => r.textContent.includes(name) && r.textContent.includes('退出')), GUEST_NAME, {
    label: 'desktop sees the phone as 退出',
    timeout: 10000,
  }).catch(() => false);
  check(!!leftSeen, 'desktop: the phone player who left is marked 退出 (rank kept)');
  await sleep(300);
  await shot(A, 'pc', 'result-after-leave');
  const gone = await room(B);
  check(gone === null, 'phone: leaving forgets the room in that tab');

  /* ---------------- second room: 審問官 (3 lights) — the desktop runs out of lights → 脱落 ---------------- */
  console.log('\n[qa:versus] second room: 脱落');
  await A.click('[data-vs-leave]');
  await waitSel(A, '[data-vs-leave-confirm]');
  await sleep(250);
  await A.click('[data-vs-leave-confirm]');
  await waitSel(A, '[data-vs-create]');
  await A.click(`.vsx-case:has(input[value="${C.id}"])`);
  await A.click('.vsx-diff[data-difficulty="normal"]');
  await A.click('[data-vs-create]');
  await waitSel(A, '[data-vs-roomcode]');
  const code2 = await A.getAttribute('[data-vs-roomcode]', 'data-vs-roomcode');
  await B.fill('[data-vs-code]', code2.toLowerCase());
  await B.click('[data-vs-join]');
  await waitSel(B, '.vsx-lobby');
  await waitFor(A, () => !document.querySelector('[data-vs-start]')?.hasAttribute('disabled'), null, { label: 'start enabled' });
  await A.click('[data-vs-start]');
  await Promise.all([waitScene(A, 'investigation', { timeout: 20000 }), waitScene(B, 'investigation', { timeout: 20000 })]);
  // straight from the race to the title and back: the play time written while the scene unmounts
  // belongs to the race copy, never to the single-player run
  await sleep(1500);
  await A.evaluate(() => window.__JD.goto('title'));
  await waitScene(A, 'title');
  await waitSel(A, '.menu__item[data-id="versus"]');
  const soloMem = await saveOf(A, C.id);
  check(soloMem?.elapsedMs === 123456 && soloMem.token === solo.token && JSON.stringify(await storedCase(A, C.id)) === before, 'desktop: leaving a race scene for the title leaves the single-player run untouched (play time included)');
  await A.click('.menu__item[data-id="versus"]');
  await waitScene(A, 'versus');
  await waitSel(A, '[data-vs-resume]');
  await A.click('[data-vs-resume]');
  await waitScene(A, 'investigation');
  await waitSel(A, '.vs-hud', { label: 'HUD back in the race' });
  check((await saveOf(A, C.id))?.token !== solo.token, 'desktop: 対戦に戻る → 捜査に戻る reopens the race');
  // two wrong cloze verdicts straight over the API (the server counts them), then the last light in the UI
  const bound2 = await jumpTo(A, 'debated');
  const wrongBlanks = async (token) => {
    const setup = await api(A, 'inquest/verdict-setup', { caseId: C.id, token, mode: 'cloze' });
    const picks = {};
    for (const b of setup.cloze.blanks) {
      const right = C.verdictModes.cloze.blanks.find((x) => x.id === b.id);
      picks[b.id] = b.options.findIndex((t) => t !== right.options[right.answer]);
    }
    return picks;
  };
  let tok = bound2.token;
  let last = null;
  for (let i = 0; i < 2; i++) {
    last = await api(A, 'inquest/verdict', { caseId: C.id, token: tok, mode: 'cloze', blanks: await wrongBlanks(tok) });
    check(last.result && last.result !== 'correct', `desktop: wrong cloze verdict ${i + 1} over the API (${last.result})`);
    tok = last.token;
  }
  await A.evaluate(
    ({ id, token, progress, rounds }) => {
      window.__JD.updateCase(id, {
        stage: 'inquest',
        token,
        snapshot: progress,
        inquest: { phase: 'verdict', roundIndex: 0, composure: 5, cleared: rounds, misses: 0, grants: 0, verdictAttempts: 2, suspensions: 0, lives: 1, debateSkipped: false },
      });
      window.__JD.goto('inquest', { caseId: id });
    },
    { id: C.id, token: last.token, progress: last.progress, rounds: C.debate.map((r) => r.id) },
  );
  await waitScene(A, 'inquest');
  await waitFor(
    A,
    () => {
      const el = document.querySelector('.iq');
      if (el?.dataset.dialogue === 'on') {
        window.__JD.skipText();
        document.querySelector('.iq__dialogue .dlg')?.click();
      }
      return el?.dataset.phase === 'verdict' && el.dataset.verdictStep === 'write' && !!document.querySelector('.vpanel[data-writable="on"]') && !document.querySelector('.fx-cutin');
    },
    null,
    { label: 'desktop verdict (last light)', timeout: 45000, step: 300 },
  );
  check((await A.getAttribute('.vpanel', 'data-verdict-mode')) === 'cloze', 'desktop: a 審問官 room declares in the cloze format');
  for (const b of C.verdictModes.cloze.blanks) {
    if (await A.$(`.vblank.is-locked[data-blank-id="${b.id}"]`)) continue;
    // after a pick the next empty blank may already be open (a second click would close it)
    if (!(await A.$(`.vblank.is-open[data-blank-id="${b.id}"]`))) await A.click(`.vblank[data-blank-id="${b.id}"]`);
    await waitSel(A, '.vpick');
    await sleep(200);
    await A.locator('.vpick__opt', { hasText: b.options.find((_, i) => i !== b.answer) }).first().click();
    await sleep(250);
  }
  await A.click('[data-verdict-submit]');
  // Holma's lines after the miss wait for the player: advance them until the game over shows
  await waitFor(
    A,
    () => {
      const el = document.querySelector('.iq');
      if (el?.dataset.dialogue === 'on') {
        window.__JD.skipText();
        document.querySelector('.iq__dialogue .dlg')?.click();
      }
      return !!document.querySelector('.gover[data-gameover="end"]');
    },
    null,
    { label: 'versus game over (end)', timeout: 30000, step: 300 },
  );
  await waitFor(A, () => {
    const b = document.querySelector('[data-gameover-title]');
    return b && getComputedStyle(document.querySelector('.gover__card')).opacity === '1';
  }, null, { label: 'game-over card', timeout: 15000 });
  const goText = await A.textContent('.gover');
  check(/脱落/.test(goText ?? '') && /観戦する/.test(goText ?? ''), 'desktop: the game over ends the race (脱落 · 観戦する, no restart)');
  await shot(A, 'pc', 'gameover-out');
  await A.click('[data-gameover-title]');
  await waitScene(A, 'versus');
  await waitFor(A, () => !!document.querySelector('.vs-row.is-out.is-you'), null, { label: 'desktop marked 脱落', timeout: 10000 });
  check(true, 'desktop: the standings mark the player 脱落');
  check(!(await A.$('[data-vs-resume]')), 'desktop: an eliminated player cannot go back into the race');
  await sleep(400);
  await shot(A, 'pc', 'spectate');
  await waitFor(B, (name) => [...document.querySelectorAll('.vs-chip')].some((c) => c.textContent.includes(name) && c.classList.contains('is-out')), HOST_NAME, { label: 'phone HUD shows 脱落', timeout: 10000 });
  check(true, 'phone: the HUD shows the other player 脱落');
  await sleep(300);
  await shot(B, 'sp', 'hud-opponent-out');
  // (from node, not the page: the expected 403 would be a console error there)
  const run2 = await (await fetch(`${BASE}api/versus/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seat: (await room(A)).seat }) })).json();
  check(run2.error?.message === 'you are out of this race', 'server: no new run token for an eliminated player');
  check(JSON.stringify(await storedCase(A, C.id)) === before, 'desktop: storage still holds the untouched single-player run after the second room');
} catch (e) {
  problems.push(`versus: ${e.message.split('\n')[0]}`);
  console.error(`  ✗ ${e.message}`);
  await A.screenshot({ path: resolve(out, 'FAIL-pc.png') }).catch(() => {});
  await B.screenshot({ path: resolve(out, 'FAIL-sp.png') }).catch(() => {});
} finally {
  console.log(`  (${Math.round((Date.now() - t0) / 1000)} s)`);
  await browser.close();
  await server?.close();
}

console.log(`\n[qa:versus] ${passed.length} checks passed, ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p}`);
if (problems.length) {
  console.log('[qa:versus] FAILED');
  process.exit(1);
}
console.log('[qa:versus] OK');
