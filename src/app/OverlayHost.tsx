import { useRef } from 'preact/hooks';
import { CreditsOverlay } from '../overlays/Credits';
import { HowToOverlay } from '../overlays/HowTo';
import { SettingsOverlay } from '../overlays/Settings';
import { DifficultyChooser } from '../features/difficulty/DifficultyChooser';
import { BottomSheet } from '../ui/BottomSheet';
import { closeOverlay, overlay, type DifficultyOverlayProps, type SheetOverlayProps } from './router';

/** Renders the overlay named by the `overlay` signal. Each overlay is a history entry. */
export function OverlayHost() {
  const o = overlay.value;
  const sheet = o?.name === 'sheet' ? (o.props as SheetOverlayProps) : null;
  // keep the last sheet's content while it animates out
  const last = useRef<SheetOverlayProps | null>(null);
  if (sheet) last.current = sheet;
  const shown = sheet ?? last.current;
  return (
    <>
      <SettingsOverlay open={o?.name === 'settings'} onClose={closeOverlay} />
      <HowToOverlay open={o?.name === 'howto'} onClose={closeOverlay} />
      <CreditsOverlay open={o?.name === 'credits'} onClose={closeOverlay} />
      <DifficultyChooser open={o?.name === 'difficulty'} props={o?.name === 'difficulty' ? (o.props as DifficultyOverlayProps) : null} onClose={closeOverlay} />
      <BottomSheet
        open={!!sheet}
        onClose={closeOverlay}
        title={shown?.title ?? ''}
        en={shown?.en}
        side={shown?.side ?? 'auto'}
        class={shown?.wide ? 'sheet--wide' : undefined}
        headerExtra={shown?.headerExtra?.()}
      >
        {shown?.render()}
      </BottomSheet>
    </>
  );
}
