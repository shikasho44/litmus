import type { PublicFact } from '../../shared/api';
import { audio } from '../audio';
import { Icon } from './Icon';
import { resolveIcon } from './icons';
import './cards.css';

export interface EvidenceCardProps {
  fact: PublicFact;
  isNew?: boolean;
  selected?: boolean;
  /** Makes the card a button. */
  onSelect?: (fact: PublicFact) => void;
  compact?: boolean;
  disabled?: boolean;
  /** Used for a subtle deterministic tilt. */
  index?: number;
  class?: string;
}

export const importanceLabel = (n: number) => (n >= 3 ? '核心' : n === 2 ? '重要' : n === 1 ? '補足' : '雰囲気');

/** Title used on the card: cardTitle, else the first clause of the text. */
export function factTitle(f: PublicFact): string {
  if (f.cardTitle) return f.cardTitle;
  const cut = f.text.split(/[。、]/)[0];
  return cut.length > 16 ? `${cut.slice(0, 15)}…` : cut;
}

/** 所見カード — specimen-label look. */
export function EvidenceCard({ fact, isNew, selected, onSelect, compact, disabled, index = 0, class: cls }: EvidenceCardProps) {
  const icon = resolveIcon(fact.icon, fact.category);
  const core = fact.importance >= 3;
  const tilt = compact ? 0 : ((index * 37) % 5) * 0.45 - 0.9;
  const body = (
    <>
      <span class="ev__pin" aria-hidden="true" />
      <span class="ev__head">
        <span class="ev__cat">
          <Icon name={icon} size={compact ? 14 : 16} />
          <span>{fact.category}</span>
        </span>
        <span class="ev__id">{fact.id}</span>
      </span>
      <span class="ev__title">{factTitle(fact)}</span>
      {!compact && <span class="ev__text">{fact.text}</span>}
      <span class="ev__foot">
        <span class="ev__imp" aria-label={`重要度：${importanceLabel(fact.importance)}`}>
          {[1, 2, 3].map((i) => (
            <span key={i} class={`ev__pip ${fact.importance >= i ? 'is-on' : ''}`} />
          ))}
          <span class="ev__imp-label">{importanceLabel(fact.importance)}</span>
        </span>
        {core && <span class="ev__core">CORE</span>}
      </span>
      {isNew && <span class="ev__new">NEW</span>}
    </>
  );
  const className = `ev ${compact ? 'ev--compact' : ''} ${core ? 'ev--core' : fact.importance >= 2 ? 'ev--key' : ''} ${selected ? 'is-selected' : ''} ${cls ?? ''}`;
  if (onSelect) {
    return (
      <button
        type="button"
        class={className}
        style={{ '--ev-tilt': `${tilt}deg` }}
        aria-pressed={selected}
        disabled={disabled}
        onPointerEnter={(e) => e.pointerType === 'mouse' && audio.sfx('hover')}
        onClick={() => {
          audio.sfx('page');
          onSelect(fact);
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <article class={className} style={{ '--ev-tilt': `${tilt}deg` }}>
      {body}
    </article>
  );
}
