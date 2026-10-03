// End-to-end flow QA — plays a case from the title screen to the rank on the files screen,
// in a real browser, against the dev API in rules mode.
//
//   npm run qa                      CASE 01 full flow at 1440x900 + mint-token smoke of the other cases
//                                   (CASE 01 = the case whose `number` is 1: c08 since 2026-09-29; c05 is CASE 02, c01 is CASE 05)
//   npm run qa:mobile               the same at 390x844 (touch, DPR 2)
//   node scripts/qa.mjs --case c02  full flow for another case (id or prefix; 'all' = every case, in number order)
//   node scripts/qa.mjs --no-smoke  full flow only          --smoke-only   smoke runs only
//   node scripts/qa.mjs --port 5198 (default; a dev server already answering there is reused if it runs in rules mode)
//   node scripts/qa.mjs --proto i005   the same runs with a feature prototype switched on (?proto=i005, src/config/proto.ts):
//                                   I-005 adds checks + shots of its four pieces; without the switch the runs check that none shows
//   node scripts/qa.mjs --proto seeds --case c09   the prototype cases (case.json `proto`) join the run only with their switch
//                                   (several: --proto i005,seeds); without it the files screen must not list them
//   node scripts/qa.mjs --viewport 1280x800   another PC size     --seed-random   seeded Math.random (before/after screenshot diffs)
//
// Full flow: title (gate → 審問を始める) → prologue (skip) → files → difficulty chooser → intro
// (title card, narration, skip → catch cut-in) → investigation (coach-mark tutorial on CASE 01 = number 1,
// starter chip, then case probes until the findings the debate needs are unlocked, one hint,
// notebook) → 審問を開く → inquest (one miss, every round, an incomplete verdict in the
// difficulty's format, the right one, reconstruction with one wrong pick, finale) → resolution
// (ceremony → record) → science → quiz (one wrong answer) → result → files (rank).
// Resume checks: reload in investigation / inquest / verdict / resolution / science / quiz /
// result lands on the same scene with its state, and title 「続きから」 reopens the case.
//
// Smoke (other cases): files → difficulty → intro (skip) → 3 questions, then a dev-minted
// 'investigated' token (POST /api/admin/mint-token) → inquest → endings → files rank.
// Difficulty per case (every verdict format runs in the default `npm run qa`):
//   c08 審問官 (cloze) — CASE 01, the tutorial —
//   c05 審問官 (cloze) · c06 見習い (choice) · c07 教授 (free) — the intro cases CASE 02–04 —
//   c01 審問官 (cloze) · c02 見習い (choice, noise break skipped after round 1) · c03 教授 (free) · c04 審問官 (cloze).
//   c09 審問官 (cloze) — the prototype case, only with --proto seeds —
//   c10 審問官 (cloze) · c11 見習い (choice) · c12 教授 (free) — the I-001 リトマス・ラボ samples, only with --proto lab —
// Game over: 審問官 on the last light → the case restarts (new token, other cases untouched);
// 見習い on the last light → back to the start of the inquest with the lights refilled.
//
// Time: every page runs on Playwright's virtual clock and the script advances it (tick), so
// GSAP timelines / typewriters / timers are frame-exact however busy the machine is. The API
// runs in real time (short real sleeps between ticks). Chromium headless + SwiftShader.
// Screenshots: qa/flow/<size>-<case>-<nn>-<state>.png. Exit 1 on page errors, console
// errors, failed checks, wrong scene order or horizontal overflow.
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const MOBILE = argv.includes('--mobile');
const PORT = Number(arg('--port', process.env.QA_PORT || 5198));
const BASE = `http://127.0.0.1:${PORT}/`;
const SMOKE = !argv.includes('--no-smoke');
const SMOKE_ONLY = argv.includes('--smoke-only');
/** Feature prototypes to switch on (?proto=…, comma separated: i005, seeds, lab); '' = the live default. */
const PROTO = arg('--proto', '');
// the old switch name still works (shared/proto.ts PROTO_ALIASES: tsukuru → lab, renamed 2026-10-04)
const PROTOS = PROTO.toLowerCase().split(/[\s,]+/).filter(Boolean).map((w) => (w === 'tsukuru' ? 'lab' : w));
const I005 = PROTOS.includes('i005');
const VIEW = /^(\d{3,4})x(\d{3,4})$/.exec(arg('--viewport', '')) ?? null;
const SEED_RANDOM = argv.includes('--seed-random');
const SIZE = MOBILE
  ? { tag: 'sp', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }
  : { tag: 'pc', ctx: { viewport: VIEW ? { width: Number(VIEW[1]), height: Number(VIEW[2]) } : { width: 1440, height: 900 }, deviceScaleFactor: 1 } };
const NARROW = MOBILE;

const out = resolve(root, 'qa', 'flow');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.startsWith(`${SIZE.tag}-`) && f.endsWith('.png')) rmSync(resolve(out, f));

/* ------------------------------------------------------------------ cases */
const CASES = readdirSync(resolve(root, 'content', 'cases'))
  .filter((d) => /^c\d\d/.test(d))
  .sort()
  .map((d) => JSON.parse(readFileSync(resolve(root, 'content', 'cases', d, 'case.json'), 'utf8')))
  // a prototype case (case.json `proto`, shared/proto.ts) exists only with its switch (--proto seeds)
  .filter((c) => !c.proto || PROTOS.includes(c.proto))
  .sort((a, b) => a.number - b.number);
/** Prototype cases left out of this run (their switch is off): the files screen must not show them. */
const HIDDEN_PROTO_CASES = readdirSync(resolve(root, 'content', 'cases'))
  .filter((d) => /^c\d\d/.test(d))
  .map((d) => JSON.parse(readFileSync(resolve(root, 'content', 'cases', d, 'case.json'), 'utf8')))
  .filter((c) => c.proto && !PROTOS.includes(c.proto));
const findCase = (k) => CASES.find((c) => c.id === k || c.id.startsWith(k));
/** CASE 01 by its display number (the tutorial case), whatever its id. */
const FIRST = CASES.find((c) => c.number === 1) ?? CASES[0];
const caseArg = arg('--case', FIRST.id);
const FULL = SMOKE_ONLY ? [] : caseArg === 'all' ? CASES : [findCase(caseArg)].filter(Boolean);
if (!SMOKE_ONLY && !FULL.length) {
  console.error(`[qa] unknown case "${caseArg}" (have: ${CASES.map((c) => c.id).join(', ')})`);
  process.exit(1);
}
const SMOKES = SMOKE ? CASES.filter((c) => !FULL.includes(c)) : [];

/** Difficulty per case (VERDICT_MODE_BY_DIFFICULTY: easy choice · normal cloze · hard free). */
const LEVEL = { c01: 'normal', c02: 'easy', c03: 'hard', c04: 'normal', c05: 'normal', c06: 'easy', c07: 'hard', c08: 'normal', c09: 'normal', c10: 'normal', c11: 'easy', c12: 'hard' };
const MODE = { easy: 'choice', normal: 'cloze', hard: 'free' };
const LIVES = { easy: 10, normal: 3, hard: 3 };
/** Smoke runs that skip the rest of the noise break after this many rounds. */
const SKIP_AFTER = { c02: 1 };
/** Smoke runs that never touch a 質問の例 card (the result then shows 「素手の審問官」). */
const NO_CARD = ['c05'];
const levelOf = (c) => LEVEL[c.id.slice(0, 3)] ?? 'normal';

/** Verdicts that name part of the story but not all of it (never 'correct'). */
const INCOMPLETE = {
  c01: '酸欠で亡くなったのだと思う。夜なので部屋の換気が止まっていた。',
  c02: 'ボールが胸に当たって、心室細動が起きた。',
  c03: '寒さで体が冷えて亡くなった。',
  c04: 'トリカブトの毒で亡くなった。',
  c05: '牛乳が凍ったから割れた。',
  c06: '日光で雪だるまがとけた。',
  c07: '水が足りなくてしおれた。',
  c08: 'ハチに刺されて倒れた。',
  c09: '車の下に脚をはさまれて亡くなった。',
  c10: '振ったから凍った。',
  c11: '窓が冷たかった。',
  c12: '影がふたつあった。',
};

/**
 * 質問枠 (shared/budget.ts, 2026-09-28): the expected budget of a case run and the counter text.
 * Kept in step with BUDGET_TUNING by hand (par 14 + 8 × case difficulty; ×1.3 / ×1.0 / ×0.8 since
 * 2026-09-29 — every published case sets its own questionBudget anyway).
 */
const BUDGET_FACTOR = { easy: 1.3, normal: 1.0, hard: 0.8 };
const BUDGET_KIND = { easy: 'guide', normal: 'soft', hard: 'hard' };
function expectedBudget(c, level) {
  const o = c.questionBudget?.[level];
  return Math.max(3, typeof o === 'number' ? o : Math.round((14 + 8 * Math.min(3, Math.max(1, c.difficulty))) * BUDGET_FACTOR[level]));
}
function expectedCounter(spent, budget, level) {
  const kind = BUDGET_KIND[level];
  if (spent >= budget && kind === 'hard') return '質問締切';
  if (spent > budget) return `${kind === 'guide' ? '目安超え' : '超過'}+${spent - budget}/${budget}`;
  return `${kind === 'guide' ? '目安' : '残り'}${budget - spent}/${budget}`;
}
async function budgetCheck(page, c, label) {
  const s = await saveOf(page, c.id);
  const snap = s?.snapshot ?? {};
  const spent = Math.min(snap.asked ?? 0, snap.spent ?? snap.asked ?? 0);
  const level = levelOf(c);
  const want = expectedCounter(spent, expectedBudget(c, level), level);
  const got = await page.evaluate(() => document.querySelector('.qbudget')?.textContent.replace(/\s+/g, '') ?? (document.querySelector('[data-budget-closed]') ? '質問締切' : null));
  check(got === want, `${c.id}: ${label}: the question counter reads ${got} (${spent} counted of ${expectedBudget(c, level)}, ${level})`);
  return spent;
}

