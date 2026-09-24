import type { ComponentChildren, JSX } from 'preact';
import { audio, type SfxName } from '../audio';
import { Icon } from './Icon';
import type { IconName } from './icons';
import './button.css';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'big-cta' | 'quiet';

export interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'size'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  /** Small English kicker shown with the label (Anton). */
  en?: string;
  /** Sound on click (false = silent). Default: 'confirm' ('cancel' for ghost buttons marked cancel). */
  sfx?: SfxName | false;
  /** Hover tick. Default true. */
  hoverSfx?: boolean;
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children?: ComponentChildren;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  en,
  sfx = 'confirm',
  hoverSfx = true,
  block,
  class: cls,
  className,
  children,
  onClick,
  onPointerEnter,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      class={`btn btn--${variant} btn--${size} ${block ? 'btn--block' : ''} ${cls ?? ''} ${className ?? ''}`}
      onPointerEnter={(e) => {
        if (hoverSfx && e.pointerType === 'mouse' && !rest.disabled) audio.sfx('hover');
        onPointerEnter?.(e);
      }}
      onClick={(e) => {
        if (sfx) audio.sfx(sfx);
        onClick?.(e);
      }}
      {...rest}
    >
      <span class="btn__bg" aria-hidden="true" />
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20} class="btn__icon" />}
      <span class="btn__label">
        <span class="btn__jp">{children}</span>
        {en && <span class="btn__en">{en}</span>}
      </span>
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 16 : 20} class="btn__icon btn__icon--right" />}
    </button>
  );
}

export interface IconButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'label'> {
  icon: IconName;
  /** Required accessible name; also shown as a tooltip. */
  label: string;
  variant?: 'ghost' | 'solid' | 'plain';
  size?: 'sm' | 'md' | 'lg';
  sfx?: SfxName | false;
  pressed?: boolean;
  badge?: string | number;
  disabled?: boolean;
  tooltip?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  sfx = 'toggle',
  pressed,
  badge,
  tooltip = true,
  tooltipSide = 'bottom',
  class: cls,
  onClick,
  ...rest
}: IconButtonProps) {
  const px = size === 'sm' ? 16 : size === 'lg' ? 26 : 20;
  return (
    <button
      type="button"
      class={`ibtn ibtn--${variant} ibtn--${size} ${cls ?? ''}`}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-tip={tooltip ? label : undefined}
      data-tip-side={tooltipSide}
      onPointerEnter={(e) => e.pointerType === 'mouse' && audio.sfx('hover')}
      onClick={(e) => {
        if (sfx) audio.sfx(sfx);
        onClick?.(e);
      }}
      {...rest}
    >
      <Icon name={icon} size={px} />
      {badge !== undefined && badge !== '' && <span class="ibtn__badge">{badge}</span>}
    </button>
  );
}
