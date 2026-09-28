import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import preact from '@preact/preset-vite';
import { janedoeApi } from './server/node/vite-plugin.js';
import { htmlEnvDefaults } from './src/build/html-env.js';
import { releaseGuard } from './src/build/release-guard.js';

export default defineConfig(({ mode }) => {
  const root = process.cwd();
  const env = loadEnv(mode, root, 'VITE_');
  // Same rule as APP_CONFIG.API_MODE (src/config/app.ts). Compile-time so the http build
  // drops the embedded engine + case data completely (see src/api/index.ts).
  const embedded = (env.VITE_API_MODE || (mode === 'static' ? 'embedded' : 'http')) === 'embedded';
  const official = /^(true|1)$/i.test(env.VITE_OFFICIAL_RELEASE_ENABLED ?? '');

  // Multi-page: the game (index.html) + the admin console (admin.html, docs/admin.md §1).
  // The admin page ships only where its API can answer: never in the static/embedded build (no
  // server API), and in the http build only when ADMIN_TOKEN is set at build time (without it the
  // production admin API is a 404, so the page would be dead weight that still exposes the admin
  // route map). VITE_INCLUDE_ADMIN=true|false overrides. The dev server serves admin.html anyway.
  const adminFlag = (env.VITE_INCLUDE_ADMIN ?? '').trim().toLowerCase();
  const includeAdmin =
    !embedded && (adminFlag ? adminFlag === 'true' || adminFlag === '1' : !!loadEnv(mode, root, 'ADMIN_TOKEN').ADMIN_TOKEN?.trim());
  const input: Record<string, string> = { index: resolve(root, 'index.html') };
  // A git worktree may link node_modules from the main checkout (a junction / symlink). Vite serves
  // files by their real path, which then lies outside the project and would be refused (403 for the
  // @fontsource fonts): allow the real node_modules folder as well.
  const fsAllow = [searchForWorkspaceRoot(root)];
  try {
    const nm = realpathSync(resolve(root, 'node_modules'));
    if (!nm.startsWith(root)) fsAllow.push(nm);
  } catch {
    /* no node_modules yet */
  }
  if (includeAdmin) input.admin = resolve(root, 'admin.html');

  return {
    base: './',
    // releaseGuard: fails the build if Markdown, case secrets or zod reach the output (see file).
    plugins: [preact(), htmlEnvDefaults(), janedoeApi(), releaseGuard({ embedded, official })],
    define: { __JANEDOE_EMBEDDED__: JSON.stringify(embedded) },
    server: {
      port: 5190,
      // Generated output is served on request but never watched (bench writes HTML reports
      // under the root, which would otherwise trigger page reloads while the game is open).
      watch: { ignored: ['**/bench/reports/**', '**/logs/**', '**/qa/**', '**/dist/**', '**/dist-*/**'] },
      fs: { allow: fsAllow },
    },
    // 4190 is on the browsers' blocked-port list (Chromium refuses it) → 4191.
    preview: { port: 4191 },
    build: { rolldownOptions: { input } },
  };
});
