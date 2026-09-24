import { ICONS, type IconName } from './icons';

export interface IconProps {
  name: IconName;
  size?: number | string;
  class?: string;
  /** Accessible label. Omit for decorative icons (aria-hidden). */
  label?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, class: cls, label, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      class={`icon ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
