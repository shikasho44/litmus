import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { janedoeApi } from './server/node/vite-plugin.js';

export default defineConfig(({ mode }) => {
  const root = process.cwd();
  const env = loadEnv(mode, root, 'VITE_');
  // Same rule as APP_CONFIG.API_MODE (src/config/app.ts). Compile-time so the http build
  // drops the embedded engine + case data completely (see src/api/index.ts).
  const embedded = (env.VITE_API_MODE || (mode === 'static' ? 'embedded' : 'http')) === 'embedded';

  // Multi-page: index.html always, admin.html when present (the admin console is optional).
  const input: Record<string, string> = { main: resolve(root, 'index.html') };
  if (existsSync(resolve(root, 'admin.html'))) input.admin = resolve(root, 'admin.html');

  return {
    base: './',
    plugins: [preact(), janedoeApi()],
    define: { __JANEDOE_EMBEDDED__: JSON.stringify(embedded) },
    server: { port: 5190 },
    preview: { port: 4190 },
    build: { rolldownOptions: { input } },
  };
});
