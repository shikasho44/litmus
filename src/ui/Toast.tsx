import { signal } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { portalRoot } from './dialog';
import './toast.css';

export type ToastTone = 'info' | 'success' | 'warn' | 'error' | 'finding';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  icon?: IconName;
  leaving?: boolean;
}

const items = signal<ToastItem[]>([]);
let seq = 0;

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  warn: 'info',
  error: 'cross',
  finding: 'evidence',
};

/**
 * Show a toast. Returns a dismiss function.
 *   toast('セーブしました', { tone: 'success' })
 */
export function toast(message: string, opts: { tone?: ToastTone; icon?: IconName; duration?: number } = {}) {
  const id = ++seq;
  const item: ToastItem = { id, message, tone: opts.tone ?? 'info', icon: opts.icon };
  items.value = [...items.value.slice(-3), item];
  const dismiss = () => {
    items.value = items.value.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => (items.value = items.value.filter((t) => t.id !== id)), 260);
  };
  setTimeout(dismiss, opts.duration ?? 3200);
  return dismiss;
}

export function ToastHost() {
  return createPortal(
    <div class="toasts" role="status" aria-live="polite" aria-atomic="false">
      {items.value.map((t) => (
        <div key={t.id} class={`toast toast--${t.tone} ${t.leaving ? 'is-leaving' : ''}`}>
          <span class="toast__icon">
            <Icon name={t.icon ?? TONE_ICON[t.tone]} size={18} />
          </span>
          <span class="toast__msg">{t.message}</span>
        </div>
      ))}
    </div>,
    portalRoot(),
  );
}
