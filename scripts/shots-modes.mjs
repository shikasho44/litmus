// Difficulty / verdict modes / tutorial visual QA — screenshots of the 2026-09-25 features:
//   difficulty chooser (start + change), the coach-mark tutorial (every step), the optional
//   noise break (skip panel + confirm), the assist reward card, each verdict format
//   (choice / cloze / free, with assists), game over, the S+ result, the investigation menu
//   and the updated 遊び方 pages — at PC 1440x900 and phone 390x844.
//
//   node scripts/shots-modes.mjs                 both sizes
//   node scripts/shots-modes.mjs --size sp       one size        --only chooser,gameover   subset
//
// Uses the dev server on :5191 (MODES_PORT) — started here in rules mode when nothing answers.
// Real time (no virtual clock): waits on DOM state. Output: qa/modes/<size>-<nn>-<name>.png.
// Exit 1 on page errors, console errors, failed checks or horizontal overflow.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
const PORT = Number(process.env.MODES_PORT || 5191);
const BASE = `http://127.0.0.1:${PORT}/`;
const out = resolve(root, 'qa', 'modes');
mkdirSync(out, { recursive: true });

const CASES = Object.fromEntries(
  readdirSync(resolve(root, 'content', 'cases'))
    .filter((d) => /^c\d\d/.test(d))
    .map((dir) => [dir.slice(0, 3), JSON.parse(readFileSync(resolve(root, 'content', 'cases', dir, 'case.json'), 'utf8'))]),
);
const SIZES = {
  pc: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
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
    console.error(`[modes] the server on :${PORT} runs in "${h.mode}" mode — the shots need rules mode (no paid calls)`);
    process.exit(1);
  }
  if (!h) {
    console.log(`[modes] starting vite on :${PORT} (rules mode)`);
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
      console.error('[modes] dev server did not start');
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
    for (const e of document.querySelectorAll('.scene, .page, .iq__verdict, .dfc, .modal__body, .gover')) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) res.push(`${String(e.className).split(' ').slice(0, 2).join('.')} ${e.scrollWidth}>${e.clientWidth}`);
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
async function waitFn(page, fn, argv, { timeout = 45000, label = 'condition', each } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, argv)) return true;
    if (each) await each();
    await wait(120);
  }
  throw new Error(`timeout: ${label}`);
}
const has = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);
const iqState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.iq');
    return el
      ? { phase: el.dataset.phase, step: el.dataset.step, vstep: el.dataset.verdictStep, dlg: el.dataset.dialogue, card: el.dataset.card, cut: !!document.querySelector('.fx-cutin'), writable: !!document.querySelector('.vpanel[data-writable="on"]') }
      : null;
  });
/** Advance Holma's / Jane's lines until pred holds. */
async function untilIq(page, pred, label, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await iqState(page);
    if (st && pred(st)) return st;
    if (st?.dlg === 'on' && !(await has(page, '.coach'))) {
      await page.evaluate(() => window.__JD.skipText());
      await page.click('.iq__dialogue .dlg', { force: true, timeout: 2000 }).catch(() => {});
    } else if (st?.dlg === 'on') {
      await page.evaluate(() => window.__JD.skipText());
      await page.click('.iq__dialogue .dlg', { force: true, timeout: 2000 }).catch(() => {});
    }
    await wait(180);
  }
  throw new Error(`timeout: ${label} ${JSON.stringify(await iqState(page))}`);
}

async function fresh(ctx, tag, { tutorial = 'done' } = {}) {
  const page = await ctx.newPage();
  attach(page, tag);
  await page.goto(`${BASE}?debug=1&mute=1`, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__JD && document.documentElement.classList.contains('app-ready'), null, { timeout: 60000 });
  await page.evaluate((tutorial) => {
    const J = window.__JD;
    J.setMeta({ prologueSeen: true, ...(tutorial === 'done' ? { tutorial: { state: 'done', step: 0 } } : {}) });
    J.setSettings({ textSpeed: 'instant' });
  }, tutorial);
  return page;
}

