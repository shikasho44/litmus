/**
 * 捜査ノート (NOTEBOOK): 所見 (grouped by category, NEW badges) / 質問ログ (filter by answer
 * class, text search) / 科学メモ. Rendered as the PC side panel and inside the phone sheet.
 */
import { signal, type Signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AnswerClass } from '../../../shared/case-schema';
import { FACT_CATEGORIES } from '../../../shared/case-schema';
import type { PublicFact } from '../../../shared/api';
import { audio } from '../../audio';
import { useCaseProgress } from '../../state/hooks';
import { markFactsSeen } from '../../state/save';
import type { CaseProgress } from '../../state/types';
import { EvidenceCard } from '../../ui/EvidenceCard';
import { Icon } from '../../ui/Icon';
import { CATEGORY_ICON } from '../../ui/icons';
import { Tabs, TabPanel, type TabItem } from '../../ui/Panel';
import { Stamp, STAMP_META } from '../../ui/Stamp';
import './notebook.css';

export type NotebookTab = 'facts' | 'log' | 'memos';
/** Remembered across opens (module-level). */
export const notebookTab = signal<NotebookTab>('facts');

const EMPTY = new Set<string>();

/** Facts the player has not looked at yet (drives NEW badges and the button badge). */
export function unseenFacts(c: CaseProgress | undefined, arriving: Set<string> = EMPTY): string[] {
  if (!c) return [];
  const seen = new Set(c.seenFacts);
  return c.factOrder.filter((id) => !seen.has(id) && !arriving.has(id));
}

type LogFilter = 'all' | AnswerClass | 'hint';
const FILTERS: { id: LogFilter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'yes', label: 'はい' },
  { id: 'no', label: 'いいえ' },
  { id: 'partial', label: '一部' },
  { id: 'irrelevant', label: '関係ない' },
  { id: 'cannot', label: '答えられない' },
  { id: 'vague', label: '具体的に' },
  { id: 'hint', label: '囁き' },
];

