/**
 * Scene manager (signals + history).
 *
 *   goto('files')                              push a scene
 *   goto('investigation', { caseId })          scenes that need a case get it in params
 *   goto('title', {}, { replace: true })       replace instead of push
 *   back()                                     browser back (falls back to title)
 *   openOverlay('settings') / closeOverlay()   overlays are history entries too, so the
 *                                              hardware/browser back button closes them
 *
 * URL form: #/<scene>/<caseId>?k=v  (hash routing works from any sub-folder).
 * 'versus' is the online versus lobby (http build only; the static build maps it to the title).
 */
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';

export const SCENE_NAMES = ['title', 'prologue', 'files', 'intro', 'investigation', 'inquest', 'resolution', 'science', 'quiz', 'result', 'versus'] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export type SceneParams = { caseId?: string } & Record<string, string | undefined>;
export interface Route {
  scene: SceneName;
  params: SceneParams;
}
export interface SceneProps {
  params: SceneParams;
}

/** Scenes that cannot be shown without a caseId. */
export const CASE_SCENES: SceneName[] = ['intro', 'investigation', 'inquest', 'resolution', 'science', 'quiz', 'result'];

export type OverlayName = 'settings' | 'howto' | 'credits' | 'difficulty' | 'sheet';
/** Props of the difficulty chooser: 'start' begins the case, 'change' only saves the choice. */
export interface DifficultyOverlayProps {
  caseId: string;
  mode: 'start' | 'change';
}
export interface SheetOverlayProps {
  title: string;
  en?: string;
  side?: 'auto' | 'bottom' | 'left' | 'right';
  /** Wider drawer on PC (760px instead of 420px). */
  wide?: boolean;
  render: () => ComponentChildren;
  headerExtra?: () => ComponentChildren;
}
export type OverlayState =
  | { name: 'settings' | 'howto' | 'credits'; props?: Record<string, unknown> }
  | { name: 'difficulty'; props: DifficultyOverlayProps }
  | { name: 'sheet'; props: SheetOverlayProps };

interface HistState {
  jd: 1;
  route: Route;
  overlay?: OverlayState['name'];
  idx: number;
}

export const route = signal<Route>({ scene: 'title', params: {} });
export const overlay = signal<OverlayState | null>(null);
/** true while the shutter transition is running. */
export const transitioning = signal(false);

let idx = 0;
let sheetProps: SheetOverlayProps | null = null;
let difficultyProps: DifficultyOverlayProps | null = null;

function isScene(s: string): s is SceneName {
  return (SCENE_NAMES as readonly string[]).includes(s);
}

export function routeToHash(r: Route): string {
  const { caseId, ...rest } = r.params;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `#/${r.scene}${caseId ? `/${encodeURIComponent(caseId)}` : ''}${qs ? `?${qs}` : ''}`;
}

export function parseHash(hash = location.hash): Route | null {
  const m = hash.match(/^#\/([a-z]+)(?:\/([^?]+))?(?:\?(.*))?$/);
  if (!m || !isScene(m[1])) return null;
  const params: SceneParams = {};
  if (m[2]) params.caseId = decodeURIComponent(m[2]);
  if (m[3]) new URLSearchParams(m[3]).forEach((v, k) => (params[k] = v));
  if (CASE_SCENES.includes(m[1]) && !params.caseId) return null;
  return { scene: m[1], params };
}

function state(r: Route, o?: OverlayState['name']): HistState {
  return { jd: 1, route: r, overlay: o, idx };
}

function keepQuery() {
  // preserve ?debug=1 etc. in the URL
  return location.pathname + location.search;
}

/** Initialise from the URL and listen to popstate. Call once at boot. */
export function initRouter() {
  const initial = parseHash() ?? { scene: 'title' as SceneName, params: {} };
  // Title is always the entry point of a fresh load except for explicit deep links.
  route.value = initial;
  history.replaceState(state(initial), '', keepQuery() + routeToHash(initial));
  window.addEventListener('popstate', (e) => {
    const s = e.state as HistState | null;
    if (!s || s.jd !== 1) {
      const r = parseHash() ?? { scene: 'title', params: {} };
      route.value = r;
      overlay.value = null;
      return;
    }
    idx = s.idx;
    const r = s.route;
    if (r.scene !== route.peek().scene || JSON.stringify(r.params) !== JSON.stringify(route.peek().params)) route.value = r;
    if (s.overlay) {
      if (s.overlay === 'sheet') overlay.value = sheetProps ? { name: 'sheet', props: sheetProps } : null;
      else if (s.overlay === 'difficulty') overlay.value = difficultyProps ? { name: 'difficulty', props: difficultyProps } : null;
      else overlay.value = { name: s.overlay };
    } else overlay.value = null;
  });
}

export function goto(scene: SceneName, params: SceneParams = {}, opts: { replace?: boolean } = {}) {
  if (CASE_SCENES.includes(scene) && !params.caseId) {
    console.warn(`[router] scene "${scene}" needs a caseId`);
    return;
  }
  const r: Route = { scene, params };
  const cur = route.peek();
  if (cur.scene === scene && JSON.stringify(cur.params) === JSON.stringify(params)) return;
  const hs = history.state as HistState | null;
  const overlayEntry = !!(hs && hs.jd === 1 && hs.overlay);
  overlay.value = null;
  if (opts.replace || overlayEntry) history.replaceState(state(r), '', keepQuery() + routeToHash(r));
  else {
    idx++;
    history.pushState(state(r), '', keepQuery() + routeToHash(r));
  }
  route.value = r;
}

/** Browser back; when there is no in-app history, go to the title. */
export function back() {
  const s = history.state as HistState | null;
  if (s && s.jd === 1 && s.idx > 0) history.back();
  else goto('title', {}, { replace: true });
}

export function openOverlay(name: 'settings' | 'howto' | 'credits', props?: Record<string, unknown>): void;
export function openOverlay(name: 'difficulty', props: DifficultyOverlayProps): void;
export function openOverlay(name: 'sheet', props: SheetOverlayProps): void;
export function openOverlay(name: OverlayName, props?: any) {
  if (overlay.peek()?.name === name) return;
  if (name === 'sheet') sheetProps = props;
  if (name === 'difficulty') difficultyProps = props;
  const replacing = !!overlay.peek();
  overlay.value = { name, props } as OverlayState;
  if (replacing) history.replaceState(state(route.peek(), name), '');
  else {
    idx++;
    history.pushState(state(route.peek(), name), '');
  }
}

export function closeOverlay() {
  const s = history.state as HistState | null;
  if (s && s.jd === 1 && s.overlay) history.back();
  else overlay.value = null;
}
