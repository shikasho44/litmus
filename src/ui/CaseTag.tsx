import type { CaseSummary } from '../../shared/api';
import type { CaseStatus, FirstClear, Rank, RestoredIdentity } from '../state/types';
import { DIFFICULTY_META } from '../features/difficulty/meta';
import { formatClearTime } from '../state/hooks';
import { CASE_STATUS_LABEL } from '../state/types';
import { audio } from '../audio';
import { PROTO_I005 } from '../config/proto';
import { HookLine } from '../features/i005/bits';
import { Icon } from './Icon';
import './cards.css';

export interface CaseTagProps {
  summary: CaseSummary;
  status: CaseStatus;
  bestRank?: Rank;
  /** Best 獲得度数 of the case (名探偵度数), shown under the BEST stamp. */
  bestPoints?: number;
  onOpen?: () => void;
  /** Secondary action (e.g. view record). */
  onSecondary?: () => void;
  secondaryLabel?: string;
  index?: number;
  onFocusCase?: () => void;
  /** The victim's name once the identity ceremony has played (solved / complete). */
  restored?: RestoredIdentity;
  /** The case's first clear (difficulty and clear time), when it was recorded. */
  firstClear?: Pick<FirstClear, 'difficulty' | 'clearMs'>;
}

/**
 * The summary always ends with the case's hook question. Split it off so the card can clamp
 * the set-up but never the question: 「…争った跡もない。——眠っているように見えた彼女は、…のか？」
 */
export function splitHook(summary: string): { body: string; hook: string | null } {
  const s = summary.trim();
  if (!/[？?]$/.test(s)) return { body: s, hook: null };
  const inner = s.slice(0, -1);
  const dash = inner.lastIndexOf('——');
  const dot = inner.lastIndexOf('。');
  if (dash > dot && dash > 0) return { body: s.slice(0, dash).trim(), hook: s.slice(dash + 2).trim() };
  if (dot > 0) return { body: s.slice(0, dot + 1).trim(), hook: s.slice(dot + 1).trim() };
  return { body: '', hook: s };
}

const ACTION: Record<CaseStatus, { jp: string; en: string }> = {
  new: { jp: '解剖を始める', en: 'OPEN FILE' },
  active: { jp: '捜査を再開する', en: 'RESUME' },
  solved: { jp: '続きを見る', en: 'CONTINUE' },
  complete: { jp: 'もう一度ひらく', en: 'REPLAY' },
};

/** Toe-tag case card for the 事件ファイル screen. */
export function CaseTag({ summary: c, status, bestRank, bestPoints, onOpen, onSecondary, secondaryLabel, index = 0, onFocusCase, restored, firstClear }: CaseTagProps) {
  const num = String(c.number).padStart(2, '0');
  const { body, hook } = splitHook(c.summary);
  const identified = !!restored && (status === 'solved' || status === 'complete');
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
          {identified ? (
            <span class="tag__meta-mono tag__meta-mono--identified">
              <s class="tag__was" aria-label={`旧称 ${c.codename}`}>
                {c.codename}
              </s>
              <span class="tag__name">{restored!.name}</span>
              <span class="tag__identified">IDENTIFIED</span>
            </span>
          ) : (
            <span class="tag__meta-mono">
              <span>{c.codename}</span>
              <span>UNIDENTIFIED</span>
            </span>
          )}
        </div>
        <h3 class="tag__title" id={titleId}>
          {c.title}
        </h3>
        <p class="tag__title-en">{c.titleEn}</p>
        {PROTO_I005 && <HookLine text={c.hook} class="hookline--tag" />}
        <div class="tag__summary">
          {body && <p class="tag__summary-body">{body}</p>}
          {hook && <p class="tag__hook">{hook}</p>}
        </div>
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
          {bestRank && (
            <div class="tag__facts-rank">
              <dt class="sr-only">最高ランク</dt>
              <dd class="tag__rank" aria-label={`最高ランク ${bestRank}${typeof bestPoints === 'number' ? `、最高度数 ${bestPoints}` : ''}`}>
                <span class="tag__rank-label" aria-hidden="true">
                  BEST
                </span>
                <span class="tag__rank-value">{bestRank}</span>
                {typeof bestPoints === 'number' && (
                  <span class="tag__rank-pts" aria-hidden="true">
                    +{bestPoints}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
        {firstClear && (
          <p class="tag__first" aria-label={`初回の解決：${DIFFICULTY_META[firstClear.difficulty].jp}、${formatClearTime(firstClear.clearMs)}`}>
            <span class="tag__first-k">初見</span>
            <span>
              {DIFFICULTY_META[firstClear.difficulty].jp}・{formatClearTime(firstClear.clearMs)}
            </span>
          </p>
        )}
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
      </div>
    </article>
  );
}
