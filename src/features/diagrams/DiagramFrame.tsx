import type { ComponentChildren, Ref } from 'preact';

const KIND_EN: Record<string, string> = { levels: 'FIG', ecg: 'FIG', ratio: 'FIG' };

/** Shared figure chrome: specimen-label header, body, source line. */
export function DiagramFrame({
  frameRef,
  kind,
  title,
  en,
  source,
  index,
  seen,
  note,
  children,
}: {
  frameRef?: Ref<HTMLElement>;
  kind: 'levels' | 'ecg' | 'ratio';
  title: string;
  en: string;
  source: string;
  index?: number;
  seen: boolean;
  note?: string;
  children: ComponentChildren;
}) {
  const fig = index !== undefined ? `${KIND_EN[kind]}.${String(index + 1).padStart(2, '0')}` : KIND_EN[kind];
  return (
    <figure ref={frameRef} class={`dg dg--${kind} ${seen ? 'is-in' : ''}`}>
      <header class="dg__head">
        <span class="dg__fig t-mono">{fig}</span>
        <span class="dg__en">{en}</span>
        {note && <span class="dg__note t-mono">{note}</span>}
      </header>
      <h4 class="dg__title">{title}</h4>
      <div class="dg__body">{children}</div>
      <figcaption class="dg__source">
        <span class="dg__source-label">出典</span>
        <span>{source}</span>
      </figcaption>
    </figure>
  );
}
