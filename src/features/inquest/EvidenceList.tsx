/**
 * 所見の弾倉 — the evidence the player can fire in ノイズ・ブレイク.
 * Category filter + a scannable list of "bullets". Used in the PC magazine column and in the
 * phone bottom drawer. Keyboard: the rows are plain buttons (Tab / Enter); E cycles globally.
 */
import { useMemo, useState } from 'preact/hooks';
import type { PublicFact } from '../../../shared/api';
import { FACT_CATEGORIES, type FactCategory } from '../../../shared/constants';
import { audio } from '../../audio';
import { Icon } from '../../ui/Icon';
import { CATEGORY_ICON, resolveIcon } from '../../ui/icons';
import { factTitle, importanceLabel } from '../../ui/EvidenceCard';

export interface EvidenceListProps {
  facts: PublicFact[];
  selected: string | null;
  fresh?: Set<string>;
  onPick: (id: string) => void;
  /** Filter state can be lifted so E-cycling follows the visible list. */
  filter?: FactCategory | 'all';
  onFilter?: (f: FactCategory | 'all') => void;
  disabled?: boolean;
  /** Larger rows for touch. */
  touch?: boolean;
}

export function EvidenceList({ facts, selected, fresh, onPick, filter: fProp, onFilter, disabled, touch }: EvidenceListProps) {
  const [fLocal, setFLocal] = useState<FactCategory | 'all'>('all');
  const filter = fProp ?? fLocal;
  const setFilter = (f: FactCategory | 'all') => (onFilter ? onFilter(f) : setFLocal(f));
  const counts = useMemo(() => {
    const m = new Map<FactCategory, number>();
    for (const f of facts) m.set(f.category, (m.get(f.category) ?? 0) + 1);
    return m;
  }, [facts]);
  const shown = filter === 'all' ? facts : facts.filter((f) => f.category === filter);

  return (
    <div class={`evl ${touch ? 'evl--touch' : ''}`}>
      <div class="evl__filters" role="toolbar" aria-label="所見の分類で絞り込む">
        <button
          type="button"
          class={`evl__chip ${filter === 'all' ? 'is-on' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => {
            audio.sfx('toggle');
            setFilter('all');
          }}
        >
          すべて<span class="evl__count">{facts.length}</span>
        </button>
        {FACT_CATEGORIES.filter((c) => counts.has(c)).map((c) => (
          <button
            type="button"
            key={c}
            class={`evl__chip evl__chip--icon ${filter === c ? 'is-on' : ''}`}
            aria-pressed={filter === c}
            aria-label={`${c}（${counts.get(c)}）`}
            data-tip={c}
            data-tip-side="bottom"
            onClick={() => {
              audio.sfx('toggle');
              setFilter(filter === c ? 'all' : c);
            }}
          >
            <Icon name={CATEGORY_ICON[c]} size={15} />
            <span class="evl__count">{counts.get(c)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p class="evl__empty">所見がありません。ホルマに泣きつくこともできます。</p>
      ) : (
        <ul class="evl__list" aria-label="所見の一覧">
          {shown.map((f, i) => {
            const on = selected === f.id;
            return (
              <li key={f.id} style={{ '--i': i }}>
                <button
                  type="button"
                  class={`evl__row imp-${Math.min(3, f.importance)} ${on ? 'is-on' : ''} ${fresh?.has(f.id) ? 'is-fresh' : ''}`}
                  data-fact-id={f.id}
                  aria-pressed={on}
                  aria-label={`${factTitle(f)}（${f.category}・${importanceLabel(f.importance)}）${on ? '：装填中' : ''}`}
                  disabled={disabled}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && audio.sfx('hover')}
                  onClick={() => {
                    audio.sfx('page');
                    onPick(f.id);
                  }}
                >
                  <span class="evl__icon" aria-hidden="true">
                    <Icon name={resolveIcon(f.icon, f.category)} size={16} />
                  </span>
                  <span class="evl__title">{factTitle(f)}</span>
                  <span class="evl__pips" aria-hidden="true">
                    {[1, 2, 3].map((k) => (
                      <i key={k} class={f.importance >= k ? 'is-on' : ''} />
                    ))}
                  </span>
                  {fresh?.has(f.id) && <span class="evl__new">NEW</span>}
                  {on && <span class="evl__loaded" aria-hidden="true">LOADED</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The loaded bullet shown as a specimen card with its full text. */
export function LoadedCard({ fact, compact }: { fact: PublicFact | null; compact?: boolean }) {
  if (!fact) {
    return (
      <div class={`loaded is-empty ${compact ? 'loaded--compact' : ''}`}>
        <span class="loaded__kicker">EMPTY CHAMBER</span>
        <span class="loaded__title">所見を選んで装填</span>
        {!compact && <span class="loaded__text">発言の矛盾を示せる所見を、弾として選んでください。</span>}
      </div>
    );
  }
  return (
    <div class={`loaded ${compact ? 'loaded--compact' : ''} imp-${Math.min(3, fact.importance)}`} data-loaded-fact={fact.id}>
      <span class="loaded__kicker">
        <Icon name={resolveIcon(fact.icon, fact.category)} size={13} />
        {fact.category} · 装填中
      </span>
      <span class="loaded__title">{factTitle(fact)}</span>
      {!compact && <span class="loaded__text">{fact.text}</span>}
    </div>
  );
}