interface LogRow {
  id: string;
  n: number;
  kind: 'answer' | 'hint';
  question: string;
  answerClass?: AnswerClass;
  line: string;
  unlocked: string[];
  level?: number;
  support?: boolean;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

function FactsPanel({ c, arriving, caseId, active }: { c: CaseProgress | undefined; arriving: Set<string>; caseId: string; active: boolean }) {
  const facts = (c?.factOrder ?? []).map((id) => c?.facts[id]).filter((f): f is PublicFact => !!f && !arriving.has(f.id));
  const seen = new Set(c?.seenFacts ?? []);
  const unseen = facts.filter((f) => !seen.has(f.id)).map((f) => f.id);
  const key = unseen.join(',');

  // Mark as seen a moment after they are displayed (so the NEW badge is noticed first).
  useEffect(() => {
    if (!active || !unseen.length) return;
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') markFactsSeen(caseId, unseen);
    }, 2600);
    return () => clearTimeout(t);
  }, [active, key]);

  if (!facts.length) {
    return <p class="nb-empty">まだ所見はありません。ホルマに質問して、手がかりを集めましょう。</p>;
  }
  const groups = FACT_CATEGORIES.map((cat) => ({ cat, list: facts.filter((f) => f.category === cat) })).filter((g) => g.list.length);
  const core = facts.filter((f) => f.importance >= 3).length;
  return (
    <div class="nb-facts">
      <p class="nb-summary t-mono">
        <span>
          所見 <b>{facts.length}</b>
        </span>
        <span>
          重要 <b>{facts.filter((f) => f.importance >= 2).length}</b>
        </span>
        <span class={core ? 'is-core' : ''}>
          核心 <b>{core}</b>
        </span>
      </p>
      {groups.map((g) => (
        <section class="nb-group" key={g.cat} aria-label={`${g.cat}（${g.list.length}）`}>
          <h3 class="nb-group__head">
            <Icon name={CATEGORY_ICON[g.cat]} size={15} />
            <span>{g.cat}</span>
            <span class="nb-group__count t-mono">{g.list.length}</span>
          </h3>
          <div class="nb-group__cards">
            {g.list.map((f, i) => (
              <EvidenceCard key={f.id} fact={f} isNew={!seen.has(f.id)} index={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LogPanel({ c }: { c: CaseProgress | undefined }) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const out: LogRow[] = [];
    let n = 0;
    for (const e of c?.log ?? []) {
      if (e.kind === 'question') n++;
      else if (e.kind === 'answer') out.push({ id: e.id, n, kind: 'answer', question: e.question, answerClass: e.answerClass, line: e.line, unlocked: e.unlocked, support: e.notice === 'support' });
      else if (e.kind === 'hint') out.push({ id: e.id, n, kind: 'hint', question: `ホルマの囁き ${e.level}`, line: e.text, unlocked: [], level: e.level });
    }
    return out.reverse();
  }, [c?.log]);
  const counts = useMemo(() => {
    const m = new Map<LogFilter, number>([['all', rows.length]]);
    for (const r of rows) {
      const k: LogFilter = r.kind === 'hint' ? 'hint' : r.answerClass!;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);
  const nq = norm(q);
  const shown = rows.filter((r) => (filter === 'all' || (filter === 'hint' ? r.kind === 'hint' : r.answerClass === filter)) && (!nq || norm(r.question + r.line).includes(nq)));

  return (
    <div class="nb-log">
      <div class="nb-log__tools">
        <label class="nb-search">
          <Icon name="search" size={16} />
          <span class="sr-only">質問ログを検索</span>
          <input type="search" value={q} placeholder="ことばで探す（例：換気）" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <div class="nb-filters" role="group" aria-label="答えで絞り込む">
          {FILTERS.filter((f) => f.id === 'all' || counts.get(f.id)).map((f) => (
            <button
              type="button"
              key={f.id}
              class={`nb-filter nb-filter--${f.id} ${filter === f.id ? 'is-on' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                audio.sfx('toggle');
              }}
            >
              {f.label}
              <span class="nb-filter__n t-mono">{counts.get(f.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <p class="nb-empty">まだ質問していません。</p>
      ) : !shown.length ? (
        <p class="nb-empty">条件に合う記録はありません。</p>
      ) : (
        <ol class="nb-rows">
          {shown.map((r) => (
            <li key={r.id} class={`nb-row ${r.kind === 'hint' ? 'nb-row--hint' : `nb-row--${r.answerClass}`}`}>
              <div class="nb-row__head">
                <span class="nb-row__no t-mono">{r.kind === 'hint' ? `LV.${r.level}` : `Q.${String(r.n).padStart(2, '0')}`}</span>
                <span class="nb-row__q">{r.question}</span>
                {r.answerClass && !r.support && (
                  <span class="nb-row__stamp">
                    <Stamp answerClass={r.answerClass} size="xs" tilt={-4} decorative />
                    <span class="sr-only">{STAMP_META[r.answerClass].sr}</span>
                  </span>
                )}
              </div>
              <p class="nb-row__line">{r.line}</p>
              {r.unlocked.length > 0 && (
                <p class="nb-row__got t-mono">
                  <Icon name="evidence" size={12} />
                  所見 +{r.unlocked.length}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MemosPanel({ c }: { c: CaseProgress | undefined }) {
  const memos = Object.values(c?.memos ?? {});
  if (!memos.length) return <p class="nb-empty">科学メモは、所見と一緒に解放されます。</p>;
  return (
    <div class="nb-memos">
      {memos.map((m) => (
        <article class="nb-memo" key={m.id}>
          <header>
            <Icon name="science" size={16} />
            <h3>{m.title}</h3>
          </header>
          <p>{m.text}</p>
        </article>
      ))}
    </div>
  );
}

export interface NotebookProps {
  caseId: string;
  /** Facts still flying toward the notebook (not shown yet). */
  arriving?: Signal<Set<string>>;
  variant?: 'side' | 'sheet';
  /** Side panel: header with title (marked as the card-flight target). */
  onCollapse?: () => void;
}

/** 捜査ノート body with its tabs. */
export function Notebook({ caseId, arriving, variant = 'sheet', onCollapse }: NotebookProps) {
  const progress = useCaseProgress(caseId);
  const c = progress.value;
  const arr = arriving?.value ?? EMPTY;
  const tab = notebookTab.value;
  const group = `nb-${variant}`;
  const newCount = unseenFacts(c, arr).length;
  const items: TabItem[] = [
    { id: 'facts', label: '所見', icon: 'evidence', badge: newCount || undefined },
    { id: 'log', label: '質問ログ', icon: 'log' },
    { id: 'memos', label: '科学メモ', icon: 'science', badge: undefined },
  ];
  return (
    <div class={`nb nb--${variant}`}>
      {variant === 'side' && (
        <header class="nb__head" data-notebook-target>
          <div class="nb__titles">
            <span class="nb__en">NOTEBOOK</span>
            <h2 class="nb__title">捜査ノート</h2>
          </div>
          <span class="nb__count t-mono">
            {c?.factOrder.filter((id) => !arr.has(id)).length ?? 0}
            <small>所見</small>
          </span>
          {onCollapse && (
            <button type="button" class="nb__collapse" aria-label="捜査ノートをたたむ" data-tip="たたむ（N）" data-tip-side="right" onClick={onCollapse}>
              <Icon name="chevronLeft" size={18} />
            </button>
          )}
        </header>
      )}
      <Tabs group={group} items={items} value={tab} onChange={(id) => (notebookTab.value = id as NotebookTab)} label="捜査ノートの表示" size="sm" class="nb__tabs" />
      <div class="nb__body scroll-y">
        <TabPanel group={group} id="facts" value={tab}>
          <FactsPanel c={c} arriving={arr} caseId={caseId} active={tab === 'facts'} />
        </TabPanel>
        <TabPanel group={group} id="log" value={tab}>
          <LogPanel c={c} />
        </TabPanel>
        <TabPanel group={group} id="memos" value={tab}>
          <MemosPanel c={c} />
        </TabPanel>
      </div>
    </div>
  );
}
