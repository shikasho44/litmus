/**
 * window.__JD — debug / QA hook. Enabled in dev or with ?debug=1.
 *
 *   __JD.goto('files')                          scene change
 *   __JD.goto('investigation', { caseId })
 *   __JD.getState()                             { route, overlay, transitioning, save }
 *   __JD.setSettings({ textSpeed: 'instant' })
 *   __JD.skipText()                             finish every typewriter line now
 *   __JD.fx.stamp('yes') / __JD.fx.cutIn({...}) / __JD.audio.bgm('inquest')
 *   __JD.openOverlay('settings')
 *   __JD.resetSave()
 */
import { audio } from '../audio';
import { fx, fxRefs } from '../fx';
import { LINES, PROLOGUE, LINES_FROM_CONTENT, PROLOGUE_FROM_CONTENT } from '../lib/lines';
import { resetAll, saveData, updateMeta, updateSettings, updateCase, flushSave } from '../state/save';
import { skipText } from '../ui/DialogueBox';
import { toast } from '../ui/Toast';
import { back, closeOverlay, goto, openOverlay, overlay, route, transitioning } from './router';

export function installDebug() {
  const api = {
    goto,
    back,
    openOverlay,
    closeOverlay,
    getState: () => ({
      route: route.peek(),
      overlay: overlay.peek()?.name ?? null,
      transitioning: transitioning.peek(),
      save: saveData.peek(),
      content: { lines: LINES_FROM_CONTENT, prologue: PROLOGUE_FROM_CONTENT },
      backdrop: fxRefs.backdrop?.mode ?? 'off',
      audio: { unlocked: audio.unlocked, bgm: audio.currentBgm },
    }),
    setSettings: updateSettings,
    setMeta: updateMeta,
    updateCase,
    skipText,
    fx,
    audio,
    toast,
    lines: LINES,
    prologue: PROLOGUE,
    resetSave: resetAll,
    flushSave,
    /** Opens the UI kit gallery in a side sheet (dev catalogue). */
    gallery: async () => {
      const { renderGallery } = await import('./Gallery');
      openOverlay('sheet', { title: 'UI ギャラリー', en: 'DEV GALLERY', side: 'right', wide: true, render: renderGallery });
    },
    /** Resolves when no scene transition is running. */
    idle: () =>
      new Promise<void>((resolve) => {
        const check = () => (transitioning.peek() ? setTimeout(check, 50) : resolve());
        check();
      }),
  };
  (window as unknown as { __JD: typeof api }).__JD = api;
  return api;
}
