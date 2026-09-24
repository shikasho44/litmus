import type { ComponentChildren } from 'preact';
import './button.css';

/**
 * Lightweight tooltip: wraps children in an inline wrapper carrying [data-tip].
 * Shown on hover (fine pointers) and keyboard focus within. Touch devices rely on labels.
 * For IconButton, the tooltip is built in (prop `tooltip`).
 */
export function Tooltip({ label, side = 'top', children, class: cls }: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ComponentChildren; class?: string }) {
  return (
    <span class={`tip-wrap ${cls ?? ''}`} data-tip={label} data-tip-side={side} style={{ display: 'inline-flex' }}>
      {children}
    </span>
  );
}
