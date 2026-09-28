// 質問枠 visual QA (2026-09-28) — screenshots and checks of the question budget in real play:
//   the counter on the question field (ok / low / used up / beyond / 見習い guide), Holma's budget
//   remarks and free nudges (ひとりごと) in the chat, 「ノーカウント」 answers, the 「減点」 float
//   beyond a 審問官 budget, the 教授 close (multi-question cut by the server, input replaced by the
//   way to the inquest), the difficulty chooser's budget lines (and 教授 refused mid-case when
//   used up), the 遊び方 page and the result tile — at PC 1280x800, phone 390x844 and 320x640.
//
//   node scripts/shots-budget.mjs                 all sizes
//   node scripts/shots-budget.mjs --size sp       one size      --only counter,hard   subset
//
// Uses the dev server on :5213 (BUDGET_PORT) — started here in rules mode when nothing answers
// (never a paid pipeline). Real time: waits on DOM state. Output: qa/budget/<size>-<nn>-<name>.png.
// Exit 1 on page errors, console errors, failed checks or horizontal overflow.
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
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
const PORT = Number(process.env.BUDGET_PORT || 5213);
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'budget');
mkdirSync(out, { recursive: true });

const C1 = 'c01-room-without-breath';
const case1 = JSON.parse(readFileSync(resolve(root, 'content', 'cases', C1, 'case.json'), 'utf8'));
/** c01 probes answered 関係ない that unlock nothing (counted, no finding → builds a stuck streak). */
const DULL = case1.probes.filter((p) => p.answer === 'irrelevant' && p.kind === 'irrelevant' && !(p.facts ?? []).length).map((p) => p.q);
const SIZES = {
  pc: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 },
  sp: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  xs: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
