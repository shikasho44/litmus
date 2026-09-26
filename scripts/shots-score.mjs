// 名探偵度数 / 減点 visual QA (2026-09-27) — screenshots and checks of:
//   the result screen's 名探偵度数 block (first clear with a badge rank-up mid-count and at rest,
//   a replay that did not beat the case best, reduced motion), the Files header meter and the
//   BEST points on the case tags, the 遊び方 page, and the in-play 「減点 −n」 floats in real
//   play (hint, noise-break miss, 泣きつき, wrong verdict, recall-test retry) plus the game-over
//   tag — at PC 1280x800 (DPR 1.5) and phone 390x844 (DPR 2).
//
//   node scripts/shots-score.mjs                  both sizes
//   node scripts/shots-score.mjs --size sp        one size      --only result,files   subset
//
// Uses the dev server on :5194 (SCORE_PORT) — started here in rules mode when nothing answers
// (never a paid pipeline). Real time: waits on DOM state. Output: qa/score/<size>-<nn>-<name>.png.
// Exit 1 on page errors, console errors, failed checks or horizontal overflow.
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
const ONLY = arg('--only')?.split(',');
const ONLY_SIZE = arg('--size');
const PORT = Number(process.env.SCORE_PORT || 5194);
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'score');
mkdirSync(out, { recursive: true });

const CASES = Object.fromEntries(
  readdirSync(resolve(root, 'content', 'cases'))
    .filter((d) => /^c\d\d/.test(d))
    .map((dir) => [dir.slice(0, 3), JSON.parse(readFileSync(resolve(root, 'content', 'cases', dir, 'case.json'), 'utf8'))]),
);
const C1 = 'c01-room-without-breath';
const C2 = 'c02-ball-at-dusk';
const C3 = 'c03-shed-in-snow';
const SIZES = {
  pc: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 },
  sp: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/* ------------------------------------------------------------------ server */
let server = null;
async function health() {
  try {
    const r = await fetch(`${BASE}api/health`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
{
  const h = await health();
  if (h && h.mode !== 'rules') {
    console.error(`[score] the server on :${PORT} runs in "${h.mode}" mode — the shots need rules mode (no paid calls)`);
    process.exit(1);
  }
  if (!h) {
    console.log(`[score] starting vite on :${PORT} (rules mode)`);
    server = spawn(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PIPELINE_MODE: 'rules', DECISION_PROVIDER: 'rules', LLM_PROVIDER: 'none', TRACE_FILE: '0' },
    });
    server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    let ok = null;
    for (let i = 0; i < 200 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 250));
      ok = await health();
    }
    if (!ok) {
      console.error('[score] dev server did not start');
      server.kill();
      process.exit(1);
    }
  }
}

/* ------------------------------------------------------------------ helpers */
const problems = [];
const check = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) problems.push(`CHECK FAILED: ${msg}`);
  return !!cond;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function attach(page, tag) {
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${tag} console: ${m.text()}`);
  });
}
async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const vw = window.innerWidth;
    const res = [];
    if (document.documentElement.scrollWidth > vw + 1) res.push(`document ${document.documentElement.scrollWidth}>${vw}`);
    for (const e of document.querySelectorAll('.scene, .page, .modal__body, .rs-deg, .dmeter, .files__heading')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${String(e.className).split(' ').slice(0, 2).join('.')} ${e.scrollWidth}>${e.clientWidth}`);
    }
    // the new blocks must fit their own box
    for (const e of document.querySelectorAll('.rs-deg, .dmeter, .fx-pen')) {
      const r = e.getBoundingClientRect();
      if (r.width && (r.left < -1 || r.right > vw + 1)) res.push(`${String(e.className).split(' ')[0]} off-screen ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return res;
  });
  if (o.length) problems.push(`${label}: horizontal overflow → ${o.join(', ')}`);
}
function namer(size) {
  let n = 0;
  return async (page, name, settle = 350) => {
    await wait(settle);
    await overflow(page, `${size} ${name}`);
    const file = `${size}-${String(++n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: resolve(out, file) });
    console.log(`  📷 ${file}`);
  };
}
async function waitFn(page, fn, a, { timeout = 45000, label = 'condition', each } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, a)) return true;
    if (each) await each();
    await wait(100);
  }
  throw new Error(`timeout: ${label}`);
}
const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel);
const iqState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.iq');
    return el ? { phase: el.dataset.phase, step: el.dataset.step, vstep: el.dataset.verdictStep, dlg: el.dataset.dialogue, card: el.dataset.card, cut: !!document.querySelector('.fx-cutin'), writable: !!document.querySelector('.vpanel[data-writable="on"]') } : null;
  });
