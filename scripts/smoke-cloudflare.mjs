#!/usr/bin/env node
/**
 * Remote smoke test of the Cloudflare deployment (docs/DEPLOY.md §3).
 *
 *   node scripts/smoke-cloudflare.mjs                 page + headers + API + online versus (no AI, free)
 *   node scripts/smoke-cloudflare.mjs --ask           + one real question to Jev in c01 (about $0.0003; --question "…")
 *   node scripts/smoke-cloudflare.mjs --browser       + open the page in headless Chromium, fail on console errors
 *   --base https://litmus.fourthplace43.com           another deployment (default shown)
 *
 * The versus part plays a whole room over the API with two clients: create → join → start →
 * poll → run (room-bound tokens after the countdown) → progress → leave. The room closes when
 * the host leaves and D1 drops it within hours (cron).
 *
 * DNS: right after a new custom domain is added, a local resolver may still cache "no such
 * host". Then the script asks Cloudflare's DNS-over-HTTPS for the address and connects to it
 * directly (TLS still checks the real host name), and Chromium gets the same mapping.
 */
import https from 'node:https';
import dns from 'node:dns';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const BASE = new URL(opt('--base', 'https://litmus.fourthplace43.com/'));
const HOST = BASE.hostname;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 litmus-smoke';
const CASE = 'c01-room-without-breath';

