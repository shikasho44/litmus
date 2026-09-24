/** Shared dialog plumbing: portal root, focus trap, Escape, focus restore, scroll lock. */
import { useEffect, useRef } from 'preact/hooks';

export function portalRoot(): HTMLElement {
  let el = document.getElementById('portal-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'portal-root';
    (document.getElementById('app') ?? document.body).appendChild(el);
  }
  return el;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Stack of open dialogs so Escape / trap only apply to the top-most one. */
const stack: HTMLElement[] = [];

/**
 * Traps focus inside `ref` while `open`, closes on Escape, restores focus on close.
 * Initial focus: [data-autofocus] → first focusable → the dialog itself.
 */
export function useDialog(open: boolean, onClose: (() => void) | undefined, opts: { closeOnEsc?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    stack.push(el);
    const t = setTimeout(() => {
      const auto = el.querySelector<HTMLElement>('[data-autofocus]');
      (auto ?? focusables(el)[0] ?? el).focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === 'Escape' && opts.closeOnEsc !== false) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        const items = focusables(el);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(el);
      if (i >= 0) stack.splice(i, 1);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}

export function dialogOpenCount() {
  return stack.length;
}
