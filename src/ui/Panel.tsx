import type { ComponentChildren, JSX } from 'preact';
import { audio } from '../audio';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './panel.css';

export interface PanelProps extends Omit<JSX.HTMLAttributes<HTMLElement>, 'title'> {
  title?: ComponentChildren;
  en?: string;
  /** Mono tag at the right of the header, e.g. "No.012". */
  tag?: string;
  tone?: 'ink' | 'bone' | 'glass';
  accent?: string;
  actions?: ComponentChildren;
  children?: ComponentChildren;
  as?: 'section' | 'div' | 'aside' | 'article';
}

/** Surface with a specimen-label header. */
export function Panel({ title, en, tag, tone = 'ink', accent, actions, children, as = 'section', class: cls, style, ...rest }: PanelProps) {
  const Tag = as;
  return (
    <Tag class={`panel panel--${tone} ${cls ?? ''}`} style={{ ...(accent ? { '--p-accent': accent } : {}), ...(style as object) }} {...(rest as object)}>
      {(title || en || tag || actions) && (
        <header class="panel__head">
          <div class="panel__titles">
            {en && <span class="panel__en">{en}</span>}
            {title && <h3 class="panel__title">{title}</h3>}
          </div>
          {tag && <span class="panel__tag">{tag}</span>}
          {actions && <div class="panel__actions">{actions}</div>}
        </header>
      )}
      <div class="panel__body">{children}</div>
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */
export interface TabItem {
  id: string;
  label: string;
  en?: string;
  icon?: IconName;
  badge?: number | string;
}

export interface TabsProps {
  /** Unique group name, links tabs to TabPanel ids. */
  group: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  class?: string;
  size?: 'sm' | 'md';
}

export const tabId = (group: string, id: string) => `tab-${group}-${id}`;
export const panelId = (group: string, id: string) => `tabpanel-${group}-${id}`;

/** Accessible tab list (roving tabindex, ←/→/Home/End). */
export function Tabs({ group, items, value, onChange, label, class: cls, size = 'md' }: TabsProps) {
  const move = (e: KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    audio.sfx('toggle');
    requestAnimationFrame(() => document.getElementById(tabId(group, items[next].id))?.focus());
  };
  return (
    <div class={`tabs tabs--${size} ${cls ?? ''}`} role="tablist" aria-label={label}>
      {items.map((it, i) => {
        const selected = it.id === value;
        return (
          <button
            type="button"
            key={it.id}
            id={tabId(group, it.id)}
            role="tab"
            class={`tab ${selected ? 'is-selected' : ''}`}
            aria-selected={selected}
            aria-controls={panelId(group, it.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) audio.sfx('toggle');
              onChange(it.id);
            }}
            onKeyDown={(e) => move(e as unknown as KeyboardEvent, i)}
          >
            {it.icon && <Icon name={it.icon} size={16} />}
            <span class="tab__label">{it.label}</span>
            {it.en && <span class="tab__en">{it.en}</span>}
            {it.badge !== undefined && it.badge !== '' && it.badge !== 0 && <span class="tab__badge">{it.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ group, id, value, children, class: cls }: { group: string; id: string; value: string; children?: ComponentChildren; class?: string }) {
  const hidden = id !== value;
  return (
    <div id={panelId(group, id)} role="tabpanel" aria-labelledby={tabId(group, id)} hidden={hidden} tabIndex={0} class={`tabpanel ${cls ?? ''}`}>
      {!hidden && children}
    </div>
  );
}
