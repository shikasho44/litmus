import type { JSX } from 'preact';
import './fxui.css';

/**
 * Text with an occasional RGB-split slice glitch (CSS only; disabled with reduced motion).
 * The real text is in the DOM once; the glitch copies are pseudo-elements (aria-safe).
 */
export function GlitchText({
  text,
  as: Tag = 'span',
  class: cls,
  strength = 'subtle',
  period = 6,
}: {
  text: string;
  as?: keyof JSX.IntrinsicElements;
  class?: string;
  strength?: 'subtle' | 'strong';
  /** seconds between glitch bursts */
  period?: number;
}) {
  const T = Tag as any;
  return (
    <T class={`glitch glitch--${strength} ${cls ?? ''}`} data-text={text} style={{ '--glitch-period': `${period}s` }}>
      {text}
    </T>
  );
}

/** Speed lines overlay (radial or horizontal). Purely decorative. */
export function SpeedLines({ kind = 'radial', color = 'rgba(242,239,230,0.55)', class: cls }: { kind?: 'radial' | 'horizontal'; color?: string; class?: string }) {
  return <div class={`speedlines speedlines--${kind} ${cls ?? ''}`} style={{ '--sl-color': color }} aria-hidden="true" />;
}
