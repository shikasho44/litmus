import { useState } from 'preact/hooks';
import { audio } from '../audio';
import './controls.css';

let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  format = (v: number) => `${Math.round(v * 100)}`,
  disabled,
  id,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
  id?: string;
}) {
  const [autoId] = useState(() => nextId('slider'));
  const inputId = id ?? autoId;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div class={`ctl ctl--slider ${disabled ? 'is-disabled' : ''}`}>
      <label class="ctl__label" for={inputId}>
        {label}
      </label>
      <div class="slider">
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ '--pct': `${pct}%` }}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          onChange={() => audio.sfx('toggle')}
        />
        <output class="slider__out" for={inputId}>
          {format(value)}
        </output>
      </div>
    </div>
  );
}

export function Switch({ label, checked, onChange, description, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; id?: string }) {
  const [autoId] = useState(() => nextId('switch'));
  const sid = id ?? autoId;
  return (
    <div class="ctl ctl--switch">
      <div class="ctl__text">
        <span class="ctl__label" id={`${sid}-l`}>
          {label}
        </span>
        {description && (
          <span class="ctl__desc" id={`${sid}-d`}>
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        id={sid}
        class={`switch ${checked ? 'is-on' : ''}`}
        aria-checked={checked}
        aria-labelledby={`${sid}-l`}
        aria-describedby={description ? `${sid}-d` : undefined}
        onClick={() => {
          audio.sfx('toggle');
          onChange(!checked);
        }}
      >
        <span class="switch__track" aria-hidden="true">
          <span class="switch__on">ON</span>
          <span class="switch__off">OFF</span>
          <span class="switch__knob" />
        </span>
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  description,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; sub?: string }[];
  onChange: (v: T) => void;
  description?: string;
}) {
  const [gid] = useState(() => nextId('seg'));
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: KeyboardEvent) => {
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (idx + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (idx - 1 + options.length) % options.length;
    if (n < 0) return;
    e.preventDefault();
    audio.sfx('toggle');
    onChange(options[n].value);
    requestAnimationFrame(() => document.getElementById(`${gid}-${n}`)?.focus());
  };
  return (
    <div class="ctl ctl--seg">
      <div class="ctl__text">
        <span class="ctl__label" id={`${gid}-l`}>
          {label}
        </span>
        {description && <span class="ctl__desc">{description}</span>}
      </div>
      <div class="seg" role="radiogroup" aria-labelledby={`${gid}-l`} onKeyDown={(e) => onKey(e as unknown as KeyboardEvent)}>
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              type="button"
              key={String(o.value)}
              id={`${gid}-${i}`}
              role="radio"
              aria-checked={on}
              tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
              class={`seg__opt ${on ? 'is-on' : ''}`}
              onClick={() => {
                if (!on) audio.sfx('toggle');
                onChange(o.value);
              }}
            >
              <span>{o.label}</span>
              {o.sub && <span class="seg__sub">{o.sub}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
