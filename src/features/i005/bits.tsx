/**
 * PROTOTYPE I-005 — the small pieces shown with `?proto=i005` (src/config/proto.ts):
 *   ScienceMark  「SCIENCE」 on the サイエンスヒント's finding card (PublicFact.science)
 *   HookLine     矛盾の一文 under the case title (CaseSummary.hook)
 *   ScienceAside 余話 after the science explanation (science.aside), with the sample frame of the
 *                future 「先生のひとこと」 slot when the case asks for it (never any words of his)
 */
import type { Case } from '../../../shared/case-schema';
import { Icon } from '../../ui/Icon';
import './i005.css';

export const SCIENCE_MARK_TIP = '知っていれば近道になる所見';

export function ScienceMark({ compact }: { compact?: boolean }) {
  return (
    <span class={`sci-mark ${compact ? 'sci-mark--compact' : ''}`} title={SCIENCE_MARK_TIP} aria-label={`SCIENCE：${SCIENCE_MARK_TIP}`} data-science-mark>
      <Icon name="science" size={compact ? 10 : 11} />
      <span aria-hidden="true">SCIENCE</span>
    </span>
  );
}

export function HookLine({ text, class: cls }: { text?: string; class?: string }) {
  if (!text) return null;
  return (
    <p class={`hookline ${cls ?? ''}`} data-hookline>
      {text}
    </p>
  );
}

/** The sample frame of the supervisor's comment slot. Text is fixed: we never write his words. */
export const SUPERVISOR_PLACEHOLDER = '（見本）ここに、くられ先生のひとことが入ります';

const SOURCE_TYPE: Record<string, string> = {
  government: '公的機関',
  academic: '学術論文',
  medical: '医療情報',
  society: '学会・団体',
  university: '大学',
  other: 'その他',
};

type Aside = NonNullable<Case['science']['aside']>;

export function ScienceAside({ aside }: { aside: Aside }) {
  return (
    <section class="sci-aside" id="sci-aside" aria-labelledby="sci-aside-h" data-science-aside>
      <header class="sci-aside__head">
        <span class="sci-aside__k t-mono" aria-hidden="true">
          ASIDE
        </span>
        <h2 class="sci-aside__h" id="sci-aside-h">
          <span class="sci-aside__jp">余話</span>
          <span class="sci-aside__title">{aside.title}</span>
        </h2>
      </header>
      <div class="sci-aside__text">
        {aside.text
          .split(/\n+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t, i) => (
            <p key={i}>{t}</p>
          ))}
      </div>
      {aside.supervisorNote === 'placeholder' && (
        <div class="sci-aside__sensei" role="note" aria-label="先生のひとこと（見本）" data-supervisor-placeholder>
          <span class="sci-aside__sensei-k">
            <Icon name="whisper" size={14} />
            先生のひとこと
          </span>
          <p class="sci-aside__sensei-t">{SUPERVISOR_PLACEHOLDER}</p>
        </div>
      )}
      <details class="sci-aside__src">
        <summary>この余話の出典（{aside.sources.length}件）</summary>
        <ol class="sci-aside__list">
          {aside.sources.map((s) => (
            <li key={s.id}>
              <span class="sci-aside__src-meta">
                <span class="sci-aside__src-type">{SOURCE_TYPE[s.type] ?? s.type}</span>
                {s.organization}
                {s.publicationDate ? `・${s.publicationDate}` : ''}
              </span>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
                <Icon name="external" size={12} />
                <span class="sr-only">（新しいタブで開きます）</span>
              </a>
              <span class="sci-aside__src-sup">{s.supports}</span>
              <span class="sci-aside__src-acc t-mono">閲覧日 {s.accessedDate}</span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
