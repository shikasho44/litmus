import { useEffect } from 'preact/hooks';
import { fxRefs } from '../fx';
import { BackdropCanvas, FxLayer } from '../fx/FxLayer';
import { settings, storageOk } from '../state/save';
import { ToastHost, toast } from '../ui/Toast';
import { OverlayHost } from './OverlayHost';
import { SceneHost } from './SceneHost';
import './shell.css';

/** Keeps <html> attributes in sync with settings (font scale, reduced motion). */
function useSettingsSync() {
  const s = settings.value;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--fs-scale', String(s.fontScale / 100));
    root.dataset.reduceMotion = s.reduceMotion ? 'true' : 'false';
  }, [s.fontScale, s.reduceMotion]);
}

export function App() {
  useSettingsSync();
  useEffect(() => {
    if (!storageOk.peek()) toast('この環境では進み具合を保存できません（プライベートモード等）', { tone: 'warn', duration: 6000 });
  }, []);
  return (
    <div class="app-shell">
      <BackdropCanvas />
      <div
        class="scene-host"
        ref={(el) => {
          fxRefs.shake = el;
        }}
      >
        <SceneHost />
      </div>
      <div class="grain" aria-hidden="true" />
      <FxLayer />
      <OverlayHost />
      <ToastHost />
    </div>
  );
}
