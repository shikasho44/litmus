/** Runtime environment flags. */
const search = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/** Dev server, or ?debug=1 on any build. Enables window.__JD and dev-only settings. */
export const DEBUG = import.meta.env.DEV || search.get('debug') === '1';

/** ?nofx=1 disables the WebGL backdrop (useful for screenshots on weak GPUs). */
export const NO_FX = search.get('nofx') === '1';

/** ?mute=1 starts muted (QA). */
export const START_MUTED = search.get('mute') === '1';

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const isTouch = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};