/** Case probes (exact bank questions → deterministic rules answers) that unlock the findings the debate needs, then the weightiest others. */
function questionPlan(c, max = 14) {
  const probeFor = (id, skip = new Set()) =>
    c.probes.find((p) => !skip.has(p.q) && p.facts?.includes(id) && ['yes', 'partial', 'no'].includes(p.answer) && p.kind !== 'multi' && p.kind !== 'typo');
  const want = [];
  for (const r of c.debate) want.push(r.answer.fact);
  const others = c.facts
    .filter((f) => !f.visibleFromStart && f.spoilerLevel <= 3 && f.importance >= 2)
    .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
  for (const f of others) if (!want.includes(f.id)) want.push(f.id);
  const plan = [];
  const covered = new Set();
  const used = new Set();
  for (const id of want) {
    if (covered.has(id)) continue;
    const p = probeFor(id, used);
    if (!p) continue;
    used.add(p.q);
    plan.push({ q: p.q, answer: p.answer, facts: p.facts ?? [] });
    for (const f of p.facts ?? []) covered.add(f);
    if (plan.length >= max) break;
  }
  return { plan, probeFor, used };
}

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
      console.error(`[qa] a server on :${PORT} is running in "${h.mode}" mode — stop it (the QA needs rules mode) or pick another --port`);
      process.exit(1);
    }
    console.log(`[qa] reusing the server on :${PORT} (rules mode)`);
  } else {
    // Our own Vite dev server (JS API): rules mode, no HMR / file watching, so nothing reloads
    // the page mid-run. Closed at the end.
    Object.assign(process.env, { PIPELINE_MODE: 'rules', DECISION_PROVIDER: 'rules', LLM_PROVIDER: 'none', TRACE_FILE: '0' });
    const { createServer, searchForWorkspaceRoot } = await import('vite');
    server = await createServer({
      configFile: resolve(root, 'vite.config.ts'),
      root,
      logLevel: 'warn',
      // (a git worktree may link node_modules from the main checkout: the fonts are served from there)
      server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] }, fs: { allow: [searchForWorkspaceRoot(root), realpathSync(resolve(root, 'node_modules'))] } },
    });
    await server.listen();
    let hh = null;
    for (let i = 0; i < 160 && !hh; i++) {
      hh = await health();
      if (!hh) await sleep(250);
    }
    if (!hh || hh.mode !== 'rules') {
      console.error(`[qa] dev server not ready on :${PORT} (${JSON.stringify(hh)})`);
      await server.close();
      process.exit(1);
    }
    console.log(`[qa] vite dev server on :${PORT}, API mode ${hh.mode}, ${hh.cases} cases`);
  }
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

/** Advance the page's virtual clock in 100 ms slices (so rAF renders intermediate frames). */
async function tick(page, ms) {
  for (let t = 0; t < ms; t += 100) await page.clock.runFor(Math.min(100, ms - t));
}
/** Long stretches of investigation time (the 質問の例 clock) in 1 s steps. */
async function advance(page, ms) {
  for (let t = 0; t < ms; t += 1000) await page.clock.runFor(Math.min(1000, ms - t));
}
const cardTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.dock__chip[data-example-card]')].map((e) => e.textContent));

/** Poll fn(arg) in the page, advancing virtual time between polls. `each` runs between polls. */
async function waitFor(page, fn, arg, { timeout = 90000, label = 'condition', step = 120, each } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (each) await each();
    await tick(page, step);
    await sleep(20);
  }
  throw new Error(`timeout waiting for ${label}`);
}
const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);
const waitSel = (page, sel, opts = {}) => waitFor(page, (s) => !!document.querySelector(s), sel, { label: sel, ...opts });
const waitGone = (page, sel, opts = {}) => waitFor(page, (s) => !document.querySelector(s), sel, { label: `no ${sel}`, ...opts });
const sceneOf = (page) => page.evaluate(() => window.__JD?.getState().route.scene ?? null);
const waitScene = (page, scene, opts = {}) =>
  waitFor(page, (s) => window.__JD?.getState().route.scene === s && !window.__JD.getState().transitioning, scene, { label: `scene ${scene}`, ...opts });
const saveOf = (page, id) => page.evaluate((id) => window.__JD.getState().save.cases[id] ?? null, id);
const skipText = (page) => page.evaluate(() => window.__JD.skipText());

async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.scene, .page, .chat__scroll, .sl__bottom, .sheet__body, .iq__verdict, .recon__pagewrap, .iq-mag')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${String(e.className).split(' ').slice(0, 2).join('.')} ${e.scrollWidth}>${e.clientWidth}`);
    }
    return res;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}