let pinned; // IP from DoH when the system resolver fails
async function resolveHost() {
  try {
    await dns.promises.lookup(HOST);
    return;
  } catch {
    /* fall through to DoH */
  }
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${HOST}&type=A`, { headers: { accept: 'application/dns-json' } });
  const data = await res.json();
  pinned = data.Answer?.find((a) => a.type === 1)?.data;
  if (!pinned) throw new Error(`cannot resolve ${HOST}`);
  console.log(`  (local DNS does not know ${HOST} yet → using ${pinned} from Cloudflare DNS)`);
}

function request(method, path, body) {
  const url = new URL(path, BASE);
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: { 'user-agent': UA, accept: 'application/json, text/html', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) },
        lookup: pinned ? (_h, o, cb) => (o && o.all ? cb(null, [{ address: pinned, family: 4 }]) : cb(null, pinned, 4)) : undefined,
        timeout: 20_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`smoke: ${BASE.href}`);
  await resolveHost();

  // ── page + headers
  const page = await get('/');
  check('GET / is the game page', page.status === 200 && /<title>[^<]*リトマス審問/.test(page.text), `HTTP ${page.status}`);
  check('og:url is this site', page.text.includes(`property="og:url" content="${BASE.href}"`));
  check('PREVIEW: noindex while not officially released', /name="robots" content="noindex/.test(page.text));
  check('security headers (CSP, nosniff, frame DENY)', !!page.headers['content-security-policy'] && page.headers['x-content-type-options'] === 'nosniff' && page.headers['x-frame-options'] === 'DENY');
  const asset = page.text.match(/assets\/index-[\w-]+\.js/)?.[0];
  if (asset) {
    const a = await get(`/${asset}`);
    check('hashed assets are cached for a year', a.status === 200 && /immutable/.test(a.headers['cache-control'] ?? ''), a.headers['cache-control']);
  }
  const deep = await get('/no/such/page');
  check('unknown paths fall back to the game (SPA)', deep.status === 200 && deep.text.includes('<div id="app"'), `HTTP ${deep.status}`);

  // ── API
  const health = await get('/api/health');
  check('GET /api/health', health.status === 200 && health.json?.ok === true, health.text.slice(0, 80));
  const cases = await get('/api/cases');
  const ids = Array.isArray(cases.json) ? cases.json.map((c) => c.id) : [];
  check('GET /api/cases lists the cases', ids.length >= 4 && ids.includes(CASE), ids.join(', '));
  check('the case list carries no secrets', !/"truth"|"probes"|"answer"/.test(cases.text));
  const cfg = await get('/api/versus/config');
  check('GET /api/versus/config → enabled', cfg.json?.enabled === true, cfg.text);
  const nf = await get('/api/admin/status');
  check('admin API is closed (no ADMIN_TOKEN)', nf.status === 404, `HTTP ${nf.status}`);

  // ── online versus (two clients, no AI)
  const cid = (n) => `smoke${n}${Math.random().toString(36).slice(2).padEnd(12, 'x')}`;
  const host = await post('/api/versus/create', { caseId: CASE, difficulty: 'easy', name: 'SMOKE-H', cid: cid('h') });
  if (check('versus: create a room', host.status === 200 && /^[A-Z2-9]{6}$/.test(host.json?.room?.code ?? ''), host.status === 200 ? host.json.room.code : host.text)) {
    const code = host.json.room.code;
    const bad = await post('/api/versus/join', { code: 'ZZZZZZ', name: 'x' });
    check('versus: an unknown code is 404', bad.status === 404, `HTTP ${bad.status}`);
    const guest = await post('/api/versus/join', { code, name: 'SMOKE-G', cid: cid('g') });
    check('versus: join from a second client', guest.status === 200 && guest.json.room.players.length === 2, guest.status === 200 ? guest.json.room.players.map((p) => p.name).join(' / ') : guest.text);
    const start = await post('/api/versus/start', { seat: host.json.seat });
    check('versus: host starts (countdown)', start.status === 200 && start.json.room.status === 'countdown', start.json?.room?.status ?? start.text);
    const early = await post('/api/versus/run', { seat: guest.json.seat });
    check('versus: no token before the start', early.status === 409, `HTTP ${early.status}`);
    const wait = Math.max(0, (start.json?.room?.startAt ?? 0) - (start.json?.room?.now ?? 0)) + 200;
    await sleep(wait);
    const state = await post('/api/versus/state', { seat: guest.json.seat });
    check('versus: poll → playing', state.status === 200 && state.json.room.status === 'playing', state.json?.room?.status ?? state.text);
    const runH = await post('/api/versus/run', { seat: host.json.seat });
    const runG = await post('/api/versus/run', { seat: guest.json.seat });
    check('versus: both get room-bound tokens', runH.status === 200 && runG.status === 200 && typeof runG.json.token === 'string', `HTTP ${runH.status}/${runG.status}`);
    if (runG.status === 200) {
      const prog = await post('/api/versus/progress', { seat: guest.json.seat, token: runG.json.token });
      const me = prog.json?.room?.players?.find((p) => p.you);
      check('versus: progress from the token', prog.status === 200 && me?.stage === 'investigation', me ? `${me.stage}, asked ${me.asked}` : prog.text);
    }
    const hostView = await post('/api/versus/state', { seat: host.json.seat });
    const other = hostView.json?.room?.players?.find((p) => !p.you);
    check('versus: the host sees the guest playing', other?.stage === 'investigation' && other?.online === true, other ? `${other.name}: ${other.stage}` : hostView.text);
    const lg = await post('/api/versus/leave', { seat: guest.json.seat });
    const lh = await post('/api/versus/leave', { seat: host.json.seat });
    check('versus: both leave', lg.json?.ok === true && lh.json?.ok === true);
    const end = await post('/api/versus/state', { seat: host.json.seat });
    check('versus: the room shows both as 退出', end.status === 200 && end.json.room.players.every((p) => p.left), end.json?.room?.status ?? end.text);
  }

  // ── one real question (Jev), opt-in
  if (flag('--ask')) {
    const tok = await post('/api/token', { caseId: CASE });
    check('POST /api/token', tok.status === 200 && typeof tok.json?.token === 'string', `HTTP ${tok.status}`);
    // An expected question word for word is answered by the rules shortcut (no AI call); the
    // default is a paraphrase so Jev really judges it. --question "…" to ask something else.
    const q = opt('--question', 'その保管室には、外の光が入るような窓がついていましたか？');
    const t0 = Date.now();
    const ask = await post('/api/ask', { caseId: CASE, question: q, token: tok.json.token });
    const a = ask.json?.answers?.[0];
    check(`ask 「${q}」`, ask.status === 200 && !!a, a ? `${a.answerClass} 「${a.line}」 ${a.notice ? `[${a.notice}]` : ''} ${Date.now() - t0}ms` : ask.text);
    check('answered by Jev (not the degraded fallback)', !!a && a.notice !== 'degraded');
  }

  // ── the page in a real (headless) browser, opt-in
  if (flag('--browser')) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ args: pinned ? [`--host-resolver-rules=MAP ${HOST} ${pinned}`] : [] });
    const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    pg.on('pageerror', (e) => errors.push(String(e)));
    pg.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
    await pg.goto(BASE.href, { waitUntil: 'networkidle' });
    await sleep(2500);
    mkdirSync('qa/cloudflare', { recursive: true });
    await pg.screenshot({ path: 'qa/cloudflare/title.png' });
    const title = await pg.title();
    check('browser: the page loads', /リトマス審問/.test(title), title);
    check('browser: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
