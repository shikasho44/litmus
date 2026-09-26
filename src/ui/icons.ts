/**
 * Icon registry (pure data — safe to import from validators/tests).
 * Every icon is 24×24, drawn with `currentColor` strokes (2px, round caps) so it inherits
 * text colour. Case data may reference any key of ICONS in `fact.icon`.
 */
import type { FactCategory } from '../../shared/case-schema';

const S = (d: string) => `<path d="${d}"/>`;

export const ICONS = {
  /* ---- 所見カテゴリ ---- */
  person: `<circle cx="12" cy="7.5" r="3.6"/>${S('M4.5 20.5c.8-4.2 3.8-6.6 7.5-6.6s6.7 2.4 7.5 6.6')}`,
  place: `${S('M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z')}<circle cx="12" cy="10" r="2.4"/>`,
  time: `<circle cx="12" cy="12" r="8.5"/>${S('M12 7v5.2l3.4 2.1')}`,
  item: `${S('M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z')}${S('M4 7.6l8 4.4 8-4.4M12 12v8.8')}`,
  /** Alias of `item` — case data uses the key `object` (物品). */
  object: `${S('M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z')}${S('M4 7.6l8 4.4 8-4.4M12 12v8.8')}`,
  body: `${S('M12 20.2s-7.6-4.6-7.6-10a4.2 4.2 0 0 1 7.6-2.5 4.2 4.2 0 0 1 7.6 2.5c0 5.4-7.6 10-7.6 10z')}${S('M6.8 12h2.6l1.3-2.4 2 4.6 1.4-2.2h3.1')}`,
  environment: `${S('M10 14.2V5a2 2 0 0 1 4 0v9.2a3.6 3.6 0 1 1-4 0z')}${S('M12 16.8V10')}${S('M17.5 6h2.5M17.5 9.5h2')}`,
  evidence: `<circle cx="10.5" cy="10.5" r="6"/>${S('M15 15l5.5 5.5')}${S('M8 10.5h5M10.5 8v5')}`,
  science: `${S('M9.5 3.5h5M10.3 3.5v5.6L5 18.4A1.6 1.6 0 0 0 6.4 20.8h11.2a1.6 1.6 0 0 0 1.4-2.4l-5.3-9.3V3.5')}${S('M7.6 14.5h8.8')}`,
  /* ---- UI ---- */
  hint: `${S('M9.2 17.5h5.6M10 20.5h4')}${S('M12 3.5a5.8 5.8 0 0 0-3.4 10.5c.6.5.8 1.1.8 1.8v.4h5.2v-.4c0-.7.2-1.3.8-1.8A5.8 5.8 0 0 0 12 3.5z')}`,
  notebook: `${S('M6 3.5h11.5a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6z')}${S('M6 3.5v17M3.8 7h4.4M3.8 12h4.4M3.8 17h4.4')}${S('M11 8.5h4.5M11 12h4.5')}`,
  gavel: `${S('M13.2 3.8l5.6 5.6M11.1 6l5.6 5.6')}${S('M12.2 4.9l-4 4 5.6 5.6 4-4')}${S('M10 12l-6.2 6.2a1.4 1.4 0 0 0 2 2L12 14')}${S('M13.5 20.5h7')}`,
  settings: `<circle cx="12" cy="12" r="3"/>${S('M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7')}<circle cx="12" cy="12" r="6.6"/>`,
  soundOn: `${S('M4 9.5h3.5L12 5.5v13l-4.5-4H4z')}${S('M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11')}`,
  soundOff: `${S('M4 9.5h3.5L12 5.5v13l-4.5-4H4z')}${S('M16 9.5l5 5M21 9.5l-5 5')}`,
  back: S('M14.5 5.5 8 12l6.5 6.5M8.5 12H20'),
  send: `${S('M4 12 20 4.5 14.5 20l-2.8-6.2z')}${S('M11.7 13.8 20 4.5')}`,
  close: S('M6 6l12 12M18 6 6 18'),
  menu: S('M4 7h16M4 12h16M4 17h10'),
  info: `<circle cx="12" cy="12" r="8.5"/>${S('M12 11v5.5')}<circle cx="12" cy="7.8" r=".6" fill="currentColor"/>`,
  check: S('M4.5 12.5l5 5L19.5 7'),
  cross: S('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  /* ---- extra ---- */
  play: S('M8 5.5v13l10-6.5z'),
  skip: `${S('M5 6v12l7-6z')}${S('M12 6v12l7-6z')}${S('M19.5 6v12')}`,
  log: `${S('M8.5 6.5h11M8.5 12h11M8.5 17.5h11')}<circle cx="4.8" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".9" fill="currentColor"/>`,
  auto: `<circle cx="12" cy="12" r="8.5"/>${S('M10 8.5v7l5.5-3.5z')}`,
  chevronRight: S('M9 5.5 15.5 12 9 18.5'),
  chevronLeft: S('M15 5.5 8.5 12l6.5 6.5'),
  chevronDown: S('M5.5 9 12 15.5 18.5 9'),
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="1.5"/>${S('M8 10.5V8a4 4 0 0 1 8 0v2.5')}`,
  eye: `${S('M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z')}<circle cx="12" cy="12" r="2.8"/>`,
  star: S('M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z'),
  tag: `${S('M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z')}<circle cx="8" cy="8" r="1.6"/>`,
  shard: `${S('M12 2.5 20 9l-3 12.5H7L4 9z')}${S('M12 2.5 10 12l7 9.5M10 12l-6-3M10 12l10-3')}`,
  pulse: S('M2.5 12.5h4l2-5 3.5 10 2.5-7 1.5 2h5.5'),
  help: `<circle cx="12" cy="12" r="8.5"/>${S('M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.1-2.5 3.8')}<circle cx="12" cy="16.8" r=".6" fill="currentColor"/>`,
  credits: `${S('M12 3.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 15.3l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z')}`,
  refresh: `${S('M19.5 12a7.5 7.5 0 1 1-2.2-5.3')}${S('M19.5 4.5v4h-4')}`,
  trash: `${S('M4.5 6.5h15M9.5 6.5V4.2h5v2.3M6.5 6.5l1 13.5h9l1-13.5')}${S('M10 10v6.5M14 10v6.5')}`,
  external: `${S('M13.5 4.5h6v6M19.5 4.5l-8 8')}${S('M18 14v5.5H4.5V6H10')}`,
  search: `<circle cx="10.5" cy="10.5" r="6"/>${S('M15 15l5.5 5.5')}`,
  alert: `${S('M12 3.8 21 19.5H3z')}${S('M12 10v4.4')}<circle cx="12" cy="16.9" r=".6" fill="currentColor"/>`,
  heart: S('M12 19.8s-7.6-4.6-7.6-10a4.2 4.2 0 0 1 7.6-2.5 4.2 4.2 0 0 1 7.6 2.5c0 5.4-7.6 10-7.6 10z'),
  whisper: `${S('M4.5 6.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H10l-4 3.2V15.5H4.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z')}${S('M7 11h.01M10 11h.01M13 11h.01')}${S('M20 8.5c.9.8 1.4 1.9 1.4 3s-.5 2.2-1.4 3')}`,
  sidebar: `<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>${S('M9.5 4.5v15')}`,
  /* ---- online versus ---- */
  copy: `<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/>${S('M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5')}`,
  users: `<circle cx="9" cy="8" r="3.2"/>${S('M3 19.5c.6-3.6 3-5.6 6-5.6s5.4 2 6 5.6')}${S('M15.2 4.9a3.2 3.2 0 0 1 0 6.2M17.3 14.3c2 .8 3.3 2.6 3.7 5.2')}`,
  crown: `${S('M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z')}${S('M4.5 20.5h15')}`,
    rabbit: `${S('M9 10.5C7.6 7 7.4 3.4 8.6 3.2s2.5 3.6 2.6 7M13 10.5c.4-3.6 1.8-7.4 3-7.1s.8 3.9-.8 7.4')}<circle cx="12" cy="15" r="5.5"/><circle cx="10" cy="14.4" r=".7" fill="currentColor"/><circle cx="14" cy="14.4" r=".7" fill="currentColor"/>`,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_KEYS = Object.keys(ICONS) as IconName[];

/** 所見カテゴリ → icon */
export const CATEGORY_ICON: Record<FactCategory, IconName> = {
  人物: 'person',
  場所: 'place',
  時間: 'time',
  物品: 'item',
  身体: 'body',
  環境: 'environment',
  証拠: 'evidence',
  科学: 'science',
};

/** Resolve a case-data icon key (or category) to a registered icon. */
export function resolveIcon(key: string | undefined, category?: FactCategory): IconName {
  if (key && key in ICONS) return key as IconName;
  if (category && category in CATEGORY_ICON) return CATEGORY_ICON[category];
  return 'evidence';
}