/** Images in view that failed to load (broken image icons). */
async function brokenImages(page, label) {
  const bad = await page.evaluate(() =>
    [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src') && i.getBoundingClientRect().width > 0).map((i) => i.getAttribute('src')),
  );
  if (bad.length) problems.push(`${label}: broken images → ${bad.join(', ')}`);
}

function namer(tag) {
  let n = 0;
  return (s) => `${SIZE.tag}-${tag}-${String(++n).padStart(2, '0')}-${s}`;
}
async function shot(page, name) {
  await sleep(200); // CSS-only transitions run on real time
  await overflow(page, name);
  await brokenImages(page, name);
  // generous timeout: SwiftShader screenshots crawl when other browsers share the CPU
  await page.screenshot({ path: resolve(out, `${name}.png`), timeout: 120000 });
  console.log(`  📷 ${name}.png`);
}

function watch(page, tag) {
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`);
  });
}

/** Record every route the app visits (router uses pushState/replaceState, not hashchange). */
const ROUTE_RECORDER = () => {
  // kept in sessionStorage so reloads (resume checks) do not lose entries
  const rec = () => {
    const m = location.hash.match(/^#\/([a-z]+)/);
    const s = m ? m[1] : 'title';
    let a = [];
    try {
      a = JSON.parse(sessionStorage.getItem('qa:routes') || '[]');
    } catch {}
    if (a[a.length - 1] !== s) a.push(s);
    sessionStorage.setItem('qa:routes', JSON.stringify(a));
  };
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k].bind(history);
    history[k] = (...a) => {
      const r = orig(...a);
      rec();
      return r;
    };
  }
  addEventListener('popstate', rec);
};
/** --seed-random: a fixed Math.random sequence per page load (shakes, shards …), for pixel diffs between builds. */
const SEEDED_RANDOM = () => {
  let a = 0x2f6e2b1;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ------------------------------------------------------------------ prototype I-005 (?proto=i005) */
// The four pieces: SCIENCE mark on the サイエンスヒント's card, the 近い・遠い band after a verdict, the
// 余話 after the science page, the 矛盾の一文 on the case file / intro. Off = none of them in the DOM.
const scienceHintOf = (c) => c.facts.find((f) => f.scienceHint);
async function protoCount(page, sel, label, want) {
  const n = await page.locator(sel).count();
  check(want(n), `${label}: ${I005 ? 'proto i005' : 'no proto'} → ${n} × ${sel}`);
  return n;
}
async function protoBand(page, c, label, levels) {
  const lv = await page.evaluate(() => document.querySelector('.cband')?.getAttribute('data-closeness') ?? null);
  if (I005) check(levels.includes(lv), `${c.id}: ${label}: the red-cabbage band shows ${lv} (expected ${levels.join(' / ')})`);
  else check(lv === null && !(await has(page, '.cband')), `${c.id}: ${label}: no closeness band without the switch`);
}

async function drainRoutes(page, into) {
  const r = await page.evaluate(() => {
    const a = JSON.parse(sessionStorage.getItem('qa:routes') || '[]');
    // keep the current scene as the dedup anchor
    sessionStorage.setItem('qa:routes', JSON.stringify(a.slice(-1)));
    return a;
  });
  for (const s of r) if (into[into.length - 1] !== s) into.push(s);
}

async function boot(page, { url = `${BASE}?mute=1${PROTOS.length ? `&proto=${encodeURIComponent(PROTOS.join(','))}` : ''}`, reload = false } = {}) {
  if (reload) {
    await page.evaluate(() => window.__JD?.flushSave?.());
    await page.reload({ waitUntil: 'load', timeout: 120000 });
  } else await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => !!window.__JD && document.documentElement.classList.contains('app-ready'))) break;
    await tick(page, 100);
    await sleep(20);
  }
  // Freeze page time: from here on it only moves when the script ticks it. On a loaded machine
  // more than the margin can pass before pauseAt lands ("Cannot fast-forward to the past"):
  // retry with a wider margin.
  for (let margin = 100; ; margin *= 4) {
    try {
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + margin);
      break;
    } catch (e) {
      if (margin > 10000 || !/past/i.test(String(e))) throw e;
    }
  }
  await waitFor(page, () => !window.__JD.getState().transitioning, null, { label: 'boot transition' });
}

async function newPage(browser, tag) {
  const ctx = await browser.newContext({ ...SIZE.ctx, locale: 'ja-JP', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(ROUTE_RECORDER);
  if (SEED_RANDOM) await page.addInitScript(SEEDED_RANDOM);
  await page.clock.install();
  watch(page, tag);
  return { ctx, page };
}

/* ------------------------------------------------------------------ title / files / intro */
async function titleGate(page) {
  if (await has(page, '.title__enter')) {
    await page.click('.title__enter');
    await waitSel(page, '.menu__item');
    await tick(page, 900);
  }
}
async function titleToFiles(page, name) {
  await waitScene(page, 'title');
  await tick(page, 1200);
  await shot(page, name('title-gate'));
  await titleGate(page);
  await shot(page, name('title-menu'));
  await page.locator('.menu__item', { hasText: '審問を始める' }).click();
  await waitScene(page, 'prologue');
  await waitSel(page, '.prologue .dlg');
  await tick(page, 1500);
  await skipText(page);
  await tick(page, 300);
  await shot(page, name('prologue'));
  await page.locator('.prologue__top button', { hasText: 'スキップ' }).click();
  await waitScene(page, 'files');
  await waitSel(page, '.tag__open');
  await tick(page, 1600);
  await shot(page, name('files'));
  await protoCount(page, '.hookline--tag', 'files: 矛盾の一文 on the case cards', (n) => (I005 ? n === CASES.filter((c) => c.intro.hook).length : n === 0));
  // the case list: exactly the cases of this run (a prototype case only with its switch, ?proto=seeds)
  const tagIds = await page.evaluate(() => [...document.querySelectorAll('article.tag h3[id^="case-"]')].map((h) => h.id.replace(/^case-/, '').replace(/-title$/, '')));
  check(tagIds.length === CASES.length && CASES.every((c) => tagIds.includes(c.id)), `files: ${tagIds.length} case cards (expected ${CASES.length}: ${CASES.map((c) => c.id.slice(0, 3)).join(' ')})`);
  check(HIDDEN_PROTO_CASES.every((c) => !tagIds.includes(c.id)), `files: no prototype case without its switch (${HIDDEN_PROTO_CASES.map((c) => c.id).join(', ') || 'none'})`);
  const protoTags = await page.locator('.tag__proto').count();
  check(protoTags === CASES.filter((c) => c.proto).length, `files: ${protoTags} 「試作」 stamp(s) (expected ${CASES.filter((c) => c.proto).length})`);
  // the リトマス・ラボ samples say what they are on the card (2026-10-04)
  const labTags = await page.$$eval('.tag__proto[data-proto-case="lab"]', (els) => els.map((e) => e.textContent));
  check(labTags.length === CASES.filter((c) => c.proto === 'lab').length && labTags.every((t) => t === 'ラボの見本（やさしい謎・AIと作った）'), `files: ${labTags.length} card(s) labelled 「ラボの見本（やさしい謎・AIと作った）」`);
  const seen = await page.evaluate(() => window.__JD.getState().save.meta.prologueSeen);
  check(seen === true, 'prologue skip marks the prologue as seen');
}

async function openFromFiles(page, c, name) {
  const tag = page.locator(`article.tag:has(#case-${c.id}-title)`);
  await tag.scrollIntoViewIfNeeded();
  await tick(page, 300);
  await tag.locator('.tag__open').click();
  // a fresh case asks for the difficulty first
  const level = levelOf(c);
  await waitSel(page, '.dfc .dcard.is-selected', { label: 'difficulty chooser' });
  await tick(page, 1100);
  check((await page.getAttribute('.dcard.is-selected', 'data-difficulty')) === 'normal', `${c.id}: the chooser preselects 審問官`);
  await page.click(`.dcard[data-difficulty="${level}"]`);
  await tick(page, 400);
  if (name) await shot(page, name('difficulty'));
  await page.click('[data-difficulty-confirm]');
  await waitScene(page, 'intro');
  check((await saveOf(page, c.id))?.difficulty === level, `${c.id}: difficulty ${level} is saved`);
}

async function intro(page, c, name, { watchSome = true } = {}) {
  await waitSel(page, '.itc__num', { label: 'intro title card' });
  await tick(page, 1400);
  // first click completes the card (readout filled), the second continues
  await page.click('.intro__stage', { position: { x: 20, y: 120 } });
  await tick(page, 300);
  await waitSel(page, '.itc__continue');
  await tick(page, 400);
  if (watchSome) await shot(page, name('intro-title'));
  await protoCount(page, '.hookline--intro', `${c.id}: intro: 矛盾の一文 under the title`, (n) => (I005 && c.intro.hook ? n === 1 : n === 0));
  await page.click('.intro__stage', { position: { x: 20, y: 120 } });
  await waitSel(page, '.intro.is-narration');
  await tick(page, 1400);
  await skipText(page);
  await tick(page, 200);
  if (watchSome) await shot(page, name('intro-narration'));
  // advance to Jane's first line
  for (let i = 0; i < 25 && !(await has(page, '.intro.is-jane')); i++) {
    await skipText(page);
    await tick(page, 80);
    await page.click('.intro__dlg .dlg', { force: true }).catch(() => {});
    await tick(page, 260);
  }
  await tick(page, 1400);
  await skipText(page);
  await tick(page, 200);
  if (watchSome) await shot(page, name('intro-jane'));
  // skip → catchphrase cut-in → investigation
  await page.locator('.intro__skip').click();
  await waitSel(page, '.icc', { label: 'catch cut-in' });
  await tick(page, 750);
  if (watchSome) await shot(page, name('intro-catch'));
  await waitScene(page, 'investigation', { timeout: 60000 });
  const s = await saveOf(page, c.id);
  check(!!s?.token, `${c.id}: the intro created the case token`);
}

/* ------------------------------------------------------------------ investigation */
async function invReady(page) {
  await waitSel(page, '.iv .dock__input', { label: 'investigation dock' });
  await waitFor(page, () => !document.querySelector('.iv.is-presenting') && !document.querySelector('.dock.is-busy') && !document.querySelector('.flight') && !document.querySelector('.fx-cutin'), null, {
    label: 'investigation settled',
  });
}
const answerCount = (page, id) => page.evaluate((id) => (window.__JD.getState().save.cases[id]?.log ?? []).filter((e) => e.kind === 'answer').length, id);

/** Send one question; returns the answer classes of the new answer entries once the presentation is over. */
async function ask(page, c, q, { viaChip = false, onPresent } = {}) {
  const before = await answerCount(page, c.id);
  if (viaChip) {
    await page.locator('.dock__chip').first().click();
    await tick(page, 200);
  } else {
    await page.locator('.dock__input').click();
    await page.locator('.dock__input').fill(q);
  }
  await page.locator('.dock__input').press('Enter');
  const answered = ({ id, before, cut }) =>
    (cut && !!document.querySelector('.fx-cutin')) || (window.__JD.getState().save.cases[id]?.log ?? []).filter((e) => e.kind === 'answer').length > before || !!document.querySelector('.arow--error');
  if (onPresent) {
    await waitFor(page, answered, { id: c.id, before, cut: true }, { label: `answer to 「${q}」` });
    await onPresent();
  }
  await waitFor(page, answered, { id: c.id, before, cut: false }, { label: `answer to 「${q}」` });
  await invReady(page);
  const log = (await saveOf(page, c.id)).log.filter((e) => e.kind === 'answer').slice(before);
  return log;
}

async function investigation(page, c, name, { questions, full }) {
  await invReady(page);
  await tick(page, 600);
  await shot(page, name('inv-empty'));
  const { plan, probeFor, used } = questionPlan(c);
  const list = questions ? plan.slice(0, questions) : plan;

  // 0) CASE 01's first play runs the coach-mark tutorial (CASE 01 = number 1, not the id prefix)
  const tutorial = full && c.number === 1;
  if (tutorial) {
    await waitSel(page, '.coach[data-coach-step="ask"]', { label: 'tutorial: ask' });
    await tick(page, 600);
    await shot(page, name('tutorial-ask'));
  }
  // 1) 質問の例 cards (src/features/examples): 見習い / 審問官 start with 2, 教授 with none (the first at 2:00)
  const level = levelOf(c);
  let cards = await cardTexts(page);
  if (level === 'hard') {
    const next = (await page.locator('[data-example-next]').textContent().catch(() => '')) ?? '';
    check(cards.length === 0 && /(?:1:5\d|2:00)/.test(next), `${c.id}: 教授 starts without 質問の例 cards (${cards.length}; 「${next.trim()}」)`);
    await shot(page, name('inv-cards-none'));
    const ms0 = (await saveOf(page, c.id)).examples?.ms ?? 0;
    await advance(page, Math.max(0, 118_000 - ms0));
    check((await cardTexts(page)).length === 0, `${c.id}: 教授: still no card just before 2:00`);
    await advance(page, 3_000);
    await waitFor(page, () => document.querySelectorAll('.dock__chip[data-example-card]').length === 1, null, { label: '教授: the first card at 2:00' });
    cards = await cardTexts(page);
    check(cards.length === 1, `${c.id}: 教授: the first card arrives at 2:00`);
  } else {
    check(cards.length === 2, `${c.id}: ${level} starts with 2 質問の例 cards (${cards.length})`);
  }
  check(cards.length > 0 && cards.every((q) => c.intro.starterQuestions.includes(q)), `${c.id}: the first cards come from the starter questions (${cards.join(' / ')})`);
  if (!full && NO_CARD.includes(c.id.slice(0, 3))) {
    // this run solves the case without a card (素手の審問官 on the result)
  } else {
    const chipQ = cards[0];
    const a0 = await ask(page, c, chipQ, { viaChip: true });
    check(a0.length >= 1, `${c.id}: the 質問の例 card question was answered (${a0.map((a) => a.answerClass).join(',')})`);
    const left = await cardTexts(page);
    const ex = (await saveOf(page, c.id)).examples;
    check(!left.includes(chipQ) && left.length === cards.length - 1 && ex?.used?.includes(chipQ), `${c.id}: the used card left the table (${left.length} left) and is saved as used`);
  }
  if (tutorial) {
    await waitSel(page, '.coach[data-coach-step="stamp"]', { label: 'tutorial: stamp (after the first answer)' });
    await tick(page, 500);
    await shot(page, name('tutorial-stamp'));
    await page.click('[data-coach-next]');
    await waitSel(page, '.coach[data-coach-step="notebook"]', { label: 'tutorial: notebook' });
    await tick(page, 400);
    await page.click('[data-coach-skip]');
    await waitGone(page, '.coach');
    check((await page.evaluate(() => window.__JD.getState().save.meta.tutorial?.state)) === 'done', `${c.id}: the tutorial can be skipped`);
  }
  await shot(page, name('inv-first-answer'));
  if (full && level !== 'hard') {
    // one card per minute of investigation time, at most 3 on the table; a used slot refills on the next deal
    const ms0 = (await saveOf(page, c.id)).examples?.ms ?? 0;
    const at = async (t) => {
      await advance(page, Math.max(0, t - ms0));
      await tick(page, 600);
      return cardTexts(page);
    };
    const n60 = await at(61_000);
    check(n60.length === 2, `${c.id}: a new card at 1:00 refills the used slot (${n60.length} on the table)`);
    const n120 = await at(121_000);
    check(n120.length === 3, `${c.id}: 3 cards at 2:00 (${n120.length})`);
    await shot(page, name('inv-cards-3'));
    const n180 = await at(181_000);
    check(n180.length === 3 && (await page.locator('[data-example-next]').count()) === 0, `${c.id}: never more than 3 cards (${n180.length}), no countdown while the table is full`);
    check(n120.every((q) => n180.includes(q)), `${c.id}: unused cards stay on the table`);
  }

  // 2) probes — shots of the first finding cut-in / flight
  let shotFinding = false;
  for (const [i, p] of list.entries()) {
    const got = await ask(page, c, p.q, {
      onPresent: async () => {
        if (shotFinding || !full || !p.facts.length) return;
        // the stamp comes first, then the 所見入手 cut-in (step in small slices so it is not skipped)
        const cut = await waitSel(page, '.fx-cutin', { timeout: 6000, step: 60 }).then(() => true, () => false);
        if (cut) {
          shotFinding = true;
          await tick(page, 300);
          await shot(page, name('inv-finding-cutin'));
          await waitSel(page, '.flight', { timeout: 15000 }).catch(() => {});
          await tick(page, 300);
          await shot(page, name('inv-finding-flight'));
        }
      },
    });
    const cls = got.map((a) => a.answerClass).join(',');
    if (got[0]?.answerClass !== p.answer) problems.push(`${c.id}: probe 「${p.q}」 answered ${cls}, case bank says ${p.answer}`);
    else console.log(`  · Q${i + 1} 「${p.q}」 → ${cls}${got.flatMap((a) => a.unlocked ?? []).length ? ` +${got.flatMap((a) => (a.unlocked ?? []).map((f) => f.id ?? f)).join(',')}` : ''}`);

    if (full && i === 3) {
      // resume check: reload mid-investigation keeps the log and the scene
      const n = await answerCount(page, c.id);
      const exBefore = (await saveOf(page, c.id)).examples;
      const cardsBefore = await cardTexts(page);
      await boot(page, { reload: true });
      await waitScene(page, 'investigation');
      await invReady(page);
      await tick(page, 600);
      check((await answerCount(page, c.id)) === n && (await page.locator('.arow[data-answer]').count()) >= n, `${c.id}: reload in the investigation keeps the scene and all ${n} answers`);
      const exAfter = (await saveOf(page, c.id)).examples;
      const cardsAfter = await cardTexts(page);
      check(
        exAfter?.seed === exBefore?.seed && (exAfter?.ms ?? 0) >= (exBefore?.ms ?? 0) && cardsBefore.every((q) => cardsAfter.includes(q)),
        `${c.id}: reload keeps the 質問の例 table (same order seed, clock ${Math.round((exAfter?.ms ?? 0) / 1000)} s, cards ${cardsAfter.length})`,
      );
      await shot(page, name('inv-resumed-reload'));
    }
    if (full && i === 5) {
      // one whisper (hint)
      await page.locator('.ivtop__hint').click();
      await waitSel(page, '.modal-root .ivdlg__foot');
      await tick(page, 400);
      await page.locator('.modal-root button', { hasText: '囁きを聞く' }).click();
      await waitSel(page, '.whisper__close', { label: 'whisper card' });
      await tick(page, 1200);
      await skipText(page);
      await tick(page, 300);
      await shot(page, name('inv-whisper'));
      await page.locator('.whisper__close').click();
      await waitGone(page, '.whisper');
      check(((await saveOf(page, c.id)).hints ?? []).length === 1, `${c.id}: the whisper is saved as hint 1`);
    }
  }

  // 2b) 質問枠: the counter follows the counted questions; a hint request in the chat is free
  const spentNow = await budgetCheck(page, c, 'after the probes');
  if (full) {
    const free = await ask(page, c, 'ヒントをください');
    check(free.length === 1 && free[0].free === true && free[0].answerClass === 'cannot', `${c.id}: a hint request typed in the chat is not counted (${free[0]?.answerClass}${free[0]?.free ? ', free' : ''})`);
    check((await budgetCheck(page, c, 'after a free question')) === spentNow, `${c.id}: the free question left the counter at ${spentNow}`);
    check((await page.locator('.arow__free').count()) >= 1, `${c.id}: the free answer carries 「ノーカウント」`);
    // 2c) the manner seal (2026-09-30): murder / accident / culprit questions get the sealed line, free
    for (const q of ['事故ですか？', '殺されたの？', '犯人はいる？']) {
      const a = await ask(page, c, q);
      check(
        a.length === 1 && a[0].answerClass === 'cannot' && a[0].free === true && /宣告/u.test(a[0].line ?? '') && (a[0].unlocked ?? []).length === 0,
        `${c.id}: 「${q}」 gets the sealed line, free, nothing unlocked (${a[0]?.answerClass}${a[0]?.free ? ', free' : ''}: ${(a[0]?.line ?? '').slice(0, 30)})`,
      );
    }
    check((await budgetCheck(page, c, 'after the sealed questions')) === spentNow, `${c.id}: the sealed questions left the counter at ${spentNow}`);
    const ev = await ask(page, c, '争った跡は？');
    check(ev.length === 1 && ['yes', 'no', 'partial'].includes(ev[0].answerClass) && !ev[0].free, `${c.id}: 「争った跡は？」 is answered and counted (${ev[0]?.answerClass})`);
    await shot(page, name('inv-manner-seal'));
  }

  // 3) make sure every debate round has its evidence (ask more probes if needed)
  const held = async () => new Set(Object.keys((await saveOf(page, c.id)).facts ?? {}));
  for (const r of c.debate) {
    const ok = [r.answer.fact, ...(r.alsoAccept ?? [])];
    for (let k = 0; k < 3; k++) {
      const h = await held();
      if (ok.some((f) => h.has(f))) break;
      const p = probeFor(r.answer.fact, used);
      if (!p) break;
      used.add(p.q);
      await ask(page, c, p.q);
    }
  }
  // I-005: the サイエンスヒント — with the switch, ask for it (full runs) and look at its mark
  const sh = scienceHintOf(c);
  if (sh && full) {
    // (教授's hard budget may already be used up here: then the dock is closed and the run goes on without it)
    const closed = await has(page, '[data-budget-closed]');
    if (I005 && !closed && !(await held()).has(sh.id)) {
      const p = probeFor(sh.id, used);
      if (p) {
        used.add(p.q);
        await ask(page, c, p.q);
      }
    }
    const got = (await held()).has(sh.id);
    if (I005 && !got && closed) console.log(`  · the サイエンスヒント ${sh.id} was not asked for: the question budget is used up`);
    else if (I005) check(got, `${c.id}: the サイエンスヒント ${sh.id} was unlocked by questioning`);
    if (got) {
      const chip = page.locator('.fchip', { has: page.locator('[data-science-mark]') }).last();
      if (I005) {
        check((await chip.count()) === 1, `${c.id}: the chat chip of ${sh.id} carries the SCIENCE mark`);
        await chip.locator('.fchip__btn').click();
        await tick(page, 500);
        await chip.locator('.fchip__card').scrollIntoViewIfNeeded();
        await tick(page, 300);
        check((await chip.locator('.ev [data-science-mark]').count()) === 1, `${c.id}: the opened finding card of ${sh.id} carries the SCIENCE mark`);
        const tip = await chip.locator('.ev [data-science-mark]').getAttribute('title');
        check(tip === '知っていれば近道になる所見', `${c.id}: the mark explains only 「${tip}」`);
        await shot(page, name('proto-science-card'));
        await chip.locator('.fchip__btn').click();
        await tick(page, 300);
      }
      await protoCount(page, '[data-science-mark]', `${c.id}: investigation: SCIENCE marks in the chat`, (n) => (I005 ? n >= 1 : n === 0));
    }
  }
  const h = await held();
  if (full || questions === undefined) {
    for (const r of c.debate) {
      const ok = [r.answer.fact, ...(r.alsoAccept ?? [])];
      check(ok.some((f) => h.has(f)), `${c.id}: evidence for debate ${r.id} (${ok.join('/')}) was unlocked by questioning`);
    }
  }

  // 4) notebook
  if (full) {
    if (NARROW) {
      await page.locator('.ivtop__nb').click();
      await waitSel(page, '.sheet-root');
      await tick(page, 700);
      await shot(page, name('inv-notebook'));
      if (sh && h.has(sh.id)) await protoCount(page, '.sheet-root [data-science-mark]', `${c.id}: notebook: SCIENCE mark on ${sh.id}`, (n) => (I005 ? n === 1 : n === 0));
      await page.keyboard.press('Escape');
      await waitGone(page, '.sheet-root');
    } else {
      await tick(page, 400);
      await shot(page, name('inv-notebook-side'));
    }
    // title → 続きから resumes the investigation
    await page.evaluate(() => window.__JD.goto('title'));
    await waitScene(page, 'title');
    await titleGate(page);
    await tick(page, 600);
    const cont = page.locator('.menu__item', { hasText: '続きから' });
    check((await cont.count()) === 1, `${c.id}: title offers 「続きから」`);
    await shot(page, name('title-continue'));
    await cont.click();
    await waitScene(page, 'investigation');
    await invReady(page);
  }
  return h;
}

async function openInquest(page, c, name) {
  await page.locator('.ivtop__inquest').click();
  await waitSel(page, '.modal-root .ivdlg__foot');
  await tick(page, 500);
  await shot(page, name('inquest-confirm'));
  await page.locator('.modal-root .ivdlg__foot button').last().click();
  await waitScene(page, 'inquest');
  const s = await saveOf(page, c.id);
  check(s.stage === 'inquest', `${c.id}: stage = inquest after 審問を開く`);
}

/* ------------------------------------------------------------------ inquest */
const iq = (page) =>
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
          writable: !!document.querySelector('.vpanel[data-writable="on"]'),
          lives: Number(document.querySelector('.lives')?.getAttribute('data-lives') ?? -1),
          scene: window.__JD.getState().route.scene,
        }
      : { phase: null, scene: window.__JD.getState().route.scene };
  });
