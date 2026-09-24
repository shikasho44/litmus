import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../audio';
import { layout } from '../lib/viewport';
import { IconButton } from './Button';
import { portalRoot, useDialog } from './dialog';
import './modal.css';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  en?: string;
  /** 'auto' = bottom sheet on narrow layouts, left drawer on wide layouts. */
  side?: 'auto' | 'bottom' | 'left' | 'right';
  children?: ComponentChildren;
  /** Extra controls rendered in the header (e.g. Tabs). */
  headerExtra?: ComponentChildren;
  /** Show a dim backdrop on wide layouts too (default true). */
  modalOnWide?: boolean;
  class?: string;
}

let uid = 0;

/**
 * Mobile bottom sheet (drag the handle down to close) that becomes a side drawer on PC.
 * Intended for the 捜査ノート (notebook) and other secondary panels.
 */
export function BottomSheet({ open, onClose, title, en, side = 'auto', children, headerExtra, modalOnWide = true, class: cls }: BottomSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [id] = useState(() => `sheet-${++uid}`);
  // only once the dialog DOM is mounted, so the trap / Esc handler can attach to it
  const ref = useDialog(open && mounted && !closing, onClose);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const resolved = side === 'auto' ? (layout.value === 'narrow' ? 'bottom' : 'left') : side;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      audio.sfx('open');
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;

  const onPointerDown = (e: PointerEvent) => {
    if (resolved !== 'bottom') return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onPointerUp = () => {
    if (!drag.current || !ref.current) return;
    const { dy } = drag.current;
    drag.current = null;
    ref.current.style.transform = '';
    if (dy > 90) onClose();
  };

  const showBackdrop = resolved === 'bottom' || modalOnWide;
  return createPortal(
    <div class={`sheet-root ${closing ? 'is-closing' : ''}`} style={showBackdrop ? undefined : { pointerEvents: 'none' }}>
      {showBackdrop && <div class="sheet-backdrop" onClick={onClose} aria-hidden="true" />}
      <div
        ref={ref}
        class={`sheet sheet--${resolved} ${cls ?? ''}`}
        role="dialog"
        aria-modal={showBackdrop ? 'true' : undefined}
        aria-labelledby={id}
        tabIndex={-1}
        style={{ pointerEvents: 'auto' }}
      >
        {resolved === 'bottom' && (
          <div class="sheet__handle" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} aria-hidden="true" />
        )}
        <div class="sheet__head">
          <div class="sheet__title" id={id}>
            {en && <span class="sheet__en">{en}</span>}
            {title}
          </div>
          {headerExtra}
          <IconButton icon="close" label="閉じる" variant="plain" sfx="close" onClick={onClose} tooltipSide="left" />
        </div>
        <div class="sheet__body">{children}</div>
      </div>
    </div>,
    portalRoot(),
  );
}
