import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { audio } from '../audio';
import { IconButton } from './Button';
import { portalRoot, useDialog } from './dialog';
import './modal.css';

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: ComponentChildren;
  /** English kicker above the title (Anton). */
  en?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ComponentChildren;
  children?: ComponentChildren;
  /** Click on the backdrop closes (default true). */
  dismissible?: boolean;
  tone?: 'formalin' | 'alarm' | 'cyan';
  class?: string;
  /** id for aria-labelledby (auto if omitted). */
  labelId?: string;
  /** 'alertdialog' for blocking errors that need an answer (default 'dialog'). */
  role?: 'dialog' | 'alertdialog';
}

let uid = 0;

/**
 * Accessible modal dialog (role=dialog, aria-modal, focus trap, Esc, restore focus).
 * Rendered into #portal-root so parent transforms (screen shake) never affect it.
 */
export function Modal({ open, onClose, title, en, size = 'md', footer, children, dismissible = true, tone = 'formalin', class: cls, labelId, role = 'dialog' }: ModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [id] = useState(() => labelId ?? `modal-${++uid}`);
  // only once the dialog DOM is mounted, so the trap / Esc handler can attach to it
  const ref = useDialog(open && mounted && !closing, onClose);

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
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;
  return createPortal(
    <div class={`modal-root ${closing ? 'is-closing' : ''}`} data-tone={tone}>
      <div class="modal-backdrop" onClick={() => dismissible && onClose?.()} aria-hidden="true" />
      <div ref={ref} class={`modal modal--${size} ${cls ?? ''}`} role={role} aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header class="modal__head">
          <div class="modal__stripe" aria-hidden="true" />
          <div class="modal__titles">
            {en && <span class="modal__en">{en}</span>}
            <h2 class="modal__title" id={id}>
              {title}
            </h2>
          </div>
          {onClose && <IconButton icon="close" label="閉じる" variant="plain" sfx="close" onClick={onClose} class="modal__close" tooltipSide="left" />}
        </header>
        <div class="modal__body scroll-y">{children}</div>
        {footer && <footer class="modal__foot">{footer}</footer>}
      </div>
    </div>,
    portalRoot(),
  );
}
