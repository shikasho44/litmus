/**
 * Title PROTOTYPES (2026-10-01, docs/decisions.md 「タイトル案の試作」).
 *
 * The supervisor proposed new titles; these variants let the owner show them on the real title
 * screen without changing the live one. Pick one with `?title=a` / `?title=b` (any build), or at
 * build time with VITE_TITLE_VARIANT. With neither, `DEFAULT_TITLE_VARIANT` applies — 'current'
 * renders exactly the logo, tab title and strapline from APP_CONFIG as before.
 *
 * To adopt a candidate later: flip DEFAULT_TITLE_VARIANT (then fold the strings into APP_CONFIG /
 * index.html / html-env and drop the switch).
 */
import { APP_CONFIG } from './app';

export type TitleVariantId = 'current' | 'a' | 'a2' | 'b';

/** The one value to flip when a candidate becomes the title. */
export const DEFAULT_TITLE_VARIANT: TitleVariantId = 'current';

export interface TitleVariant {
  id: TitleVariantId;
  /** Tab title (and the name in the PREVIEW suffix). */
  appTitle: string;
  /** What the logo spells (aria-label). */
  logoTitle: string;
  /** The English strapline under the logo. */
  strapline: string;
  /** Logo layout: the current strip logo, or 科学捜査官リトマス (two treatments), or the current one + a subtitle. */
  logo: 'current' | 'forensic' | 'forensic-vert' | 'subtitled';
  /** Variant B: the Japanese subtitle (rendered between em rules) and its English line. */
  subtitle?: { jp: string; en: string };
}

const VARIANTS: Record<TitleVariantId, TitleVariant> = {
  current: {
    id: 'current',
    appTitle: APP_CONFIG.APP_TITLE,
    logoTitle: APP_CONFIG.GAME_TITLE,
    strapline: APP_CONFIG.SUBTITLE,
    logo: 'current',
  },
  // A: 『科学捜査官リトマス』 — 科学捜査官 as an ID plate, リトマス large on the litmus strip.
  a: {
    id: 'a',
    appTitle: '科学捜査官リトマス',
    logoTitle: '科学捜査官リトマス',
    strapline: 'FORENSIC INVESTIGATOR : LITMUS',
    logo: 'forensic',
  },
  // A, runner-up treatment: 科学捜査官 set vertically beside the strip.
  a2: {
    id: 'a2',
    appTitle: '科学捜査官リトマス',
    logoTitle: '科学捜査官リトマス',
    strapline: 'FORENSIC INVESTIGATOR : LITMUS',
    logo: 'forensic-vert',
  },
  // B: 『リトマス審問 ―アナムネの告解―』 — the current logo untouched + a subtitle line.
  b: {
    id: 'b',
    appTitle: 'リトマス審問 ―アナムネの告解―',
    logoTitle: 'リトマス審問 アナムネの告解',
    strapline: APP_CONFIG.SUBTITLE,
    logo: 'subtitled',
    subtitle: { jp: 'アナムネの告解', en: 'ANAMNESIS : A CONFESSION' },
  },
};

function isId(v: unknown): v is TitleVariantId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VARIANTS, v);
}

function pick(): TitleVariantId {
  try {
    const q = new URLSearchParams(location.search).get('title')?.toLowerCase();
    if (isId(q)) return q;
  } catch {
    /* no location (tests) */
  }
  const env = (import.meta.env.VITE_TITLE_VARIANT as string | undefined)?.toLowerCase();
  return isId(env) ? env : DEFAULT_TITLE_VARIANT;
}

export const TITLE_VARIANT: TitleVariant = VARIANTS[pick()];
