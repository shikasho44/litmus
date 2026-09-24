import type { CaseSummary } from '../../shared/api';
import type { CaseStatus, Rank } from '../state/types';
import { CASE_STATUS_LABEL } from '../state/types';
import { audio } from '../audio';
import { Icon } from './Icon';
import './cards.css';

export interface CaseTagProps {
  summary: CaseSummary;
  status: CaseStatus;
  bestRank?: Rank;
  onOpen?: () => void;
  /** Secondary action (e.g. view record). */
  onSecondary?: () => void;
  secondaryLabel?: string;
  index?: number;
  onFocusCase?: () => void;
}

const ACTION: Record<CaseStatus, { jp: string; en: string }> = {
  new: { jp: '解剖を始める', en: 'OPEN FILE' },
  active: { jp: '捜査を再開する', en: 'RESUME' },
  solved: { jp: '続きを見る', en: 'CONTINUE' },
  complete: { jp: 'もう一度ひらく', en: 'REPLAY' },
};

/** Toe-tag case card for the 事件ファイル screen. */
export function CaseTag({ summary: c, status, bestRank, onOpen, onSecondary, secondaryLabel, index = 0, onFocusCase }: CaseTagProps) {
  const num = String(c.number).padStart(2, '0');
  const tilt = [-2.2, 1.6, -1.1, 2][index % 4];
  const action = ACTION[status];
  const titleId = `case-${c.id}-title`;
  return (
    <article
      class={`tag tag--${status}`}
      style={{ '--tag-accent': c.accent || 'var(--formalin)', '--tag-tilt': `${tilt}deg`, '--tag-delay': `${index * 90}ms` }}
      aria-labelledby={titleId}
      onPointerEnter={() => onFocusCase?.()}
      onFocusIn={() => onFocusCase?.()}
    >
      <span class="tag__string" aria-hidden="true" />
      <div class="tag__card">
        <span class="tag__hole" aria-hidden="true" />
        <div class="tag__top">
          <span class="tag__case">
            <span class="tag__case-en">CASE</span>
            <span class="tag__num">{num}</span>
          </span>
          <span class="tag__meta-mono">
            <span>{c.codename}</span>
            <span>UNIDENTIFIED</span>
          </span>
        </div>
        <h3 class="tag__title" id={titleId}>
          {c.title}
        </h3>
        <p class="tag__title-en">{c.titleEn}</p>
        <p class="tag__summary">{c.summary}</p>
        <dl class="tag__facts">
          <div>
            <dt>難易度</dt>
            <dd>
              <span class="tag__pips" aria-label={`難易度 ${c.difficulty} / 3`}>
                {[1, 2, 3].map((i) => (
                  <span key={i} class={`tag__pip ${c.difficulty >= i ? 'is-on' : ''}`} aria-hidden="true" />
                ))}
              </span>
            </dd>
          </div>
          <div>
            <dt>分野</dt>
            <dd class="tag__cats">
              {c.categories.map((k) => (
                <span key={k} class="tag__cat">
                  {k}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>目安</dt>
            <dd class="t-mono">約{c.estimatedMinutes}分</dd>
          </div>
        </dl>
        {c.contentWarning && (
          <p class="tag__warning">
            <Icon name="info" size={14} />
            <span>{c.contentWarning}</span>
          </p>
        )}
        <div class="tag__actions">
          <button
            type="button"
            class="tag__open"
            onPointerEnter={(e) => e.pointerType === 'mouse' && audio.sfx('hover')}
            onClick={() => {
              audio.sfx('confirm');
              onOpen?.();
            }}
            aria-describedby={titleId}
          >
            <span class="tag__open-jp">{action.jp}</span>
            <span class="tag__open-en">{action.en}</span>
            <Icon name="chevronRight" size={18} />
          </button>
          {onSecondary && (
            <button type="button" class="tag__secondary" onClick={() => (audio.sfx('toggle'), onSecondary())}>
              {secondaryLabel ?? '記録'}
            </button>
          )}
        </div>
        <div class={`tag__status tag__status--${status}`} aria-label={`状態：${CASE_STATUS_LABEL[status]}`}>
          <span>{CASE_STATUS_LABEL[status]}</span>
        </div>
        {bestRank && (
          <div class="tag__rank" aria-label={`最高ランク ${bestRank}`}>
            <span class="tag__rank-label">BEST</span>
            <span class="tag__rank-value">{bestRank}</span>
          </div>
        )}
      </div>
    </article>
  );
}
