import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { janedoeApi } from './server/node/vite-plugin.js';
import { htmlEnvDefaults } from './src/build/html-env.js';

export default defineConfig(({ mode }) => {
  const root = process.cwd();
  const env = loadEnv(mode, root, 'VITE_');
  // Same rule as APP_CONFIG.API_MODE (src/config/app.ts). Compile-time so the http build
  // drops the embedded engine + case data completely (see src/api/index.ts).
  const embedded = (env.VITE_API_MODE || (mode === 'static' ? 'embedded' : 'http')) === 'embedded';

  // Multi-page: the game (index.html) + the admin console (admin.html, docs/admin.md).
  // The static/embedded build has no server API, so the admin console is left out there.
  const input: Record<string, string> = { index: resolve(root, 'index.html') };
  if (!embedded) input.admin = resolve(root, 'admin.html');

  return {
    base: './',
    plugins: [preact(), htmlEnvDefaults(), janedoeApi()],
    define: { __JANEDOE_EMBEDDED__: JSON.stringify(embedded) },
    server: {
      port: 5190,
      // Generated output is served on request but never watched (bench writes HTML reports
      // under the root, which would otherwise trigger page reloads while the game is open).
      watch: { ignored: ['**/bench/reports/**', '**/logs/**', '**/qa/**', '**/dist/**', '**/dist-*/**'] },
    },
    // 4190 is on the browsers' blocked-port list (Chromium refuses it) → 4191.
    preview: { port: 4191 },
    build: { rolldownOptions: { input } },
  };
});
