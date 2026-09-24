/**
 * Vite plugin: defaults for %VITE_*% placeholders in index.html + release-aware robots.
 *
 * Vite replaces %VITE_FOO% in HTML only when the variable is defined; otherwise it leaves
 * the literal text. This plugin runs first and fills in sensible defaults for undefined
 * keys, and removes the static `noindex` meta when VITE_OFFICIAL_RELEASE_ENABLED=true.
 *
 * Wire it in vite.config.ts:
 *   import { htmlEnvDefaults } from './src/build/html-env';
 *   plugins: [preact(), htmlEnvDefaults(), ...]
 *
 * Node-only (used by the Vite config, never bundled into the app).
 */
import type { Plugin } from 'vite';

export const HTML_ENV_DEFAULTS: Record<string, string> = {
  VITE_APP_TITLE: 'ジェーンドゥの死因',
  VITE_SITE_DESCRIPTION:
    '名前を失った魂「ジェーン・ドゥ」の死因を、はい／いいえの質問だけで暴く科学ミステリーADV。審問で記憶のノイズを論破し、彼女の名前と、その死の裏にある科学を持ち帰る。',
  VITE_SITE_URL: '',
  VITE_OFFICIAL_RELEASE_ENABLED: 'false',
};

export function htmlEnvDefaults(defaults: Record<string, string> = HTML_ENV_DEFAULTS): Plugin {
  let env: Record<string, unknown> = {};
  return {
    name: 'janedoe:html-env-defaults',
    configResolved(config) {
      env = { ...config.env };
      for (const [k, v] of Object.entries(config.define ?? {})) {
        if (k.startsWith('import.meta.env.')) env[k.slice(16)] = v;
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const has = (k: string) => env[k] !== undefined && env[k] !== '';
        const official = String(env.VITE_OFFICIAL_RELEASE_ENABLED ?? '').toLowerCase() === 'true' || env.VITE_OFFICIAL_RELEASE_ENABLED === '1';
        let out = html.replace(/%(VITE_[A-Z0-9_]+)%/g, (m, k: string) => (has(k) ? m : (defaults[k] ?? '')));
        if (official) out = out.replace(/\s*<meta name="robots" content="noindex[^"]*"[^>]*>/, '');
        return out;
      },
    },
  };
}