// a full run replaces the size's shots (a --only run keeps the others; numbering then restarts)
if (!ONLY) for (const f of readdirSync(out)) if (f.endsWith('.png') && (!ONLY_SIZE || f.startsWith(`${ONLY_SIZE}-`))) rmSync(resolve(out, f));

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
    console.error(`[budget] the server on :${PORT} runs in "${h.mode}" mode — the shots need rules mode (no paid calls)`);
    process.exit(1);
  }
  if (!h) {
    console.log(`[budget] starting vite on :${PORT} (rules mode)`);
    Object.assign(process.env, { PIPELINE_MODE: 'rules', DECISION_PROVIDER: 'rules', LLM_PROVIDER: 'none', TRACE_FILE: '0' });
    const { createServer, searchForWorkspaceRoot } = await import('vite');
    server = await createServer({
      configFile: resolve(root, 'vite.config.ts'),
      root,
      logLevel: 'warn',
      // a git worktree may link node_modules from the main checkout: let the fonts be served from there
      server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] }, fs: { allow: [searchForWorkspaceRoot(root), realpathSync(resolve(root, 'node_modules'))] } },
    });
    await server.listen();
    let ok = null;
    for (let i = 0; i < 200 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 250));
      ok = await health();
    }
    if (!ok) {
      console.error('[budget] dev server did not start');
      await server.close();
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
    for (const e of document.querySelectorAll('.scene, .page, .modal__body, .chat__scroll, .sl__bottom, .dfc__cards')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${String(e.className).split(' ').slice(0, 2).join('.')} ${e.scrollWidth}>${e.clientWidth}`);
    }
    for (const e of document.querySelectorAll('.qbudget, .dock__closed, .dock__closed-btn, .nrow, .fx-pen, .dcard__budget')) {
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
async function waitFn(page, fn, a, { timeout = 45000, label = 'condition' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, a)) return true;
    await wait(100);
  }
  throw new Error(`timeout: ${label}`);
}
const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
const saveOf = (page, id) => page.evaluate((id) => window.__JD.getState().save.cases[id] ?? null, id);

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

/** A dev-minted token with `asked` questions already counted, written into the save, then the investigation. */
async function seedInvestigation(page, caseId, difficulty, asked) {
  await page.evaluate(
    async ({ caseId, difficulty, asked }) => {
      const J = window.__JD;
      // leave the scene first so the investigation mounts afresh on the new record
      if (J.getState().route.scene !== 'files') {
        J.goto('files');
        await J.idle();
      }
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage: 'fresh', asked }) });
      const { token, progress } = await r.json();
      J.updateCase(caseId, { stage: 'investigation', token, snapshot: progress, difficulty, log: [], facts: {}, factOrder: [], seenFacts: [], memos: {}, hints: [] });
      J.flushSave();
      J.goto('investigation', { caseId });
      await J.idle();
    },
    { caseId, difficulty, asked },
  );
  await page.waitForSelector('.iv .dock', { timeout: 60000 });
  await settle(page);
}
async function settle(page) {
  await waitFn(page, () => !document.querySelector('.iv.is-presenting') && !document.querySelector('.dock.is-busy') && !document.querySelector('.flight') && !document.querySelector('.fx-cutin') && !document.querySelector('.fx-stamp'), null, {
    label: 'investigation settled',
    timeout: 60000,
  });
}
const answers = (page, id) => page.evaluate((id) => (window.__JD.getState().save.cases[id]?.log ?? []).filter((e) => e.kind === 'answer').length, id);

/** Types and sends one message, fast-forwards the presentation, returns the new answer entries. */
async function ask(page, caseId, q) {
  const before = await answers(page, caseId);
  await page.locator('.dock__input').fill(q);
  await page.locator('.dock__input').press('Enter');
  await waitFn(page, ({ id, before }) => (window.__JD.getState().save.cases[id]?.log ?? []).filter((e) => e.kind === 'answer').length > before, { id: caseId, before }, { label: `answer to 「${q}」` });
  for (let i = 0; i < 40 && (await has(page, '.iv.is-presenting')); i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await wait(120);
  }
  await settle(page);
  return (await saveOf(page, caseId)).log.filter((e) => e.kind === 'answer').slice(before);
}
const spent = async (page, id) => {
  const s = (await saveOf(page, id))?.snapshot;
  return s ? Math.min(s.asked, s.spent ?? s.asked) : 0;
};
const counter = (page) => page.evaluate(() => {
  const el = document.querySelector('.qbudget');
  return el ? { state: el.getAttribute('data-budget-state'), text: el.textContent.replace(/\s+/g, '') } : null;
});
const lastNudge = async (page, id) => (await saveOf(page, id)).log.filter((e) => e.kind === 'nudge').at(-1) ?? null;
const scrollChatEnd = (page) => page.evaluate(() => {
  const s = document.querySelector('.chat__scroll');
  if (s) s.scrollTop = s.scrollHeight;
});

/* ------------------------------------------------------------------ runs */
async function runSize(browser, size) {
  const shot = namer(size);
  const want = (k) => !ONLY || ONLY.includes(k);
  const section = async (key, fn, reduced = false) => {
    if (!want(key)) return;
    const ctx = await browser.newContext({ ...SIZES[size], locale: 'ja-JP', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    console.log(`\n[budget] ${size}: ${key}`);
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

  /* ---- 1. 審問官: ok → low (+ a free nudge) → used up → beyond (減点) ---- */
  await section('counter', async (ctx) => {
    const page = await fresh(ctx, `${size}-counter`);
    await seedInvestigation(page, C1, 'normal', 3);
    check((await counter(page))?.text === '残り26/29', `${size}: 審問官 c01 starts 残り 26/29 at 3 counted (${(await counter(page))?.text})`);
    await shot(page, 'counter-ok');
    if (size === 'pc') check(/03\/29/.test((await text(page, '.ivtop__stats')) ?? ''), `pc: the top bar shows QUESTIONS 03/29 (${await text(page, '.ivtop__stats')})`);

    // a free question: 「ノーカウント」, the counter does not move
    const free = await ask(page, C1, 'ヒントをください');
    check(free.every((a) => a.free === true), `${size}: a hint request is not counted (${free.map((a) => a.answerClass)})`);
    check((await spent(page, C1)) === 3 && (await counter(page))?.text === '残り26/29', `${size}: the counter stays at 26 after a free question`);
    check(await has(page, '.arow__free'), `${size}: the free answer carries 「ノーカウント」`);
    await scrollChatEnd(page);
    await shot(page, 'free-question');

    // 15 counted → six dull questions: the sixth crosses into the last quarter AND ends a stuck streak
    await seedInvestigation(page, C1, 'normal', 15);
    for (let i = 0; i < 6; i++) {
      const got = await ask(page, C1, DULL[i]);
      check(got.length === 1 && !got[0].free && !got[0].unlocked.length, `${size}: 「${DULL[i]}」 counts, no finding (${got[0]?.answerClass})`);
    }
    const low = await lastNudge(page, C1);
    check(low?.reason === 'low' && !!low.nudge, `${size}: crossing into the last quarter → budget remark + a free nudge (${low?.reason}: ${low?.text?.replace(/\n/g, ' / ')})`);
    check((await counter(page))?.state === 'low', `${size}: the counter is low (${(await counter(page))?.text})`);
    await scrollChatEnd(page);
    await shot(page, 'counter-low-nudge');

    // used up, then beyond: 減点 −1.5 by the counter
    await seedInvestigation(page, C1, 'normal', 28);
    await ask(page, C1, DULL[6]);
    check((await lastNudge(page, C1))?.reason === 'zero' && (await counter(page))?.state === 'zero', `${size}: the 29th counted question → 「質問枠は使い切りました」 (${(await counter(page))?.text})`);
    await scrollChatEnd(page);
    await shot(page, 'counter-zero');
    await page.locator('.dock__input').fill(DULL[7]);
    await page.locator('.dock__input').press('Enter');
    await waitFn(page, () => !!document.querySelector('.fx-pen'), null, { label: '減点 float beyond the budget', timeout: 30000 });
    check(/1\.5/.test((await text(page, '.fx-pen')) ?? ''), `${size}: beyond the budget → 「減点 −1.5」 (${await text(page, '.fx-pen')})`);
    await shot(page, 'counter-over-penalty', 150);
    await settle(page);
    check((await counter(page))?.text === '超過+1/29', `${size}: the counter reads 超過 +1 (${(await counter(page))?.text})`);
    await scrollChatEnd(page);
    await shot(page, 'counter-over');
  });

  /* ---- 2. 見習い: a guide only ---- */
  await section('guide', async (ctx) => {
    const page = await fresh(ctx, `${size}-guide`);
    await seedInvestigation(page, C1, 'easy', 34);
    check((await counter(page))?.text === '目安1/35', `${size}: 見習い reads 目安 1/35 (${(await counter(page))?.text})`);
    await ask(page, C1, DULL[0]);
    await ask(page, C1, DULL[1]);
    check((await counter(page))?.text === '目安超え+1/35', `${size}: beyond the guide → 目安超え +1, no 減点 (${(await counter(page))?.text})`);
    check(!(await has(page, '.fx-pen')), `${size}: no 減点 float on 見習い`);
    check((await saveOf(page, C1)).log.some((e) => e.kind === 'nudge' && e.reason === 'zero'), `${size}: Holma says the guide is reached (gently)`);
    await scrollChatEnd(page);
    await shot(page, 'guide-over');
  });

  /* ---- 3. 教授: the last question, a multi-question cut, the close ---- */
  await section('hard', async (ctx) => {
    const page = await fresh(ctx, `${size}-hard`);
    await seedInvestigation(page, C1, 'hard', 22);
    check((await counter(page))?.text === '残り2/24', `${size}: 教授 c01 at 22 → 残り 2/24 (${(await counter(page))?.text})`);
    await shot(page, 'hard-last-two');
    const got = await ask(page, C1, `${DULL[0]}${DULL[1]}${DULL[2]}`);
    check(got.length === 2, `${size}: a 3-question message with 2 left is cut to 2 by the server (${got.length})`);
    check((await spent(page, C1)) === 24, `${size}: 24/24 counted`);
    await waitFn(page, () => !!document.querySelector('[data-budget-closed]'), null, { label: 'closed dock' });
    check(!(await has(page, '.dock__input')), `${size}: the question input is gone`);
    check((await lastNudge(page, C1))?.reason === 'closed', `${size}: Holma closes the questioning`);
    await scrollChatEnd(page);
    await shot(page, 'hard-closed');
    // the server refuses too (a stale tab / a hacked client)
    const res = await page.evaluate(async (caseId) => {
      const c = window.__JD.getState().save.cases[caseId];
      const r = await fetch('api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, question: '雨でしたか？', token: c.token, limit: 24 }) });
      return r.json();
    }, C1);
    check(res.answers?.[0]?.answerClass === 'cannot' && res.progress?.spent === 24, `${size}: the server declines a question past the declared limit (${res.answers?.[0]?.answerClass})`);
    // the menu cannot switch back to 教授 once… it is 教授 now; switching away is allowed (open question for the owner)
    await page.locator('.dock__closed-btn').click();
    await waitFn(page, () => window.__JD.getState().route.scene === 'inquest', null, { label: 'inquest after the close', timeout: 30000 });
    check(true, `${size}: 「審問を開く」 on the closed dock opens the inquest`);
  });

  /* ---- 4. difficulty chooser: budget per mode; 教授 refused mid-case when used up ---- */
  await section('chooser', async (ctx) => {
    const page = await fresh(ctx, `${size}-chooser`);
    await page.evaluate((caseId) => window.__JD.openOverlay('difficulty', { caseId, mode: 'start' }), C1);
    await page.waitForSelector('.dfc .dcard__budget', { timeout: 30000 });
    await wait(900);
    const lines = await page.evaluate(() => [...document.querySelectorAll('.dcard__budget')].map((e) => e.textContent.replace(/\s+/g, '')));
    check(lines.join('|') === '質問の目安35問超えても減点なし|質問枠29問超えると1問ごとに減点|質問は24問まで尽きたら審問へ', `${size}: chooser budget lines (${lines.join(' | ')})`);
    await shot(page, 'chooser-start', 200);
    await page.evaluate(() => window.__JD.closeOverlay());
    await seedInvestigation(page, C1, 'normal', 26);
    await page.evaluate((caseId) => window.__JD.openOverlay('difficulty', { caseId, mode: 'change' }), C1);
    await page.waitForSelector('.dfc .dcard__budget', { timeout: 30000 });
    await wait(900); // let the cards land (a click mid-animation scrolls the dialog sideways)
    await page.click('.dcard[data-difficulty="hard"]');
    await wait(700);
    check(await page.locator('[data-difficulty-confirm]').isDisabled(), `${size}: with 26 counted, 教授 (24) cannot be chosen mid-case`);
    await shot(page, 'chooser-change-hard-used', 200);
  });

  /* ---- 5. 遊び方 ---- */
  await section('howto', async (ctx) => {
    const page = await fresh(ctx, `${size}-howto`);
    await page.evaluate(() => window.__JD.openOverlay('howto', { page: 'QUESTIONS' }));
    await page.waitForSelector('.howto-budget', { timeout: 30000 });
    await shot(page, 'howto-questions', 700);
    check((await page.locator('.howto-budget .qbudget').count()) === 3, `${size}: the page shows the three counters`);
  });

  /* ---- 6. result tile ---- */
  await section('result', async (ctx) => {
    const page = await fresh(ctx, `${size}-result`);
    const stats = { score: 97, points: 107, asked: 34, spent: 31, budget: 29, budgetCost: 1.5, budgetCap: 24, keyQuestions: 20, answered: 34, hintsUsed: 0, debateMisses: 0, grants: 0, verdictAttempts: 1, suspensions: 0, gameOvers: 0, quizMisses: 0, debateRounds: 2, debateCleared: 2, difficulty: 1, estimatedMinutes: 25 };
    await page.evaluate(
      ({ C1, stats }) => {
        const J = window.__JD;
        J.updateCase(C1, { stage: 'complete', completed: true, clears: 1, difficulty: 'normal', bestRank: 'S+', bestPoints: 101, gameOversAtClear: 0, lastResult: { rank: 'S+', title: '完全無欠の審問官', at: Date.now(), elapsedMs: 18 * 60000, playDifficulty: 'normal', stats } });
        J.flushSave();
        J.goto('result', { caseId: C1 });
      },
      { C1, stats },
    );
    await page.waitForSelector('.rs-stats', { timeout: 30000 });
    if (size !== 'pc') await page.evaluate(() => document.querySelector('.rs-stats')?.scrollIntoView({ block: 'center' }));
    await shot(page, 'result-questions', 1200);
    const tile = await page.evaluate(() => [...document.querySelectorAll('.rs-stat')].find((e) => e.textContent.includes('質問数'))?.textContent.replace(/\s+/g, '') ?? '');
    check(/31\/29問/.test(tile) && /2問超過/.test(tile) && /数えない質問3/.test(tile), `${size}: the result tile reads 31/29 with 2 over and 3 not counted (${tile})`);
    check(/質問枠より2問多い/.test((await text(page, '.rs-rank__advice')) ?? ''), `${size}: Holma's advice names the budget (${await text(page, '.rs-rank__advice')})`);
  });
}

const browser = await chromium.launch();
try {
  for (const size of Object.keys(SIZES)) {
    if (ONLY_SIZE && ONLY_SIZE !== size) continue;
    if (size === 'xs' && !ONLY_SIZE && ONLY && !ONLY.some((k) => ['counter', 'hard'].includes(k))) continue;
    await runSize(browser, size);
  }
} finally {
  await browser.close();
  if (server) await server.close();
}
if (problems.length) {
  console.error(`\n[budget] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\n[budget] all good');