/** Advance time until pred(state); finishes and advances dialogue lines on the way when asked. */
async function until(page, pred, { advance = true, timeout = 120000, label = 'condition', step = 120 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await iq(page);
    if (pred(st)) return st;
    if (advance && st.dlg === 'on') {
      await skipText(page);
      await tick(page, 60);
      await page.click('.iq__dialogue .dlg', { timeout: 3000, force: true }).catch(() => {});
    }
    await tick(page, step);
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(await iq(page))}`);
}
async function lockNoise(page, round, stmtId, span) {
  const i = round.statements.findIndex((s) => s.id === stmtId);
  await page.click(`.debate__dot >> nth=${i}`);
  await waitSel(page, `.band[data-statement-id="${stmtId}"]`);
  await tick(page, 700);
  for (const h of await page.$$(`.band[data-statement-id="${stmtId}"] .noise`)) {
    const t = await h.getAttribute('data-noise');
    if (t && (t.includes(span) || span.includes(t))) {
      await h.click({ force: true });
      await tick(page, 400);
      return;
    }
  }
  throw new Error(`noise "${span}" not found in ${stmtId}`);
}
async function pickEvidence(page, factId) {
  if (NARROW) {
    await tick(page, 400); // locking with an empty chamber opens the drawer by itself
    if (!(await page.$('.sheet-root'))) await page.click('[data-loaded-slot]');
    await waitSel(page, `.sheet-root [data-fact-id="${factId}"]`);
    await tick(page, 400);
    const el = page.locator(`.sheet-root [data-fact-id="${factId}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await waitGone(page, '.sheet-root');
  } else {
    const el = page.locator(`.iq-mag [data-fact-id="${factId}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.click();
  }
  await tick(page, 150);
}
async function pickOption(page, panelId, text) {
  const scope = NARROW ? '.sheet-root ' : '.recon__side ';
  // Phones: after a pick the choice sheet stays open and moves on to the next empty frame
  // (Inquest afterPick), so the frame we want may already be showing in it.
  const shown = NARROW && (await has(page, `.sheet-root [data-choice-for="${panelId}"]`));
  if (!shown) {
    if (NARROW && (await has(page, '.sheet-root'))) {
      await page.keyboard.press('Escape');
      await waitGone(page, '.sheet-root');
    }
    await page.locator(`[data-panel-id="${panelId}"]`).scrollIntoViewIfNeeded();
    await page.click(`[data-panel-id="${panelId}"]`);
  }
  await waitSel(page, `${scope}[data-choice-for="${panelId}"]`);
  await tick(page, NARROW ? 400 : 150);
  await page.locator(`${scope}.choice__opt`, { hasText: text }).first().click();
  if (NARROW) {
    // the sheet either shows the next empty frame or closes (no empty frame left)
    await waitFor(page, (id) => !document.querySelector('.sheet-root') || !document.querySelector(`.sheet-root [data-choice-for="${id}"]`), panelId, {
      label: 'the choice sheet to move on or close',
    });
  }
  await tick(page, 200);
}
async function evidenceIds(page) {
  if (NARROW) return null; // the list lives in the drawer
  return page.evaluate(() => [...document.querySelectorAll('.iq-mag [data-fact-id]')].map((e) => e.getAttribute('data-fact-id')));
}

/** Fill one cloze blank with the option whose text is `text` (the server shows its own order). */
async function fillBlank(page, blankId, text) {
  if (!(await has(page, `.vblank[data-blank-id="${blankId}"].is-open`))) {
    if (NARROW && (await has(page, '.sheet-root'))) {
      await page.keyboard.press('Escape');
      await waitGone(page, '.sheet-root');
    }
    await page.locator(`.vblank[data-blank-id="${blankId}"]`).scrollIntoViewIfNeeded();
    await page.click(`.vblank[data-blank-id="${blankId}"]`);
  }
  await waitSel(page, '.vpick');
  await tick(page, NARROW ? 450 : 150);
  await page.locator('.vpick__opt', { hasText: text }).first().click();
  await tick(page, NARROW ? 500 : 250);
}

/** Declare in the difficulty's format: the right answer, or a partly / wholly wrong one. */
async function declare(page, c, mode, { correct }) {
  const key = c.id.slice(0, 3);
  if (mode === 'free') {
    await page.fill('#verdict-text', correct ? c.truth.summary : INCOMPLETE[key] ?? '事故だったと思う。');
  } else if (mode === 'choice') {
    const off = await page.$$eval('.vopt.is-removed, .vopt.is-wrong', (els) => els.map((e) => e.getAttribute('data-option-id')));
    const opt = c.verdictModes.choice.options.find((o) => (correct ? o.correct : !o.correct && !off.includes(o.id)));
    await page.locator(`.vopt[data-option-id="${opt.id}"]`).scrollIntoViewIfNeeded();
    await page.click(`.vopt[data-option-id="${opt.id}"]`);
  } else {
    let wrongOne = !correct;
    for (const b of c.verdictModes.cloze.blanks) {
      if (await has(page, `.vblank.is-locked[data-blank-id="${b.id}"]`)) continue;
      const text = wrongOne ? b.options.find((_, i) => i !== b.answer) : b.options[b.answer];
      wrongOne = false; // one wrong blank, the rest right → 要素不足 (missing)
      await fillBlank(page, b.id, text);
    }
    if (NARROW && (await has(page, '.sheet-root'))) {
      await page.keyboard.press('Escape');
      await waitGone(page, '.sheet-root');
    }
  }
  await tick(page, 200);
  await page.locator('[data-verdict-submit]').scrollIntoViewIfNeeded();
  await page.click('[data-verdict-submit]');
}

async function inquest(page, c, name, { full, held, level = levelOf(c), skipAfter }) {
  const mode = MODE[level];
  await until(page, (s) => s.card === 'on' || (s.step === 'play' && s.dlg === 'off'), { label: 'round card' });
  await tick(page, 900);
  await shot(page, name('inquest-round1-card'));
  await until(page, (s) => s.step === 'play' && s.dlg === 'off' && s.card === 'off', { label: 'debate play' });
  await tick(page, 1200);
  await shot(page, name('inquest-debate'));

  check((await iq(page)).lives === LIVES[level], `${c.id}: ${LIVES[level]} lights for ${level} in the header`);
  for (const [ri, round] of c.debate.entries()) {
    if (ri > 0) await until(page, (s) => s.step === 'play' && s.dlg === 'off' && s.card === 'off', { label: `round ${ri + 1}` });
    if (skipAfter !== undefined && ri >= skipAfter) {
      // the noise break is optional: skip the rest (confirm) → the verdict
      await page.click('[data-skip-debate]');
      await waitSel(page, '[data-skip-confirm]');
      await tick(page, 500);
      await shot(page, name('inquest-skip-confirm'));
      await page.click('[data-skip-confirm]');
      break;
    }
    const okIds = [round.answer.fact, ...(round.alsoAccept ?? [])];
    // the evidence the player actually holds for this round
    const listed = await evidenceIds(page);
    const fact = held ? okIds.find((f) => held.has(f)) ?? round.answer.fact : round.answer.fact;
    if (listed) check(listed.includes(fact), `${c.id}: ${round.id} evidence ${fact} is in the magazine`);
    if (ri === 0 && full) {
      // one miss with another finding
      const wrong = (listed ?? [...(held ?? [])]).find((f) => !okIds.includes(f) && c.facts.find((x) => x.id === f)?.importance >= 1);
      if (wrong) {
        await lockNoise(page, round, round.answer.statement, round.answer.span);
        await pickEvidence(page, wrong);
        await page.click('[data-fire]');
        await tick(page, 380);
        await shot(page, name('inquest-miss'));
        await until(page, (s) => s.step === 'play' && s.busy === 'off', { advance: false, label: 'after miss' });
      }
    }
    await lockNoise(page, round, round.answer.statement, round.answer.span);
    await pickEvidence(page, fact);
    if (ri === 0) await shot(page, name('inquest-loaded'));
    await page.click('[data-fire]');
    if (ri === 0) {
      await waitSel(page, '.fx-cutin', { label: 'refute cut-in' });
      await tick(page, 450);
      await shot(page, name('inquest-refute'));
    }
    await until(page, (s) => s.step === 'success' || s.phase === 'verdict', { advance: false, label: `hit ${round.id}` });
    if (ri === 0) {
      // the cleared round's reward is announced on the 「記憶修復」 card
      await until(page, (s) => s.card === 'on', { label: 'memory restored card' });
      const txt = await page.textContent('.tcard');
      check(/手がかり獲得/.test(txt ?? ''), `${c.id}: a cleared round announces its assist (${(txt ?? '').replace(/\s+/g, ' ').slice(0, 60)})`);
      if (full) {
        await tick(page, 500);
        await shot(page, name('inquest-assist-card'));
      }
    }
    if (ri === 0 && full) {
      // resume check: reload after the first round → the next round
      await until(page, (s) => (s.step === 'play' && s.dlg === 'off' && s.card === 'off') || s.phase === 'verdict', { label: 'after round 1' });
      const before = await saveOf(page, c.id);
      await boot(page, { reload: true });
      await waitScene(page, 'inquest');
      await until(page, (s) => (s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut) || s.phase === 'verdict', { label: 'resume inquest' });
      const after = await saveOf(page, c.id);
      check(after.inquest?.cleared?.includes(round.id) && after.inquest.roundIndex === before.inquest.roundIndex && after.inquest.composure === before.inquest.composure, `${c.id}: reload in the inquest resumes after ${round.id} (round ${after.inquest.roundIndex + 1}, composure ${after.inquest.composure})`);
      await tick(page, 900);
      await shot(page, name('inquest-resumed'));
    }
  }

  // verdict (in the difficulty's format)
  await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, { label: 'verdict' });
  await tick(page, 2400);
  await shot(page, name(`verdict-${mode}`));
  check((await page.getAttribute('.vpanel', 'data-verdict-mode')) === mode, `${c.id}: ${level} declares in the ${mode} format`);
  const cleared = (await saveOf(page, c.id)).snapshot?.debateCleared ?? [];
  if (mode === 'choice') {
    const struck = (await page.$$('.vopt.is-removed')).length;
    const want = c.verdictModes.assists.filter((a) => cleared.includes(a.round) && a.removeOption).length;
    check(struck === want, `${c.id}: ${cleared.length} cleared round(s) strike out ${want} option(s) (${struck})`);
  } else if (mode === 'cloze') {
    const locked = (await page.$$('.vblank.is-locked')).length;
    const want = c.verdictModes.assists.filter((a) => cleared.includes(a.round) && a.fillBlank).length;
    check(locked === want, `${c.id}: ${cleared.length} cleared round(s) pre-fill ${want} blank(s) (${locked})`);
  }
  if (full || mode !== 'free') {
    await declare(page, c, mode, { correct: false });
    await until(page, (s) => s.vstep === 'result', { advance: false, label: 'verdict result' });
    await tick(page, 1100);
    const res = await page.evaluate(() => window.__JD.getState().save.cases);
    const lv = res[c.id]?.inquest?.lastVerdict?.result;
    check(lv && lv !== 'correct', `${c.id}: a wrong ${mode} verdict is not accepted (${lv})`);
    check(res[c.id]?.inquest?.lives === LIVES[level] - 1, `${c.id}: the miss puts out one light (${res[c.id]?.inquest?.lives}/${LIVES[level]})`);
    await shot(page, name('verdict-miss'));
    await protoBand(page, c, `a wrong ${mode} verdict`, ['far', 'near']);
    await until(page, (s) => s.vstep === 'write' && s.dlg === 'off' && s.writable, { label: 'rewrite' });
    if (full) {
      // resume check at the verdict
      await tick(page, 800);
      await boot(page, { reload: true });
      await waitScene(page, 'inquest');
      await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, { label: 'resume verdict' });
      check((await iq(page)).lives === LIVES[level] - 1, `${c.id}: reload at the verdict returns to the verdict with the lights left`);
    }
  }
  await declare(page, c, mode, { correct: true });
  await until(page, (s) => s.vstep === 'result', { advance: false, label: 'verdict correct' });
  await tick(page, 1100);
  await shot(page, name('verdict-correct'));
  await protoBand(page, c, `the right ${mode} verdict`, mode === 'choice' ? ['correct'] : ['correct', 'perfect']);

  // reconstruction
  await until(page, (s) => s.phase === 'reconstruction' && s.dlg === 'off' && !s.cut, { label: 'reconstruction' });
  await tick(page, 600);
  await until(page, (s) => s.dlg === 'off' && !s.cut, { label: 'recon settled' });
  await tick(page, 1200);
  await shot(page, name('recon'));
  const blanks = c.reconstruction.panels.filter((p) => p.choice);
  for (const [k, p] of blanks.entries()) {
    const good = p.choice.options.find((o) => o.correct).text;
    const bad = p.choice.options.find((o) => !o.correct).text;
    await pickOption(page, p.id, full && k === 0 ? bad : good);
  }
  await page.click('[data-recon-submit]');
  if (full) {
    await until(page, (s) => s.dlg === 'on', { advance: false, label: 'recon wrong line' });
    await until(page, (s) => s.dlg === 'off' && s.busy === 'off', { label: 'recon retry' });
    await tick(page, 300);
    await pickOption(page, blanks[0].id, blanks[0].choice.options.find((o) => o.correct).text);
    await page.click('[data-recon-submit]');
  }
  await until(page, (s) => s.phase === 'finale' && s.dlg === 'on', { advance: false, label: 'finale' });
  for (let k = 0; k < 3; k++) {
    await skipText(page);
    await tick(page, 100);
    await page.click('.iq__dialogue .dlg', { force: true }).catch(() => {});
    await tick(page, 1300);
  }
  await skipText(page);
  await tick(page, 500);
  await shot(page, name('finale'));
  await until(page, (s) => s.scene === 'resolution', { label: 'resolution' });
  const st = await saveOf(page, c.id);
  check(st.stage === 'resolution' && st.snapshot?.solved && st.snapshot?.reconstructed, `${c.id}: after the finale stage = resolution, token solved + reconstructed`);
}

/* ------------------------------------------------------------------ endings */
async function resolution(page, c, name, { full }) {
  await waitScene(page, 'resolution');
  await waitSel(page, '.res-cer', { label: 'ceremony' });
  await tick(page, 1900);
  await shot(page, name('res-ceremony'));
  // Holma's lines → assemble → name → farewell
  for (let i = 0; i < 12 && (await has(page, '.res-cer__dock .dlg')); i++) {
    await skipText(page);
    await tick(page, 120);
    await page.click('.res-cer__dock .dlg', { force: true }).catch(() => {});
    await tick(page, 350);
  }
  await waitSel(page, '.nameplate.is-done', { label: 'name restored', timeout: 60000 });
  await tick(page, 1200);
  await shot(page, name('res-named'));
  await waitSel(page, '.dlg--restored', { label: 'farewell' });
  await skipText(page);
  await tick(page, 900);
  if (full) await shot(page, name('res-farewell'));
  for (let i = 0; i < 16 && !(await has(page, '.res-rec')); i++) {
    await skipText(page);
    await tick(page, 120);
    await page.click('.res-cer__dock .dlg', { force: true }).catch(() => {});
    await tick(page, 350);
  }
  await waitSel(page, '.res-rec', { label: 'record page' });
  await tick(page, 1000);
  await shot(page, name('res-record'));
  if (full) {
    await boot(page, { reload: true });
    await waitScene(page, 'resolution');
    await waitFor(page, () => !!document.querySelector('.res-rec') || !!document.querySelector('.res-cer'), null, { label: 'resolution after reload' });
    check(await has(page, '.res-rec'), `${c.id}: reload on the record page keeps the record (no second ceremony)`);
    if (!(await has(page, '.res-rec'))) {
      await page.locator('.res-cer__skip').click();
      await waitSel(page, '.res-rec');
    }
  }
  const cta = page.locator('.res-rec__next .end-cta, .res-rec__next button').first();
  await cta.scrollIntoViewIfNeeded();
  await tick(page, 300);
  await cta.click();
  await waitScene(page, 'science');
}

async function science(page, c, name, { full }) {
  await waitSel(page, '.sci-article', { label: 'science article' });
  await tick(page, 900);
  await shot(page, name('science-top'));
  check((await saveOf(page, c.id)).stage === 'science', `${c.id}: stage = science`);
  if (full) {
    await boot(page, { reload: true });
    await waitScene(page, 'science');
    await waitSel(page, '.sci-article');
    check(true, `${c.id}: reload keeps the science page`);
    const dg = page.locator('.dg').first();
    if (await dg.count()) {
      await dg.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await tick(page, 3600);
      await shot(page, name('science-diagram'));
    }
  }
  const aside = c.science.aside;
  await protoCount(page, '.sci-aside', `${c.id}: science: 余話`, (n) => (I005 && aside ? n === 1 : n === 0));
  if (I005 && aside) {
    await page.evaluate(() => document.querySelector('.sci-aside')?.scrollIntoView({ block: 'start' }));
    await tick(page, 600);
    await shot(page, name('proto-science-aside'));
    const ph = await page.locator('[data-supervisor-placeholder]').count();
    check(ph === (aside.supervisorNote === 'placeholder' ? 1 : 0), `${c.id}: the 「先生のひとこと」 sample frame ${ph ? 'is shown' : 'is not shown'}`);
    if (ph) {
      const t = (await page.locator('[data-supervisor-placeholder]').textContent()) ?? '';
      check(t.includes('（見本）ここに、くられ先生のひとことが入ります'), `${c.id}: the sample frame says only that it is a sample`);
    }
  }
  await page.evaluate(() => document.querySelector('.sci-end')?.scrollIntoView({ block: 'center' }));
  await tick(page, 600);
  await shot(page, name('science-end'));
  await page.locator('.sci-end .end-cta').click();
  await waitScene(page, 'quiz');
}

async function quiz(page, c, name, { full }) {
  await waitSel(page, '.qz-card', { label: 'quiz card' });
  await tick(page, 700);
  await shot(page, name('quiz'));
  const answers = await page.evaluate(async ([id, protos]) => {
    const token = window.__JD.getState().save.cases[id].token;
    // a prototype case answers only with its switch (the x-janedoe-proto header, shared/proto.ts)
    const headers = { 'content-type': 'application/json', ...(protos ? { 'x-janedoe-proto': protos } : {}) };
    const r = await fetch('api/solution', { method: 'POST', headers, body: JSON.stringify({ caseId: id, token }) });
    return (await r.json()).quiz.map((q) => q.answer);
  }, [c.id, PROTOS.join(',')]);
  for (const [qi, ans] of answers.entries()) {
    await waitSel(page, '.qz-choice');
    await tick(page, 400);
    if (qi === 0 && full) {
      await page.locator('.qz-choice').nth(ans === 0 ? 1 : 0).click();
      await tick(page, 700);
      await shot(page, name('quiz-wrong'));
    }
    await page.locator('.qz-choice').nth(ans).click();
    await tick(page, 700);
    if (qi === 0 && full) {
      // resume check: a reload mid-quiz keeps the answered question
      await boot(page, { reload: true });
      await waitScene(page, 'quiz');
      await waitSel(page, '.qz-card');
      const q = (await saveOf(page, c.id)).quiz;
      check(q?.correct?.includes('0'), `${c.id}: reload in the quiz keeps the answered question`);
      await tick(page, 600);
      if (await has(page, '.qz-fb__actions .btn')) await page.click('.qz-fb__actions .btn');
      await tick(page, 700);
      continue;
    }
    await page.click('.qz-fb__actions .btn');
    await tick(page, qi === answers.length - 1 ? 1600 : 700);
  }
  await waitSel(page, '.qz-done', { label: 'quiz complete' });
  await tick(page, 1200);
  await shot(page, name('quiz-complete'));
  const s = await saveOf(page, c.id);
  check(s.stage === 'complete' && !!s.lastResult?.rank, `${c.id}: the quiz seals the run (stage complete, rank ${s.lastResult?.rank})`);
  await page.locator('.qz-done .btn').first().click();
  await waitScene(page, 'result');
}

async function result(page, c, name, { full }) {
  await waitSel(page, '.rs-rank__seal', { label: 'rank seal' });
  await tick(page, 2800);
  await shot(page, name('result'));
  const s = await saveOf(page, c.id);
  // 名探偵度数: the run's points are stored, the case best is at least that, the block shows the total
  const pts = s.lastResult?.stats?.points;
  check(typeof pts === 'number' && pts >= 0 && (s.bestPoints ?? -1) >= pts, `${c.id}: the run earned +${pts} (case best ${s.bestPoints})`);
  const degree = await page.evaluate(() => {
    const cases = window.__JD.getState().save.cases;
    return { total: Object.values(cases).reduce((a, x) => a + (x.bestPoints ?? 0), 0), shown: Number(document.querySelector('.rs-deg')?.getAttribute('data-degree')) };
  });
  check(degree.shown === degree.total, `${c.id}: the result shows 名探偵度数 ${degree.shown} (save ${degree.total})`);
  // 質問枠: the run was scored against the budget of the difficulty played, and the tile says so
  const st = s.lastResult?.stats ?? {};
  const budget = expectedBudget(c, levelOf(c));
  check(st.budget === budget && typeof st.spent === 'number' && st.spent <= st.asked, `${c.id}: the result stores the question budget ${st.budget} (expected ${budget}) and ${st.spent} counted of ${st.asked}`);
  const tile = await page.evaluate(() => [...document.querySelectorAll('.rs-stat')].find((e) => e.textContent.includes('質問数'))?.textContent.replace(/\s+/g, '') ?? '');
  check(tile.includes(`${st.spent}/${budget}問`), `${c.id}: the result tile shows the questions against the budget (${tile})`);
  // the clear time and the first clear (docs/decisions.md 2026-09-29): a fresh profile, so this run is the first clear
  const clearMs = s.lastResult?.clearMs;
  const timeTile = await page.evaluate(() => [...document.querySelectorAll('.rs-stat')].find((e) => e.textContent.includes('解決タイム'))?.textContent.replace(/\s+/g, '') ?? '');
  check(typeof clearMs === 'number' && clearMs > 0 && timeTile.length > 0, `${c.id}: the result shows the clear time (${timeTile}; ${Math.round((clearMs ?? 0) / 1000)} s)`);
  const firstLine = ((await page.locator('[data-first-clear]').textContent().catch(() => '')) ?? '').replace(/\s+/g, '');
  check(
    s.firstClear?.clearMs === clearMs && s.lastResult?.firstClear === true && firstLine.includes('初回の解決') && firstLine.includes('初見'),
    `${c.id}: the first clear is recorded and shown with 「初見」 (${firstLine})`,
  );
  const own = st.examplesUsed === 0;
  check((await page.locator('[data-distinction="own-words"]').count()) === (own ? 1 : 0), `${c.id}: 「素手の審問官」 ${own ? 'shown (no card used)' : 'not shown'} (examplesUsed ${st.examplesUsed})`);
  if (full) {
    await boot(page, { reload: true });
    await waitScene(page, 'result');
    await waitSel(page, '.rs-rank__seal');
    check(true, `${c.id}: reload keeps the result`);
    await tick(page, 2800);
  }
  const btn = page.locator('.rs-actions button', { hasText: '事件ファイルへ' }).first();
  await btn.scrollIntoViewIfNeeded();
  await tick(page, 300);
  await btn.click();
  await waitScene(page, 'files');
  await waitSel(page, `article.tag:has(#case-${c.id}-title) .tag__rank-value`, { label: 'best rank on the case tag' });
  const shown = await page.locator(`article.tag:has(#case-${c.id}-title) .tag__rank-value`).textContent();
  check(shown === s.bestRank, `${c.id}: files show best rank ${shown} (save ${s.bestRank}, run ${s.lastResult?.rank} ${s.lastResult?.title ?? ''})`);
  const meter = await page.locator('.dmeter__total').textContent();
  check(Number(meter) >= (s.bestPoints ?? 0), `${c.id}: the files header shows 名探偵度数 ${meter}`);
  const firstTag = ((await page.locator(`article.tag:has(#case-${c.id}-title) .tag__first`).textContent().catch(() => '')) ?? '').replace(/\s+/g, '');
  const total = ((await page.locator('[data-first-total]').textContent().catch(() => '')) ?? '').replace(/\s+/g, '');
  check(firstTag.includes('初見') && total.includes('初見タイム合計'), `${c.id}: the case tag shows the first clear (${firstTag}) and the files header 初見タイム合計 (${total})`);
  const tag = page.locator(`article.tag:has(#case-${c.id}-title)`);
  await tag.scrollIntoViewIfNeeded();
  await tick(page, 1600);
  await shot(page, name('files-rank'));
  return s;
}

/* ------------------------------------------------------------------ runs */
const ORDER_FULL = ['title', 'prologue', 'files', 'intro', 'investigation', 'title', 'investigation', 'inquest', 'resolution', 'science', 'quiz', 'result', 'files'];

async function fullFlow(browser, c) {
  const key = c.id.slice(0, 3);
  const tag = `${key}-full`;
  const name = namer(tag);
  console.log(`\n[qa] FULL ${c.id} @ ${SIZE.tag} ${SIZE.ctx.viewport.width}x${SIZE.ctx.viewport.height}`);
  const { ctx, page } = await newPage(browser, tag);
  const routes = [];
  const t0 = Date.now();
  try {
    await boot(page);
    await page.evaluate(() => window.__JD.setSettings({ textSpeed: 'fast' }));
    await titleToFiles(page, name);
    await openFromFiles(page, c, name);
    await intro(page, c, name);
    await drainRoutes(page, routes);
    const held = await investigation(page, c, name, { full: true });
    await drainRoutes(page, routes);
    await openInquest(page, c, name);
    await inquest(page, c, name, { full: true, held });
    await drainRoutes(page, routes);
    await resolution(page, c, name, { full: true });
    await science(page, c, name, { full: true });
    await quiz(page, c, name, { full: true });
    await result(page, c, name, { full: true });
    await drainRoutes(page, routes);
    check(JSON.stringify(routes) === JSON.stringify(ORDER_FULL), `${c.id}: scene order ${routes.join(' → ')}`);
    // the finished case is no longer offered as 「続きから」
    await page.evaluate(() => window.__JD.goto('title'));
    await waitScene(page, 'title');
    await titleGate(page);
    check((await page.locator('.menu__item', { hasText: '続きから' }).count()) === 0, `${c.id}: a completed case is not offered as 「続きから」`);
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    console.error(`  ✗ ${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${SIZE.tag}-${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    console.log(`  (${Math.round((Date.now() - t0) / 1000)} s)`);
    await ctx.close();
  }
}

async function smoke(browser, c) {
  const key = c.id.slice(0, 3);
  const tag = `${key}-smoke`;
  const name = namer(tag);
  console.log(`\n[qa] SMOKE ${c.id} @ ${SIZE.tag}`);
  const { ctx, page } = await newPage(browser, tag);
  const t0 = Date.now();
  try {
    await boot(page);
    await page.evaluate(() => {
      // the coach-mark tutorial of CASE 01 belongs to its full run, not to a smoke run
      window.__JD.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
      window.__JD.setSettings({ textSpeed: 'fast' });
    });
    await titleGate(page);
    await page.locator('.menu__item', { hasText: '事件ファイル' }).click();
    await waitScene(page, 'files');
    await waitSel(page, '.tag__open');
    await tick(page, 1200);
    await openFromFiles(page, c);
    await intro(page, c, name, { watchSome: false });
    await investigation(page, c, name, { full: false, questions: 3 });
    await shot(page, name('inv-after-3'));
    // jump: a dev-minted token with every finding (the investigation itself is covered by the full run)
    await page.evaluate(async (id) => {
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: id, stage: 'investigated' }) });
      const { token, progress } = await r.json();
      window.__JD.updateCase(id, { stage: 'inquest', token, snapshot: progress });
      window.__JD.flushSave();
      window.__JD.goto('inquest', { caseId: id });
    }, c.id);
    await waitScene(page, 'inquest');
    await inquest(page, c, name, { full: false, skipAfter: SKIP_AFTER[key] });
    await resolution(page, c, name, { full: false });
    await science(page, c, name, { full: false });
    await quiz(page, c, name, { full: false });
    await result(page, c, name, { full: false });
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    console.error(`  ✗ ${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${SIZE.tag}-${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    console.log(`  (${Math.round((Date.now() - t0) / 1000)} s)`);
    await ctx.close();
  }
}

/**
 * Game over: the last light goes out.
 *   審問官 (c01) → the case starts over (stage intro, a new token, no inquest), c02 untouched.
 *   見習い (c02) → back to the start of the inquest, lights refilled, token (findings) kept;
 *                  title 「続きから」 reopens the noise break.
 */
async function gameOverRun(browser) {
  const tag = 'gameover';
  const name = namer(tag);
  console.log(`\n[qa] GAME OVER @ ${SIZE.tag}`);
  const { ctx, page } = await newPage(browser, tag);
  const t0 = Date.now();
  const c1 = CASES.find((c) => c.id.startsWith('c01'));
  const c2 = CASES.find((c) => c.id.startsWith('c02'));
  const seed = (caseId, difficulty, extra) =>
    page.evaluate(
      async ({ caseId, difficulty, extra }) => {
        const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage: 'investigated' }) });
        const { token, progress } = await r.json();
        window.__JD.updateCase(caseId, {
          stage: 'inquest',
          token,
          snapshot: progress,
          difficulty,
          inquest: { phase: 'verdict', roundIndex: 0, composure: 5, cleared: [], misses: 0, grants: 0, verdictAttempts: 2, suspensions: 0, lives: 1, debateSkipped: true, ...extra },
        });
        window.__JD.flushSave();
        window.__JD.goto('inquest', { caseId });
        return token;
      },
      { caseId, difficulty, extra },
    );
  const lastLight = async (c, level) => {
    await waitScene(page, 'inquest');
    await until(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, { label: 'verdict (last light)' });
    check((await iq(page)).lives === 1, `${c.id}: one light left`);
    await declare(page, c, MODE[level], { correct: false });
    await until(page, (s) => s.phase === 'gameover', { label: 'game over' });
    await waitSel(page, '.gover[data-gameover]:not([data-gameover="pending"])', { label: 'restart rule applied' });
    await tick(page, 5600);
    await waitSel(page, '[data-gameover-title]:not([disabled])');
  };
  try {
    await boot(page);
    await page.evaluate(() => {
      window.__JD.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
      window.__JD.setSettings({ textSpeed: 'fast' });
    });
    // 審問官: the case restarts from the beginning
    await page.evaluate((id) => window.__JD.updateCase(id, { stage: 'investigation', difficulty: 'easy', notes: 'keep me', elapsedMs: 4242 }), c2.id);
    const other = await page.evaluate((id) => JSON.stringify(window.__JD.getState().save.cases[id]), c2.id);
    const oldToken = await seed(c1.id, 'normal');
    await lastLight(c1, 'normal');
    await shot(page, name('gameover-restart'));
    const s1 = await saveOf(page, c1.id);
    check(s1.stage === 'intro' && !s1.inquest && s1.log.length === 0 && !!s1.token && s1.token !== oldToken && s1.difficulty === 'normal' && s1.gameOvers === 1, `${c1.id}: 審問官 game over restarts the case with a new token (stage ${s1.stage})`);
    check((await page.evaluate((id) => JSON.stringify(window.__JD.getState().save.cases[id]), c2.id)) === other, `${c2.id}: another case's record is untouched`);
    await page.click('[data-gameover-title]');
    await waitScene(page, 'title');
    check(true, `${c1.id}: game over → title`);
    // 見習い: back to the start of the inquest
    await seed(c2.id, 'easy', { triedChoices: [] });
    const unlockedBefore = (await saveOf(page, c2.id)).snapshot?.unlocked?.length ?? -1;
    await lastLight(c2, 'easy');
    await shot(page, name('gameover-inquest'));
    const s2 = await saveOf(page, c2.id);
    // (every server call re-issues the token, so "kept" = the same unlocked findings, not the same string)
    check(
      s2.stage === 'inquest' && s2.inquest?.phase === 'debate' && s2.inquest?.lives === 10 && !!s2.token && (s2.snapshot?.unlocked?.length ?? 0) === unlockedBefore && s2.gameOvers === 1,
      `${c2.id}: 見習い game over → start of the inquest, lights refilled, findings kept (${JSON.stringify({ stage: s2.stage, phase: s2.inquest?.phase, lives: s2.inquest?.lives, unlocked: s2.snapshot?.unlocked?.length, gameOvers: s2.gameOvers })})`,
    );
    await page.click('[data-gameover-title]');
    await waitScene(page, 'title');
    await titleGate(page);
    await tick(page, 600);
    await page.locator('.menu__item', { hasText: '続きから' }).click();
    await waitScene(page, 'inquest');
    await until(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, { label: 'noise break again' });
    check((await iq(page)).lives === 10, `${c2.id}: 「続きから」 reopens the noise break with 10 lights`);
    await shot(page, name('gameover-resumed'));
  } catch (e) {
    problems.push(`${tag}: ${e.message.split('\n')[0]}`);
    console.error(`  ✗ ${tag}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(out, `${SIZE.tag}-${tag}-FAIL.png`) }).catch(() => {});
  } finally {
    console.log(`  (${Math.round((Date.now() - t0) / 1000)} s)`);
    await ctx.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  for (const c of FULL) await fullFlow(browser, c);
  for (const c of SMOKES) await smoke(browser, c);
  if (SMOKE) await gameOverRun(browser);
} finally {
  await browser.close();
  if (server) await server.close();
}

console.log(`\n[qa] ${passed.length} checks passed`);
if (problems.length) {
  console.error(`[qa] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('[qa] OK — full flow, resume checks and smoke runs passed; no page/console errors or overflow.');
