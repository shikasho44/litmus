#!/usr/bin/env node
/**
 * Deploys the AI-judged version to Cloudflare Workers → https://litmus.fourthplace43.com/
 * (docs/DEPLOY.md §3). Secrets are NOT handled here (wrangler secret put, once).
 *
 *   npm run deploy:cf                    content module → http build → _headers → D1 migrations → wrangler deploy
 *   npm run deploy:cf -- --dry-run       everything except the migrations and the upload (bundle size check)
 *   npm run deploy:cf -- --skip-build    reuse dist/ (only if it is THIS build — see the check below)
 *
 * Build settings (override by setting them in the environment before running):
 *   VITE_SITE_URL=https://litmus.fourthplace43.com/   VITE_OFFICIAL_RELEASE_ENABLED=false
 *   VITE_API_MODE=http                                 VITE_INCLUDE_ADMIN=false
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const WRANGLER = 'npx --yes wrangler@4';
const SITE_URL = process.env.VITE_SITE_URL || 'https://litmus.fourthplace43.com/';

const buildEnv = {
  ...process.env,
  VITE_API_MODE: process.env.VITE_API_MODE || 'http',
  VITE_SITE_URL: SITE_URL,
  VITE_OFFICIAL_RELEASE_ENABLED: process.env.VITE_OFFICIAL_RELEASE_ENABLED || 'false',
  VITE_INCLUDE_ADMIN: process.env.VITE_INCLUDE_ADMIN || 'false',
};

function run(title, cmd, env = process.env) {
  console.log(`\n▶ ${title}\n  $ ${cmd}`);
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true, env });
  if (r.status !== 0) {
    console.error(`\n✖ failed: ${title} (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

run('1/5 embed the case content for the Worker', 'npx tsx scripts/cf-content.ts');
if (!skipBuild) run('2/5 http build (dist/)', 'npm run build', buildEnv);
else console.log('\n▶ 2/5 build skipped (--skip-build)');

// Refuse to ship the wrong dist/ (e.g. a static build made for fourthplace43.com/games/…).
const indexHtml = join(ROOT, 'dist', 'index.html');
if (!existsSync(indexHtml)) {
  console.error('dist/index.html is missing — run without --skip-build');
  process.exit(1);
}
const html = readFileSync(indexHtml, 'utf8');
if (!html.includes(`content="${SITE_URL}"`)) {
  console.error(`dist/ was not built for ${SITE_URL} (og:url differs) — run without --skip-build`);
  process.exit(1);
}
const jsDir = join(ROOT, 'dist', 'assets');
const embedded = existsSync(jsDir) && readdirSync(jsDir).some((f) => f.endsWith('.js') && readFileSync(join(jsDir, f), 'utf8').includes('janedoe-embedded-insecure-key'));
if (embedded) {
  console.error('dist/ is the static (embedded) build — the Worker needs the http build. Run without --skip-build.');
  process.exit(1);
}

console.log('\n▶ 3/5 response headers → dist/_headers');
// LF only: a Windows checkout (core.autocrlf) turns the file into CRLF.
writeFileSync(join(ROOT, 'dist', '_headers'), readFileSync(join(ROOT, 'cloudflare', '_headers'), 'utf8').replace(/\r\n/g, '\n'));

if (dryRun) {
  console.log('\n▶ 4/5 D1 migrations skipped (--dry-run)');
  run('5/5 wrangler deploy --dry-run', `${WRANGLER} deploy --dry-run --outdir dist-worker`);
  console.log('\nDry run done: the bundle is in dist-worker/ (nothing uploaded).');
} else {
  run('4/5 D1 migrations (litmus-versus, remote)', `${WRANGLER} d1 migrations apply litmus-versus --remote`);
  run('5/5 wrangler deploy', `${WRANGLER} deploy`);
  console.log(`\nDeployed. Check: node scripts/smoke-cloudflare.mjs   (${SITE_URL})`);
}