async function untilIq(page, pred, label, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await iqState(page);
    if (st && pred(st)) return st;
    if (st?.dlg === 'on') {
      await page.evaluate(() => window.__JD.skipText());
      await page.click('.iq__dialogue .dlg', { force: true, timeout: 2000 }).catch(() => {});
    }
    await wait(160);
  }
  throw new Error(`timeout: ${label} ${JSON.stringify(await iqState(page))}`);
}
/** Waits for a 「減点」 float and returns its number text (e.g. "−3.5"). */
async function penaltyFloat(page, label) {
  await waitFn(page, () => !!document.querySelector('.fx-pen'), null, { label: `減点 float (${label})`, timeout: 15000 });
  return text(page, '.fx-pen .fx-pen__n');
}

async function fresh(ctx, tag) {
  const page = await ctx.newPage();
  attach(page, tag);
  await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__JD.setMeta({ prologueSeen: true, tutorial: { state: 'done', step: 0 } });
    window.__JD.setSettings({ textSpeed: 'instant' });
  });
  return page;
}

/** A dev-minted token at `stage`, written into the save, then the scene. */
async function seed(page, caseId, stage, scene, patch = {}) {
  await page.evaluate(
    async ({ caseId, stage, scene, patch }) => {
      const J = window.__JD;
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage }) });
      const { token, progress } = await r.json();
      J.updateCase(caseId, { stage: scene, token, snapshot: progress, difficulty: 'normal', ...patch });
      J.flushSave();
      J.goto(scene, { caseId });
    },
    { caseId, stage, scene, patch },
  );
}

const STATS = (o = {}) => ({ score: 100, asked: 18, keyQuestions: 10, answered: 18, hintsUsed: 0, debateMisses: 0, grants: 0, verdictAttempts: 1, suspensions: 0, gameOvers: 0, quizMisses: 0, debateRounds: 2, debateCleared: 2, difficulty: 1, estimatedMinutes: 15, ...o });

/** c01 just sealed (S+ on 教授 = +150) with c02 already at +100: the total goes 100 → 250 (Lv1 → Lv3). */
async function seedFirstClear(page) {
  await page.evaluate(
    ({ C1, C2, stats }) => {
      const J = window.__JD;
      J.updateCase(C2, { stage: 'complete', completed: true, clears: 1, bestRank: 'A', bestPoints: 100, gameOversAtClear: 0 });
      J.updateCase(C1, {
        stage: 'complete',
        completed: true,
        clears: 1,
        difficulty: 'hard',
        bestRank: 'S+',
        bestPoints: 150,
        gameOversAtClear: 0,
        lastResult: { rank: 'S+', title: '完全無欠の審問官', at: Date.now(), elapsedMs: 11 * 60000 + 12000, playDifficulty: 'hard', stats },
      });
      J.flushSave();
    },
    { C1, C2, stats: STATS({ points: 150 }) },
  );
}

