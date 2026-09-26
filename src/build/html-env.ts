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
  VITE_APP_TITLE: 'リトマス審問',
  VITE_SITE_DESCRIPTION:
    '名前を失った魂「ジェーン・ドゥ」の死因を、はい／いいえの質問だけで暴く科学ミステリーADV。リトマス試験紙のように、YESかNOかで真実の色を見分けろ。審問で記憶のノイズを論破し、彼女の名前と、その死の裏にある科学を持ち帰る。',
  VITE_SITE_URL: '',
  VITE_OFFICIAL_RELEASE_ENABLED: 'false',
};

/**
 * Share cards need ABSOLUTE URLs (X / Facebook / LINE / Slack ignore relative og:image).
 * With VITE_SITE_URL set (the public page URL, e.g. https://example.com/games/janedoe/),
 * the relative ./og.jpg references become absolute and og:url + canonical are added.
 * Without it (local / preview builds) the tags stay relative and no canonical is emitted.
 */
export function absolutizeShareTags(html: string, siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/*$/, '/');
  if (!/^https?:\/\//.test(base)) return html;
  let out = html.replace(/(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")\.\/([^"]+)"/g, (_m, pre: string, file: string) => `${pre}${base}${file}"`);
  if (!/property="og:url"/.test(out)) out = out.replace(/(\s*)(<meta property="og:type")/, `$1<meta property="og:url" content="${base}" />$1$2`);
  if (!/rel="canonical"/.test(out)) out = out.replace(/(\s*)(<link rel="icon")/, `$1<link rel="canonical" href="${base}" />$1$2`);
  return out;
}

export function htmlEnvDefaults(defaults: Record<string, string> = HTML_ENV_DEFAULTS): Plugin {
  let env: Record<string, unknown> = {};
  let isBuild = false;
  return {
    name: 'janedoe:html-env-defaults',
    configResolved(config) {
      isBuild = config.command === 'build';
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
        const siteUrl = String(env.VITE_SITE_URL ?? '').trim();
        // An official release must have working share cards: no site URL, no release build.
        if (official && isBuild && !siteUrl && /property="og:image"/.test(html))
          throw new Error('[html-env] VITE_OFFICIAL_RELEASE_ENABLED=true needs VITE_SITE_URL (absolute og:image / og:url / canonical).');
        if (siteUrl) out = absolutizeShareTags(out, siteUrl);
        return out;
      },
    },
  };
}