/** Jump into the inquest of a case with a dev-minted token and a chosen difficulty. */
async function seedInquest(page, caseId, stage, difficulty, inquest) {
  await page.evaluate(
    async ({ caseId, stage, difficulty, inquest }) => {
      const J = window.__JD;
      const r = await fetch('api/admin/mint-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId, stage }) });
      const { token, progress } = await r.json();
      J.updateCase(caseId, { stage: 'inquest', token, snapshot: progress, difficulty, ...(inquest ? { inquest } : {}) });
      J.flushSave();
      J.goto('inquest', { caseId });
    },
    { caseId, stage, difficulty, inquest },
  );
  await page.waitForSelector('.iq', { timeout: 30000 });
}

async function lockAndFire(page, c, round, narrow) {
  const i = round.statements.findIndex((s) => s.id === round.answer.statement);
  await page.click(`.debate__dot >> nth=${i}`);
  await page.waitForSelector(`.band[data-statement-id="${round.answer.statement}"]`);
  await wait(700);
  for (const h of await page.$$(`.band[data-statement-id="${round.answer.statement}"] .noise`)) {
    const t = await h.getAttribute('data-noise');
    if (t && (t.includes(round.answer.span) || round.answer.span.includes(t))) {
      await h.click({ force: true });
      break;
    }
  }
  await wait(450);
  const fact = round.answer.fact;
  if (narrow) {
    if (!(await has(page, '.sheet-root'))) await page.click('[data-loaded-slot]');
    await page.waitForSelector(`.sheet-root [data-fact-id="${fact}"]`);
    await wait(400);
    await page.locator(`.sheet-root [data-fact-id="${fact}"]`).click();
    await page.waitForFunction(() => !document.querySelector('.sheet-root'));
  } else {
    const el = page.locator(`.iq-mag [data-fact-id="${fact}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.click();
  }
  await wait(200);
  await page.click('[data-fire]');
}

/* ------------------------------------------------------------------ runs */
async function runSize(browser, size) {
  const narrow = size === 'sp';
  const shot = namer(size);
  const ctx = await browser.newContext({ ...SIZES[size], locale: 'ja-JP', reducedMotion: 'no-preference' });
  const want = (k) => !ONLY || ONLY.includes(k);
  /** Each section runs on its own page; a failure is recorded (with a screenshot) and the next one runs. */
  const section = async (keys, fn) => {
    if (!keys.some(want)) return;
    try {
      await fn();
    } catch (e) {
      const msg = String(e.message).split(/\r?\n/)[0];
      problems.push(`${size} ${keys[0]}: ${msg}`);
      console.error(`  ✗ ${size} ${keys[0]}: ${msg}`);
      for (const pg of ctx.pages()) await pg.screenshot({ path: resolve(out, `${size}-FAIL-${keys[0]}.png`) }).catch(() => {});
    } finally {
      for (const pg of ctx.pages()) await pg.close().catch(() => {});
    }
  };

  /* ---- 1. chooser → intro → tutorial (investigation) → inquest (tutorial, skip) → verdict ---- */
  await section(['chooser', 'tutorial'], async () => {
    console.log(`\n[modes] ${size}: chooser + tutorial`);
    const page = await fresh(ctx, `${size}-tutorial`, { tutorial: 'off' });
    await page.evaluate(() => window.__JD.goto('files'));
    await page.waitForSelector('.tag__open', { timeout: 30000 });
    await wait(1200);
    await page.locator('article.tag:has(#case-c01-room-without-breath-title) .tag__open').click();
    await page.waitForSelector('.dfc .dcard.is-selected', { timeout: 20000 });
    await shot(page, 'chooser', 1100);
    check((await page.getAttribute('.dcard.is-selected', 'data-difficulty')) === 'normal', `${size}: the chooser preselects 審問官 (normal)`);
    check((await page.evaluate(() => document.activeElement?.getAttribute('data-difficulty'))) === 'normal', `${size}: the selected card has the focus`);
    await page.keyboard.press('ArrowRight');
    await shot(page, 'chooser-hard', 500);
    await page.keyboard.press('ArrowLeft');
    await wait(200);
    await page.click('[data-difficulty-confirm]');
    await page.waitForSelector('.intro', { timeout: 30000 });
    check((await page.evaluate(() => window.__JD.getState().save.cases['c01-room-without-breath']?.difficulty)) === 'normal', `${size}: the chosen difficulty is saved`);
    await page.waitForSelector('.intro__skip', { timeout: 30000 });
    await wait(600);
    await page.click('.intro__skip');
    await wait(400);
    if (await has(page, '.intro__skip')) await page.click('.intro__skip').catch(() => {});
    await page.waitForSelector('.iv .dock__input', { timeout: 60000 });
    await page.waitForSelector('.coach[data-coach-step="ask"]', { timeout: 20000 });
    await shot(page, 'tut-1-ask', 900);
    // send the first starter question (the chip fills the input; Enter sends)
    await page.locator('.dock__chip').first().click();
    await wait(150);
    await page.locator('.dock__input').press('Enter');
    await page.waitForSelector('.coach[data-coach-step="stamp"]', { timeout: 60000 });
    await shot(page, 'tut-2-stamp', 700);
    for (const [stepId, name] of [
      ['notebook', 'tut-2-notebook'],
      ['shards', 'tut-3-shards'],
      ['hints', 'tut-4-hints'],
      ['inquest', 'tut-5-inquest'],
    ]) {
      await page.click('[data-coach-next]');
      await page.waitForSelector(`.coach[data-coach-step="${stepId}"]`, { timeout: 10000 });
      await shot(page, name, 600);
    }
    await page.click('[data-coach-next]');
    await wait(300);
    check(!(await has(page, '.coach')), `${size}: after 「わかった」 the investigation shows no coach mark`);
    // menu: difficulty row (still changeable) → change-mode chooser
    await page.click('.ivtop button[aria-label="メニュー"]');
    await page.waitForSelector('[data-menu-difficulty]');
    await shot(page, 'menu-difficulty', 500);
    await page.click('[data-menu-difficulty]');
    await page.waitForSelector('.dfc', { timeout: 10000 });
    await shot(page, 'chooser-change', 900);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.dfc'));
    // into the inquest with every finding (the tutorial continues there)
    await seedInquest(page, 'c01-room-without-breath', 'investigated', 'normal');
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, 'debate');
    await page.waitForSelector('.coach[data-coach-step="noise-target"]', { timeout: 15000 });
    await shot(page, 'tut-6-noise-target', 800);
    await page.click('[data-coach-next]');
    await page.waitForSelector('.coach[data-coach-step="noise-fire"]');
    await shot(page, 'tut-6-noise-fire', 600);
    await page.click('[data-coach-next]');
    await page.waitForSelector('.coach[data-coach-step="noise-skip"]');
    await shot(page, 'tut-6-noise-skip', 600);
    await page.click('[data-coach-next]');
    await wait(300);
    await shot(page, 'skip-panel', 400);
    await page.click('[data-skip-debate]');
    await page.waitForSelector('[data-skip-confirm]');
    await shot(page, 'skip-confirm', 600);
    await page.click('[data-skip-confirm]');
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut, 'verdict after skip');
    await page.waitForSelector('.coach[data-coach-step="verdict"]', { timeout: 15000 });
    await shot(page, 'tut-7-verdict', 900);
    await page.click('[data-coach-next]');
    await wait(400);
    check((await page.evaluate(() => window.__JD.getState().save.meta.tutorial?.state)) === 'done', `${size}: the tutorial ends after the verdict step`);
    check(await has(page, '.vcloze'), `${size}: 審問官 declares with the cloze sheet`);
    const skipped = await page.evaluate(() => window.__JD.getState().save.cases['c01-room-without-breath'].inquest);
    check(skipped?.debateSkipped === true && skipped?.phase === 'verdict', `${size}: the skip is saved (verdict, debateSkipped)`);
    await shot(page, 'verdict-cloze-noassist', 300);
    // reload keeps the skip → verdict
    await page.evaluate(() => window.__JD.flushSave());
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.iq', { timeout: 30000 });
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut, 'verdict after reload');
    check(true, `${size}: a reload after the skip returns to the verdict`);
    // back to the noise break from the verdict
    await page.click('[data-back-debate]');
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off', 'back to debate');
    check(true, `${size}: 「ノイズ・ブレイクに戻る」 reopens the first round`);
    await page.close();
  });

  /* ---- 2. assist reward on a cleared round → choice verdict with one struck option ---- */
  await section(['assist'], async () => {
    console.log(`\n[modes] ${size}: assist reward (見習い)`);
    const page = await fresh(ctx, `${size}-assist`);
    const c = CASES.c01;
    await seedInquest(page, c.id, 'investigated', 'easy');
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, 'debate');
    await shot(page, 'debate-easy-lives', 600);
    await lockAndFire(page, c, c.debate[0], narrow);
    await waitFn(page, () => document.querySelector('.iq')?.dataset.card === 'on' && /手がかり獲得/.test(document.querySelector('.tcard')?.textContent ?? ''), null, {
      label: 'reward card',
      each: async () => {
        const st = await iqState(page);
        if (st?.dlg === 'on') {
          await page.evaluate(() => window.__JD.skipText());
          await page.click('.iq__dialogue .dlg', { force: true, timeout: 2000 }).catch(() => {});
        }
      },
    });
    await shot(page, 'assist-card', 550);
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, 'round 2');
    await shot(page, 'assist-hud', 600);
    await page.click('[data-skip-debate]');
    await page.click('[data-skip-confirm]');
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    const removed = await page.$$eval('.vopt.is-removed', (els) => els.map((e) => e.getAttribute('data-option-id')));
    const r1 = c.verdictModes.assists.find((a) => a.round === c.debate[0].id)?.removeOption;
    check(removed.length === 1 && removed[0] === r1, `${size}: round 1 cleared → option ${r1} struck out (${removed.join(',')})`);
    await shot(page, 'verdict-choice-assist1', 600);
    await page.close();
  });

  /* ---- 3. each verdict format with every assist (debated) ---- */
  await section(['choice'], async () => {
    console.log(`\n[modes] ${size}: choice`);
    const page = await fresh(ctx, `${size}-choice`);
    const c = CASES.c02;
    await seedInquest(page, c.id, 'debated', 'easy');
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    await shot(page, 'verdict-choice', 700);
    const wrong = c.verdictModes.choice.options.find((o) => !o.correct && !c.verdictModes.assists.some((a) => a.removeOption === o.id));
    await page.click(`.vopt[data-option-id="${wrong.id}"]`);
    await shot(page, 'verdict-choice-picked', 400);
    await page.click('[data-verdict-submit]');
    await untilIq(page, (s) => s.vstep === 'result', 'result', 30000);
    await shot(page, 'verdict-choice-stamp', 1300);
    await untilIq(page, (s) => s.vstep === 'write' && s.dlg === 'off', 'rewrite');
    check(await has(page, `.vopt.is-wrong[data-option-id="${wrong.id}"]`), `${size}: a wrong option is crossed out after the verdict`);
    const lives = await page.evaluate((id) => window.__JD.getState().save.cases[id].inquest.lives, c.id);
    check(lives === 9, `${size}: a wrong verdict costs one light (10 → ${lives})`);
    await shot(page, 'verdict-choice-after', 500);
    const right = c.verdictModes.choice.options.find((o) => o.correct);
    await page.click(`.vopt[data-option-id="${right.id}"]`);
    await page.click('[data-verdict-submit]');
    await untilIq(page, (s) => s.phase === 'reconstruction' || s.vstep === 'result', 'correct', 30000);
    await untilIq(page, (s) => s.phase === 'reconstruction', 'reconstruction', 60000);
    check(true, `${size}: the correct option solves the case`);
    await page.close();
  });

  await section(['cloze'], async () => {
    console.log(`\n[modes] ${size}: cloze`);
    const page = await fresh(ctx, `${size}-cloze`);
    const c = CASES.c01;
    await seedInquest(page, c.id, 'debated', 'normal');
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    await shot(page, 'verdict-cloze', 700);
    const locked = await page.$$eval('.vblank.is-locked', (els) => els.map((e) => e.getAttribute('data-blank-id')));
    check(locked.length === 2, `${size}: two cleared rounds pre-fill two blanks (${locked.join(',')})`);
    const open = c.verdictModes.cloze.blanks.filter((b) => !locked.includes(b.id));
    await page.click(`.vblank[data-blank-id="${open[0].id}"]`);
    await page.waitForSelector('.vpick');
    await shot(page, 'verdict-cloze-picker', 500);
    // keyboard: ↓ then Enter picks the second option
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await wait(400);
    // fill the rest with the right words (matched by text: the server shows its own order)
    for (const b of open) {
      const text = b.options[b.answer];
      // after a pick the next empty blank opens by itself; open this one unless it is the one showing
      if (!(await has(page, `.vblank[data-blank-id="${b.id}"].is-open`))) {
        if (narrow && (await has(page, '.sheet-root'))) {
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('.sheet-root'));
        }
        await page.click(`.vblank[data-blank-id="${b.id}"]`);
      }
      await page.waitForSelector('.vpick');
      await wait(300);
      await page.locator('.vpick__opt', { hasText: text }).first().click();
      await wait(450);
    }
    if (await has(page, '.sheet-root')) {
      await page.keyboard.press('Escape');
      await wait(400);
    }
    await shot(page, 'verdict-cloze-filled', 400);
    await page.click('[data-verdict-submit]');
    await untilIq(page, (s) => s.vstep === 'result', 'result', 30000);
    await shot(page, 'verdict-cloze-correct', 1300);
    await untilIq(page, (s) => s.phase === 'reconstruction', 'reconstruction', 60000);
    check(true, `${size}: the filled cloze solves the case`);
    await page.close();
  });

  await section(['free'], async () => {
    console.log(`\n[modes] ${size}: free`);
    const page = await fresh(ctx, `${size}-free`);
    await seedInquest(page, 'c03-shed-in-snow', 'debated', 'hard');
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    await shot(page, 'verdict-free', 900);
    check(await has(page, '.vassist__els li'), `${size}: 教授 shows the elements revealed by the assists`);
    await page.close();
  });

  /* ---- 4. game over (教授, last light) ---- */
  await section(['gameover'], async () => {
    console.log(`\n[modes] ${size}: game over`);
    const page = await fresh(ctx, `${size}-gameover`);
    // another case with progress must stay untouched
    await page.evaluate(() => window.__JD.updateCase('c01-room-without-breath', { stage: 'investigation', difficulty: 'easy', elapsedMs: 123456, notes: 'keep' }));
    const before = await page.evaluate(() => JSON.stringify(window.__JD.getState().save.cases['c01-room-without-breath']));
    await seedInquest(page, 'c03-shed-in-snow', 'investigated', 'hard', {
      phase: 'verdict',
      roundIndex: 0,
      composure: 5,
      cleared: [],
      misses: 0,
      grants: 0,
      verdictAttempts: 2,
      suspensions: 0,
      lives: 1,
      debateSkipped: true,
    });
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict');
    await shot(page, 'verdict-last-light', 500);
    await page.fill('#verdict-text', '寒さで体が冷えて亡くなった。');
    await page.click('[data-verdict-submit]');
    await waitFn(page, () => !!document.querySelector('.gover'), null, {
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
    await shot(page, 'gameover-fading', 1800);
    await page.waitForSelector('.gover[data-gameover="restart"]', { timeout: 20000 });
    await shot(page, 'gameover', 4200);
    const s = await page.evaluate(() => window.__JD.getState().save.cases);
    const c3 = s['c03-shed-in-snow'];
    check(c3.stage === 'intro' && !c3.inquest && c3.log.length === 0 && !!c3.token && c3.difficulty === 'hard' && c3.gameOvers === 1, `${size}: 教授 game over resets the case with a new token (stage ${c3.stage}, difficulty ${c3.difficulty})`);
    check(JSON.stringify(s['c01-room-without-breath']) === before, `${size}: other cases are untouched`);
    await page.click('[data-gameover-title]');
    await page.waitForFunction(() => window.__JD.getState().route.scene === 'title');
    await page.evaluate(() => window.__JD.idle());
    await wait(600);
    check(true, `${size}: game over → title`);
    // 見習い: the case resumes at the start of the inquest with the lights refilled
    await seedInquest(page, 'c02-ball-at-dusk', 'investigated', 'easy', {
      phase: 'verdict',
      roundIndex: 0,
      composure: 5,
      cleared: [],
      misses: 0,
      grants: 0,
      verdictAttempts: 9,
      suspensions: 0,
      lives: 1,
      debateSkipped: true,
      triedChoices: [],
    });
    await untilIq(page, (s) => s.phase === 'verdict' && s.vstep === 'write' && s.dlg === 'off' && !s.cut && s.writable, 'verdict easy');
    const c2 = CASES.c02;
    const wrong = c2.verdictModes.choice.options.find((o) => !o.correct);
    await page.click(`.vopt[data-option-id="${wrong.id}"]`);
    await page.click('[data-verdict-submit]');
    await waitFn(page, () => !!document.querySelector('.gover[data-gameover="inquest"]'), null, {
      label: 'easy game over',
      timeout: 60000,
      each: async () => {
        const st = await iqState(page);
        if (st?.dlg === 'on') {
          await page.evaluate(() => window.__JD.skipText());
          await page.click('.iq__dialogue .dlg', { force: true, timeout: 2000 }).catch(() => {});
        }
      },
    });
    await shot(page, 'gameover-easy', 5200);
    const e = await page.evaluate(() => window.__JD.getState().save.cases['c02-ball-at-dusk']);
    check(
      e.stage === 'inquest' && e.inquest.phase === 'debate' && e.inquest.lives === 10 && e.inquest.debateSkipped === false && !!e.token && (e.snapshot?.unlocked?.length ?? 0) > 5,
      `${size}: 見習い game over → start of the inquest, lights refilled, findings kept (${JSON.stringify({ stage: e.stage, phase: e.inquest?.phase, lives: e.inquest?.lives, unlocked: e.snapshot?.unlocked?.length })})`,
    );
    await page.click('[data-gameover-title]');
    await page.waitForFunction(() => window.__JD.getState().route.scene === 'title');
    await page.evaluate(() => window.__JD.idle());
    await wait(600);
    // title → 続きから reopens the case where the rule left it
    await page.evaluate(() => window.__JD.goto('inquest', { caseId: 'c02-ball-at-dusk' }));
    await untilIq(page, (s) => s.phase === 'debate' && s.step === 'play' && s.dlg === 'off' && s.card === 'off' && !s.cut, 'easy: back at the inquest');
    check(true, `${size}: 見習い reopens the case at the noise break`);
    await page.close();
  });

  /* ---- 5. S+ result ---- */
  await section(['result'], async () => {
    console.log(`\n[modes] ${size}: S+ result`);
    const page = await fresh(ctx, `${size}-result`);
    await page.evaluate(() => {
      window.__JD.updateCase('c01-room-without-breath', {
        stage: 'complete',
        completed: true,
        clears: 1,
        difficulty: 'hard',
        bestRank: 'S+',
        bestPoints: 150,
        lastResult: {
          rank: 'S+',
          title: '完全無欠の審問官',
          at: Date.now(),
          elapsedMs: 11 * 60000 + 12000,
          playDifficulty: 'hard',
          stats: { score: 100, asked: 18, keyQuestions: 10, answered: 18, hintsUsed: 0, debateMisses: 0, grants: 0, verdictAttempts: 1, suspensions: 0, quizMisses: 0, debateRounds: 2, debateCleared: 2, difficulty: 1, estimatedMinutes: 15 },
        },
      });
      window.__JD.goto('result', { caseId: 'c01-room-without-breath' });
    });
    await page.waitForSelector('.rs-rank__seal', { timeout: 30000 });
    await shot(page, 'result-splus', 1500);
    if (narrow) {
      await page.evaluate(() => document.querySelector('.rs-side')?.scrollIntoView({ block: 'start' }));
      await shot(page, 'result-splus-stats', 600);
    }
    await page.evaluate(() => window.__JD.goto('files'));
    await page.waitForSelector('.tag__rank-value', { timeout: 20000 });
    check((await page.textContent('.tag__rank-value')) === 'S+', `${size}: the files tag shows best rank S+`);
    await page.close();
  });

  /* ---- 6. 遊び方 ---- */
  await section(['howto'], async () => {
    console.log(`\n[modes] ${size}: howto`);
    const page = await fresh(ctx, `${size}-howto`);
    await page.evaluate(() => window.__JD.openOverlay('howto'));
    await page.waitForSelector('.howto');
    await page.click('.howto-dot >> nth=4');
    await shot(page, 'howto-noise', 700);
    await page.click('.howto-dot >> nth=5');
    await shot(page, 'howto-verdict', 700);
    await page.click('[data-howto-tutorial]');
    await wait(300);
    const t = await page.evaluate(() => window.__JD.getState().save.meta.tutorial);
    check(t?.state === 'on' && t.anyCase === true && t.step === 0, `${size}: 遊び方 → チュートリアル restarts the tutorial for any case`);
    await page.close();
  });
  await ctx.close();
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  for (const f of readdirSync(out)) if (f.endsWith('.png') && (!ONLY_SIZE || f.startsWith(`${ONLY_SIZE}-`)) && !ONLY) rmSync(resolve(out, f));
  for (const size of ONLY_SIZE ? [ONLY_SIZE] : ['pc', 'sp']) {
    try {
      await runSize(browser, size);
    } catch (e) {
      problems.push(`${size}: ${e.message.split('\n')[0]}`);
      console.error(`  ✗ ${size}: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
if (problems.length) {
  console.error(`\n[modes] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n[modes] OK');