/* ------------------------------------------------------------------ runs */
async function runSize(browser, size) {
  const narrow = size === 'sp';
  const shot = namer(size);
  const want = (k) => !ONLY || ONLY.includes(k);
  const ctxOf = (reducedMotion = 'no-preference') => browser.newContext({ ...SIZES[size], locale: 'ja-JP', reducedMotion });
  const section = async (key, fn, reduced = false) => {
    if (!want(key)) return;
    const ctx = await ctxOf(reduced ? 'reduce' : 'no-preference');
    console.log(`\n[score] ${size}: ${key}`);
    try {
      await fn(ctx);
    } catch (e) {
      const msg = String(e.message).split(/\r?\n/)[0];
      problems.push(`${size} ${key}: ${msg}`);
      console.error(`  ✗ ${size} ${key}: ${msg}`);
      for (const pg of ctx.pages()) await pg.screenshot({ path: resolve(out, `${size}-FAIL-${key}.png`) }).catch(() => {});
    } finally {
      await ctx.close().catch(() => {});
    }
  };

  /* ---- 1. result: first clear, rank-up while counting ---- */
  await section('result', async (ctx) => {
    const page = await fresh(ctx, `${size}-result`);
    await seedFirstClear(page);
    await page.evaluate((C1) => window.__JD.goto('result', { caseId: C1, fresh: '1' }), C1);
    await page.waitForSelector('.rs-deg', { state: 'attached', timeout: 30000 });
    if (narrow) {
      // the block is below the seal on phones: follow it while it counts
      await wait(1500);
      await page.evaluate(() => document.querySelector('.rs-deg')?.scrollIntoView({ block: 'center' }));
    }
    await waitFn(page, () => !!document.querySelector('.rs-deg__up'), null, { label: 'rank-up', timeout: 12000 });
    await shot(page, 'result-rankup-moment', 250);
    await waitFn(page, () => document.querySelector('.rs-deg__total-num')?.textContent === '250' && getComputedStyle(document.querySelector('.rs-deg')).opacity === '1', null, { label: 'count finished', timeout: 12000 });
    await wait(1200);
    if (narrow) await page.evaluate(() => window.scrollTo(0, 0));
    if (narrow) await page.evaluate(() => document.querySelector('.rs-page')?.scrollTo(0, 0));
    await shot(page, 'result-first-clear', 200);
    if (narrow) {
      await page.evaluate(() => document.querySelector('.rs-deg')?.scrollIntoView({ block: 'center' }));
      await shot(page, 'result-degree-block', 300);
    }
    check((await text(page, '.rs-deg__gain-num')) === '+150', `${size}: 獲得 +150 (100 × 1.4 + S+ 10)`);
    check((await text(page, '.rs-deg__name')) === 'Lv.3 腕利き探偵', `${size}: the badge ends at Lv.3 腕利き探偵 (${await text(page, '.rs-deg__name')})`);
    check((await page.getAttribute('.rs-deg .detb', 'data-level')) === '3', `${size}: the badge shows level 3`);
    check(/あと110/.test((await text(page, '.rs-deg__next')) ?? ''), `${size}: next badge 名探偵 in 110 (${await text(page, '.rs-deg__next')})`);
    check(!(await has(page, '.rs-deg__note')), `${size}: a first clear has no best-record note`);
  });

  /* ---- 2. result: a replay that did not beat the case best ---- */
  await section('replay', async (ctx) => {
    const page = await fresh(ctx, `${size}-replay`);
    await page.evaluate(
      ({ C1, stats }) => {
        const J = window.__JD;
        J.updateCase(C1, {
          stage: 'complete',
          completed: true,
          clears: 2,
          difficulty: 'easy',
          bestRank: 'S+',
          bestPoints: 150,
          gameOvers: 1,
          gameOversAtClear: 1,
          lastResult: { rank: 'A', title: 'ためらわぬ弾丸', at: Date.now(), elapsedMs: 14 * 60000, playDifficulty: 'easy', prevBest: 'S+', prevBestPoints: 150, stats },
        });
      },
      { C1, stats: STATS({ score: 80, points: 48, hintsUsed: 1, quizMisses: 2, verdictAttempts: 2, gameOvers: 1, debateCleared: 1 }) },
    );
    await page.evaluate((C1) => window.__JD.goto('result', { caseId: C1 }), C1);
    await page.waitForSelector('.rs-deg', { timeout: 30000 });
    if (narrow) await page.evaluate(() => document.querySelector('.rs-deg')?.scrollIntoView({ block: 'center' }));
    await shot(page, 'result-replay-not-beaten', 900);
    check(/更新ならず/.test((await text(page, '.rs-deg__note')) ?? ''), `${size}: 「この事件の最高記録 +150 は更新ならず」 (${await text(page, '.rs-deg__note')})`);
    check((await text(page, '.rs-deg__gain-num')) === '+48', `${size}: 獲得 +48 (80 × 0.6)`);
    check((await text(page, '.rs-deg__total-num')) === '150', `${size}: the total stays 150`);
    check(!(await has(page, '.rs-deg__up')), `${size}: no rank-up on a revisit`);
    const tiles = await page.evaluate(() => [...document.querySelectorAll('.rs-stat')].map((e) => e.textContent));
    check(tiles.some((t) => /ゲームオーバー1回/.test(t)), `${size}: the verdict tile names the run's game over`);
  });

  /* ---- 3. reduced motion: the final state at once ---- */
  await section(
    'reduced',
    async (ctx) => {
      const page = await fresh(ctx, `${size}-reduced`);
      await seedFirstClear(page);
      await page.evaluate((C1) => window.__JD.goto('result', { caseId: C1, fresh: '1' }), C1);
      await page.waitForSelector('.rs-deg', { timeout: 30000 });
      await wait(300);
      check((await text(page, '.rs-deg__total-num')) === '250', `${size}: reduced motion shows the total without counting`);
      check(await has(page, '.rs-deg__up'), `${size}: reduced motion still says ランクアップ！`);
      if (narrow) await page.evaluate(() => document.querySelector('.rs-deg')?.scrollIntoView({ block: 'center' }));
      await shot(page, 'result-reduced-motion', 300);
    },
    true,
  );

  /* ---- 4. files header + tags; 遊び方 from the meter ---- */
  await section('files', async (ctx) => {
    const page = await fresh(ctx, `${size}-files`);
    await page.evaluate(() => window.__JD.goto('files'));
    await page.waitForSelector('.dmeter', { state: 'attached', timeout: 30000 });
    await shot(page, 'files-no-badge', 1400);
    check(/まだ称号なし/.test((await text(page, '.dmeter__name')) ?? ''), `${size}: an empty save has no badge yet`);
    // phones hide the empty meter on a first visit (the first tag's button stays on screen)
    check((await page.isVisible('.dmeter')) === !narrow, `${size}: the empty meter is ${narrow ? 'hidden' : 'shown'} on a first visit`);
    await seedFirstClear(page);
    await wait(300);
    check(await page.isVisible('.dmeter'), `${size}: the meter shows once there is a degree`);
    await shot(page, 'files-degree', 600);
    check((await text(page, '.dmeter__total')) === '250', `${size}: the header shows 名探偵度数 250`);
    check((await text(page, '.dmeter__name')) === 'Lv.3 腕利き探偵', `${size}: the header shows Lv.3 腕利き探偵`);
    const pts = await text(page, `article.tag:has(#case-${C1}-title) .tag__rank-pts`);
    check(pts === '+150', `${size}: the case tag shows its best +150 under BEST (${pts})`);
    const tag = page.locator(`article.tag:has(#case-${C1}-title)`);
    await tag.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('.tag__facts-rank')?.scrollIntoView({ block: 'center' }));
    await shot(page, 'files-tag-best', 700);
    await page.evaluate(() => document.querySelector('.page')?.scrollTo(0, 0));
    await page.click('[data-degree-meter]');
    await page.waitForSelector('.howto-degree', { timeout: 10000 });
    await shot(page, 'howto-degree', 700);
    check(true, `${size}: the meter opens 遊び方 on the 名探偵度数 page`);
    if (narrow) {
      await page.evaluate(() => document.querySelector('.modal__body')?.scrollTo(0, 9999));
      await shot(page, 'howto-degree-text', 400);
    }
  });

  /* ---- 5. 減点 floats in real play ---- */
  await section('floats', async (ctx) => {
    const page = await fresh(ctx, `${size}-floats`);
    // hint (CASE 01 is difficulty 1 → 8 per whisper)
    await seed(page, C1, 'fresh', 'investigation');
    await page.waitForSelector('.ivtop__hint', { timeout: 30000 });
    await wait(1500);
    await page.click('.ivtop__hint');
    await page.waitForSelector('.ivdlg--hint', { timeout: 10000 });
    await page.locator('.ivdlg--hint button', { hasText: '囁きを聞く' }).click();
    const hint = await penaltyFloat(page, 'hint');
    await shot(page, 'float-hint', 120);
    check(hint === '−8', `${size}: a whisper on CASE 01 shows 減点 −8 (${hint})`);
    await wait(1400);
    check(!(await has(page, '.fx-pen')), `${size}: the float is gone after about a second`);

    // noise-break miss (−4) and 泣きつき (−10) — from a fresh token: the starting evidence only
    await seed(page, C1, 'fresh', 'inquest');
    await page.waitForSelector('.iq', { timeout: 30000 });
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, 'debate');
    const round = CASES.c01.debate[0];
    const stmt = round.statements.findIndex((s) => s.id === round.answer.statement);
    await page.click(`.debate__dot >> nth=${stmt}`);
    await wait(700);
    await page.locator(`.band[data-statement-id="${round.answer.statement}"] .noise`).first().click({ force: true });
    await wait(400);
    const ok = new Set([round.answer.fact, ...(round.alsoAccept ?? [])]);
    const factIds = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-fact-id]')].map((e) => e.getAttribute('data-fact-id')))]);
    const wrong = factIds.find((f) => !ok.has(f));
    if (narrow) {
      if (!(await has(page, '.sheet-root'))) await page.click('[data-loaded-slot]');
      await page.waitForSelector(`.sheet-root [data-fact-id="${wrong}"]`);
      await wait(350);
      await page.locator(`.sheet-root [data-fact-id="${wrong}"]`).click();
      await page.waitForFunction(() => !document.querySelector('.sheet-root'));
    } else await page.locator(`.iq-mag [data-fact-id="${wrong}"]`).click();
    await wait(250);
    await page.click('[data-fire]');
    const miss = await penaltyFloat(page, 'miss');
    await shot(page, 'float-miss', 150);
    check(miss === '−4', `${size}: a missed shot on CASE 01 shows 減点 −4 (${miss})`);
    await wait(1600);
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off', 'debate after miss');
    await page.click('[data-beg]');
    await page.click('[data-beg-confirm]');
    const beg = await penaltyFloat(page, 'grant');
    await shot(page, 'float-grant', 150);
    check(beg === '−10', `${size}: 泣きつき on CASE 01 shows 減点 −10 (${beg})`);
    await wait(1500);

    // wrong verdict (CASE 02 is difficulty 2 → 5.5 per retry), 見習い choice sheet
    await seed(page, C2, 'investigated', 'inquest', {
      difficulty: 'easy',
      inquest: { phase: 'verdict', roundIndex: 0, composure: 5, cleared: [], misses: 0, grants: 0, verdictAttempts: 0, suspensions: 0, lives: 10, debateSkipped: true, triedChoices: [] },
    });
    await page.waitForSelector('.iq', { timeout: 30000 });
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    const wrongOpt = CASES.c02.verdictModes.choice.options.find((o) => !o.correct);
    await page.click(`.vopt[data-option-id="${wrongOpt.id}"]`);
    await page.click('[data-verdict-submit]');
    const verdict = await penaltyFloat(page, 'verdict');
    await shot(page, 'float-verdict', 150);
    check(verdict === '−5.5', `${size}: a wrong verdict on CASE 02 shows 減点 −5.5 (${verdict})`);
    await wait(1500);

    // recall test retry (−2)
    await seed(page, C1, 'reconstructed', 'quiz', { stage: 'quiz' });
    await page.waitForSelector('.qz-choice', { timeout: 30000 });
    await wait(900);
    const answer = CASES.c01.quiz[0].answer;
    await page.locator('.qz-choice').nth(answer === 0 ? 1 : 0).click();
    const quiz = await penaltyFloat(page, 'quiz');
    await shot(page, 'float-quiz', 150);
    check(quiz === '−2', `${size}: a recall-test retry shows 減点 −2 (${quiz})`);
  });

  /* ---- 6. game over: the tag on the overlay ---- */
  await section('gameover', async (ctx) => {
    const page = await fresh(ctx, `${size}-gameover`);
    await seed(page, C3, 'investigated', 'inquest', {
      difficulty: 'hard',
      inquest: { phase: 'verdict', roundIndex: 0, composure: 5, cleared: [], misses: 0, grants: 0, verdictAttempts: 2, suspensions: 0, lives: 1, debateSkipped: true },
    });
    await page.waitForSelector('.iq', { timeout: 30000 });
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    await page.fill('#verdict-text', '寒さで体が冷えて亡くなった。');
    await page.click('[data-verdict-submit]');
    const f = await penaltyFloat(page, 'last verdict');
    check(f === '−12', `${size}: the verdict that ends the run shows the game over's −12 (${f})`);
    await waitFn(page, () => !!document.querySelector('.gover[data-gameover="restart"]'), null, {
      label: 'game over',
      timeout: 60000,
      each: async () => {
        const st = await iqState(page);
        if (st?.dlg === 'on') {
          await page.evaluate(() => window.__JD.skipText());
          await page.click('.iq__dialogue .dlg', { force: true, timeout: 2000 }).catch(() => {});
        }
      },
    });
    await shot(page, 'gameover-penalty', 4600);
    check((await text(page, '.gover__pen .pen-tag__n')) === '−12', `${size}: the game-over card says 減点 −12`);
    const c3 = await page.evaluate((id) => window.__JD.getState().save.cases[id], C3);
    check(c3.gameOvers === 1 && !c3.gameOversAtClear, `${size}: the game over is counted for the next clear (gameOvers ${c3.gameOvers})`);
  });
}

const browser = await chromium.launch();
try {
  for (const size of ONLY_SIZE ? [ONLY_SIZE] : ['pc', 'sp']) await runSize(browser, size);
} finally {
  await browser.close();
  server?.kill();
}
if (problems.length) {
  console.error(`\n[score] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\n[score] OK');
