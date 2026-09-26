/**
 * App-level settings. Titles are configuration, not code: everything user-visible that names
 * the game comes from here and can be changed with VITE_* environment variables. (Renamed from
 * 「ジェーンドゥの死因」 on 2026-09-26 — that title overlaps a 薬理凶室 project; docs/decisions.md.)
 */
const env = import.meta.env;

const bool = (v: unknown, fallback: boolean) =>
  v === undefined || v === '' ? fallback : String(v).toLowerCase() === 'true' || v === '1';

export const APP_CONFIG = {
  APP_TITLE: (env.VITE_APP_TITLE as string) || 'リトマス審問',
  GAME_TITLE: (env.VITE_GAME_TITLE as string) || 'リトマス審問',
  SUBTITLE: (env.VITE_SUBTITLE as string) || 'LITMUS INQUEST : YES OR NO',
  COPYRIGHT_NOTICE: (env.VITE_COPYRIGHT_NOTICE as string) || '© 2026 fourthplace43　本作に登場する事件・人物・団体はすべて架空です。',
  OFFICIAL_RELEASE_ENABLED: bool(env.VITE_OFFICIAL_RELEASE_ENABLED, false),
  CONTACT_URL: (env.VITE_CONTACT_URL as string) || 'https://fourthplace43.com/contact/',
  ANALYTICS_ID: (env.VITE_ANALYTICS_ID as string) || '',
  /** 'http' talks to /api (dev server, Vercel). 'embedded' bundles the rules engine (static build). */
  API_MODE: ((env.VITE_API_MODE as string) || (env.MODE === 'static' ? 'embedded' : 'http')) as 'http' | 'embedded',
  SAVE_KEY: 'janedoe:save:v1',
} as const;
