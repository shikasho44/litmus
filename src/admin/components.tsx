/** Shared building blocks for the admin console (utilitarian, token-styled). */
import { Fragment, type ComponentChildren, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { copyText } from './format';

export const ANSWER_META: Record<string, { jp: string; en: string; tone: string }> = {
  yes: { jp: 'はい', en: 'YES', tone: 'yes' },
  no: { jp: 'いいえ', en: 'NO', tone: 'no' },
  partial: { jp: '一部そう', en: 'PARTIAL', tone: 'partial' },
  irrelevant: { jp: '関係ない', en: 'IRRELEVANT', tone: 'irrelevant' },
  cannot: { jp: '答えられない', en: 'CLASSIFIED', tone: 'cannot' },
  vague: { jp: '具体的に', en: 'REPHRASE', tone: 'vague' },
};

export function AnswerChip({ cls, compact }: { cls: string; compact?: boolean }) {
  const m = ANSWER_META[cls] ?? { jp: cls, en: cls.toUpperCase(), tone: 'vague' };
  return (
    <span class={`adm-ans adm-ans--${m.tone}`} title={`${m.jp} (${cls})`}>
      {compact ? m.en : <>{m.en}<small>{m.jp}</small></>}
    </span>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'violet' | 'amber';
export function Badge({ tone = 'mute', children, title }: { tone?: Tone; children: ComponentChildren; title?: string }) {
  return (
    <span class={`adm-badge adm-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Card({
  title,
  en,
  actions,
  children,
  class: cls,
  pad = true,
}: {
  title?: ComponentChildren;
  en?: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
  pad?: boolean;
}) {
  return (
    <section class={`adm-card ${cls ?? ''}`}>
      {(title || en || actions) && (
        <header class="adm-card__head">
          <div class="adm-card__title">
            {en && <span class="adm-kicker">{en}</span>}
            {title && <h3>{title}</h3>}
          </div>
          {actions && <div class="adm-card__actions">{actions}</div>}
        </header>
      )}
      <div class={pad ? 'adm-card__body' : 'adm-card__body adm-card__body--flush'}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: Tone }) {
  return (
    <div class={`adm-stat ${tone ? `adm-stat--${tone}` : ''}`}>
      <span class="adm-stat__label">{label}</span>
      <span class="adm-stat__value">{value}</span>
      {sub !== undefined && <span class="adm-stat__sub">{sub}</span>}
    </div>
  );
}

/**
 * A file path as code that wraps at the separators (a <wbr> after every "/" or "\") instead of
 * mid-word, so a narrow screen never leaves one stray letter on its own line.
 */
export function PathText({ path }: { path: string }) {
  const parts = path.split(/(?<=[/\\])/);
  return (
    <code class="adm-path" title={path}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </code>
  );
}

export function KV({ rows }: { rows: [ComponentChildren, ComponentChildren][] }) {
  return (
    <dl class="adm-kv">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Btn({
  children,
  icon,
  variant = 'ghost',
  size,
  ...rest
}: { children?: ComponentChildren; icon?: IconName; variant?: 'primary' | 'ghost' | 'danger' | 'plain'; size?: 'sm' } & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size'>) {
  return (
    <button type="button" {...rest} class={`adm-btn adm-btn--${variant} ${size ? `adm-btn--${size}` : ''} ${(rest.class as string) ?? ''}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function CopyBtn({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [done, setDone] = useState<'' | 'ok' | 'ng'>('');
  return (
    <Btn
      size="sm"
      icon={done === 'ok' ? 'check' : 'tag'}
      onClick={async () => {
        const ok = await copyText(text);
        setDone(ok ? 'ok' : 'ng');
        setTimeout(() => setDone(''), 1400);
      }}
    >
      {done === 'ok' ? 'コピーしました' : done === 'ng' ? 'コピー失敗' : label}
    </Btn>
  );
}

export function Json({ value, open = false, label = 'JSON', maxHeight }: { value: unknown; open?: boolean; label?: string; maxHeight?: number }) {
  let text: string;
  try {
    text = value === undefined ? 'undefined' : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <details class="adm-json" open={open}>
      <summary>
        <span>{label}</span>
        <span class="adm-json__size">{text.length.toLocaleString()} chars</span>
      </summary>
      <div class="adm-json__tools">
        <CopyBtn text={text} />
      </div>
      <pre style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}>{text}</pre>
    </details>
  );
}

export function Pre({ text, label, open = true }: { text: string | undefined; label: string; open?: boolean }) {
  if (!text) return null;
  return (
    <details class="adm-json" open={open}>
      <summary>
        <span>{label}</span>
        <span class="adm-json__size">{text.length.toLocaleString()} chars</span>
      </summary>
      <div class="adm-json__tools">
        <CopyBtn text={text} />
      </div>
      <pre class="adm-pre-wrap">{text}</pre>
    </details>
  );
}

export function Empty({ children, icon = 'info' }: { children: ComponentChildren; icon?: IconName }) {
  return (
    <div class="adm-empty">
      <Icon name={icon} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ children }: { children: ComponentChildren }) {
  return (
    <div class="adm-error" role="alert">
      <Icon name="cross" size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Chips({ items, max = 999, tone }: { items: string[]; max?: number; tone?: Tone }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, max);
  return (
    <span class="adm-chips">
      {shown.map((t, i) => (
        <span key={i} class={`adm-chip ${tone ? `adm-chip--${tone}` : ''}`}>
          {t}
        </span>
      ))}
      {items.length > max && (
        <button type="button" class="adm-chip adm-chip--more" onClick={() => setAll(!all)}>
          {all ? '閉じる' : `+${items.length - max}`}
        </button>
      )}
    </span>
  );
}

/** Horizontal meter 0..1 (optionally with a threshold tick). */
export function Meter({ value, tone = 'ok', threshold, label }: { value: number; tone?: Tone; threshold?: number; label?: string }) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <span class={`adm-meter adm-meter--${tone}`} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={v} aria-label={label}>
      <span class="adm-meter__fill" style={{ width: `${v * 100}%` }} />
      {threshold !== undefined && <span class="adm-meter__tick" style={{ left: `${threshold * 100}%` }} />}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ComponentChildren }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="adm-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} class={o.id === value ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Labelled control. `group` renders a div[role=group] (several controls, or a hint with its own label). */
export function Field({ label, children, hint, grow, group }: { label: string; children: ComponentChildren; hint?: ComponentChildren; grow?: boolean; group?: boolean }) {
  const cls = `adm-field ${grow ? 'adm-field--grow' : ''}`;
  const inner = (
    <>
      <span class="adm-field__label">{label}</span>
      {children}
      {hint && <span class="adm-field__hint">{hint}</span>}
    </>
  );
  return group ? (
    <div class={cls} role="group" aria-label={label}>
      {inner}
    </div>
  ) : (
    <label class={cls}>{inner}</label>
  );
}
