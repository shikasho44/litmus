import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CasePublic, PublicFact, ScienceMemoView } from '../../../shared/api';
import { audio } from '../../audio';
import { PROTO_I005 } from '../../config/proto';
import { ScienceMark } from '../i005/bits';
import type { CaseProgress, LogEntry } from '../../state/types';
import { EvidenceCard, factTitle, importanceLabel } from '../../ui/EvidenceCard';
import { resolveIcon } from '../../ui/icons';
import { Icon } from '../../ui/Icon';
import { Stamp, STAMP_META } from '../../ui/Stamp';
import type { Controller } from './controller';
import { HolmaFace } from './HolmaFace';
import { SupportCard } from './SupportCard';
import { TypeLine } from './TypeLine';
import '../budget/budget.css';

type AnswerEntry = Extract<LogEntry, { kind: 'answer' }>;

/** Rows rendered at once (the notebook's 質問ログ keeps the full history). */
const WINDOW = 80;

export function MemoCard({ memo, compact }: { memo: ScienceMemoView; compact?: boolean }) {
  return (
    <article class={`memo ${compact ? 'memo--compact' : ''}`}>
      <header class="memo__head">
        <Icon name="science" size={15} />
        <span class="memo__kicker">科学メモ</span>
        <span class="memo__title">{memo.title}</span>
      </header>
      <p class="memo__text">{memo.text}</p>
    </article>
  );
}

/**
 * A finding in the conversation: one line (icon, title, category) that opens the full card
 * in place. The notebook holds the full card, so the log stays readable on every screen.
 */
function FindingChip({ fact, index }: { fact: PublicFact; index: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const core = fact.importance >= 3;
  const key = fact.importance === 2;
  // bring the opened card into view (the tap counts as the player's own scrolling)
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => ref.current?.querySelector('.fchip__card')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [open]);
  return (
    <div ref={ref} class={`fchip ${core ? 'fchip--core' : key ? 'fchip--key' : ''} ${open ? 'is-open' : ''}`} style={{ '--fchip-i': index }}>
      <button
        type="button"
        class="fchip__btn"
        aria-expanded={open}
        aria-label={`${core ? '核心所見' : '所見'}：${factTitle(fact)}（${fact.category}・${importanceLabel(fact.importance)}）${open ? 'を閉じる' : 'を開く'}`}
        onClick={() => {
          setOpen(!open);
          audio.sfx(open ? 'toggle' : 'page');
        }}
      >
        <span class="fchip__icon" aria-hidden="true">
          <Icon name={resolveIcon(fact.icon, fact.category)} size={16} />
        </span>
        <span class="fchip__kicker t-mono" aria-hidden="true">
          {core ? 'CORE' : 'NEW'}
        </span>
        <span class="fchip__title" aria-hidden="true">
          {factTitle(fact)}
        </span>
        {PROTO_I005 && fact.science && <ScienceMark compact />}
        <span class="fchip__cat" aria-hidden="true">
          {fact.category}
        </span>
        <Icon name="chevronDown" size={14} class="fchip__chev" />
      </button>
      {open && <EvidenceCard fact={fact} class="fchip__card" />}
    </div>
  );
}

function QuestionRow({ n, text, pending }: { n: number; text: string; pending?: boolean }) {
  return (
    <div class={`qrow ${pending ? 'is-pending' : ''}`}>
      <div class="qrow__bubble">
        <span class="qrow__no t-mono" aria-hidden="true">
          Q.{String(n).padStart(2, '0')}
        </span>
        <p class="qrow__text">
          <span class="sr-only">質問：</span>
          {text}
        </p>
      </div>
    </div>
  );
}

function AnswerRow({
  e,
  multi,
  facts,
  memos,
  animate,
  ctl,
  arriving,
  held,
}: {
  e: AnswerEntry;
  multi: boolean;
  facts: PublicFact[];
  memos: ScienceMemoView[];
  animate: boolean;
  ctl: Controller;
  arriving: Set<string>;
  /** The big stamp is still on stage: keep the small chip back (space reserved). */
  held: boolean;
}) {
  const support = e.notice === 'support';
  const degraded = e.notice === 'degraded' || e.degraded;
  const landed = facts.filter((f) => !arriving.has(f.id));
  return (
    <div class={`arow arow--${e.answerClass} ${support ? 'is-support' : ''} ${e.nearCore ? 'is-near' : ''}`} data-answer={e.answerClass}>
      <div class="arow__avatar">
        <HolmaFace mood={support ? 'serious' : e.mood} />
      </div>
      <div class="arow__body">
        <div class="arow__meta">
          <span class="arow__name">ホルマ</span>
          {!support && (
            <span class={`arow__stamp ${held ? 'is-held' : ''}`}>
              {/* remounts on release, so the chip pops in as the big stamp leaves */}
              <Stamp key={held ? 'held' : 'shown'} answerClass={e.answerClass} size="xs" tilt={-4} decorative />
              <span class="sr-only">判定：{STAMP_META[e.answerClass].sr}</span>
            </span>
          )}
          {e.nearCore && !support && (
            <span class="arow__near">
              <Icon name="star" size={12} />
              核心に迫る
            </span>
          )}
          {e.free && !support && (
            <span class="arow__free" data-tip="質問枠に数えない返答です" title="質問枠に数えない返答です">
              ノーカウント
            </span>
          )}
          {degraded && (
            <span class="arow__badge" title="通信が不安定なため、簡易判定で答えています" data-tip="通信が不安定なため簡易判定で答えています">
              <Icon name="info" size={12} />
              簡易判定
            </span>
          )}
        </div>
        {multi && <p class="arow__q">「{e.question}」</p>}
        <p class="arow__line">
          <TypeLine text={e.line} animate={animate} onDone={() => ctl.onTyped(e.id)} finishKey={ctl.finishTick.value} />
        </p>
        {support && <SupportCard />}
        {landed.length > 0 && (
          <div class="arow__cards">
            {landed.map((f, i) => (
              <FindingChip key={f.id} fact={f} index={i} />
            ))}
          </div>
        )}
        {memos.length > 0 && landed.length === facts.length && (
          <div class="arow__memos">
            {memos.map((m) => (
              <MemoCard key={m.id} memo={m} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HintRow({ level, text }: { level: number; text: string }) {
  return (
    <div class="hrow">
      <div class="hrow__head">
        <Icon name="whisper" size={16} />
        <span>ホルマの囁き</span>
        <span class="hrow__lv t-mono">LV.{level}</span>
      </div>
      <p class="hrow__text">{text}</p>
    </div>
  );
}

const NUDGE_TAG: Record<Extract<LogEntry, { kind: 'nudge' }>['reason'], { tag: string; tone: '' | 'budget' | 'alarm' }> = {
  stuck: { tag: 'ひとりごと', tone: '' },
  ready: { tag: 'ひとりごと', tone: '' },
  low: { tag: '質問枠', tone: 'budget' },
  zero: { tag: '質問枠', tone: 'budget' },
  over: { tag: '質問枠', tone: 'alarm' },
  closed: { tag: '質問枠', tone: 'alarm' },
};

/** Holma speaking up unasked: a free nudge (ひとりごと) or a remark on the question budget. */
function NudgeRow({ e }: { e: Extract<LogEntry, { kind: 'nudge' }> }) {
  const meta = NUDGE_TAG[e.reason] ?? NUDGE_TAG.stuck;
  return (
    <div class={`nrow ${meta.tone ? `nrow--${meta.tone}` : ''}`} data-nudge={e.reason}>
      <div class="arow__avatar">
        <HolmaFace mood={e.mood ?? 'normal'} />
      </div>
      <div class="nrow__body">
        <div class="nrow__meta">
          <span class="arow__name">ホルマ</span>
          <span class="nrow__tag">
            <Icon name={meta.tone ? 'info' : 'whisper'} size={12} />
            {meta.tag}
          </span>
          {e.nudge && <span class="nrow__free">（減点なし）</span>}
        </div>
        <p class="nrow__line">{e.text}</p>
      </div>
    </div>
  );
}

function ThinkingRow() {
  return (
    <div class="arow arow--thinking" aria-hidden="true">
      <div class="arow__avatar">
        <HolmaFace mood="normal" />
      </div>
      <div class="arow__body">
        <div class="arow__meta">
          <span class="arow__name">ホルマ</span>
          <span class="thinking-label t-mono">EXAMINING</span>
        </div>
        <p class="arow__line thinking">
          <span />
          <span />
          <span />
        </p>
      </div>
    </div>
  );
}

function ChatIntro({ pub }: { pub?: CasePublic }) {
  if (!pub) return null;
  return (
    <div class="chat-intro">
      <p class="chat-intro__kicker t-mono">CASE {String(pub.number).padStart(2, '0')} — INVESTIGATION OPEN</p>
      <p class="chat-intro__summary">{pub.summary}</p>
      <div class="chat-intro__rule">
        <span class="chat-intro__badge">掟</span>
        <p>
          ホルマは<b>嘘をつけません</b>。ただし、<b>訊かれたことにしか答えません</b>。「はい」「いいえ」で答えられる形で、ひとつずつ訊いてみましょう。
        </p>
      </div>
      {pub.startingFacts.length > 0 && (
        <div class="chat-intro__facts">
          <p class="chat-intro__label t-mono">INITIAL FINDINGS — 初期所見（捜査ノートに記録済み）</p>
          <ul class="chat-intro__tags">
            {pub.startingFacts.map((f) => (
              <li key={f.id} class={`chat-intro__tag ${f.importance >= 2 ? 'is-key' : ''}`}>
                <Icon name={resolveIcon(f.icon, f.category)} size={14} />
                <span class="chat-intro__tag-cat">{f.category}</span>
                <span>{factTitle(f)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface ChatLogProps {
  ctl: Controller;
  progress: CaseProgress | undefined;
  pub?: CasePublic;
}

/**
 * How the log follows new content:
 *   anchor — keep the start of the newest exchange (question / hint / error row) in view: pinned
 *            to the bottom while the exchange fits, its first line at the top once it does not
 *   bottom — pinned to the bottom (the player scrolled down there, or pressed 続き/最新)
 *   free   — the player scrolled away; never move, offer a jump button instead
 */
type Follow = 'anchor' | 'bottom' | 'free';

interface Row {
  key: string;
  node: ComponentChildren;
  /** Starts an exchange (the scroll anchor). */
  start: boolean;
}

/** The conversation: questions, Holma's answers (stamp + line), findings, memos, hints. */
export function ChatLog({ ctl, progress, pub }: ChatLogProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const log = progress?.log ?? [];
  // An empty log shows the case brief from the top; once questions exist, follow the newest exchange.
  const follow = useRef<Follow>(log.some((e) => e.kind === 'question') ? 'anchor' : 'free');
  const [jump, setJump] = useState<null | 'more' | 'latest'>(null);
  const [windowSize, setWindowSize] = useState(WINDOW);
  const rowsRef = useRef(0);
  const hidden = ctl.hidden.value;
  const animated = ctl.animated.value;
  const arriving = ctl.arriving.value;
  const held = ctl.chipHold.value;
  const pending = ctl.pending.value;
  const asking = ctl.asking.value;
  const transient = ctl.transient.value;
  // read here so rows re-render when it ticks
  void ctl.finishTick.value;

  const rows = useMemo(() => {
    const out: Row[] = [];
    let qn = 0;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      if (e.kind === 'question') {
        qn++;
        out.push({ key: e.id, start: true, node: <QuestionRow n={qn} text={e.text} /> });
      } else if (e.kind === 'answer') {
        if (hidden.has(e.id)) continue;
        // multi = this answer belongs to a message with several answers
        let a = i;
        while (a > 0 && log[a - 1].kind === 'answer') a--;
        let b = i;
        while (b < log.length - 1 && log[b + 1].kind === 'answer') b++;
        const multi = b > a;
        const facts = e.unlocked.map((id) => progress?.facts[id]).filter((f): f is PublicFact => !!f);
        const memos = e.memos.map((id) => progress?.memos[id]).filter((m): m is ScienceMemoView => !!m);
        out.push({
          key: e.id,
          start: false,
          node: <AnswerRow e={e} multi={multi} facts={facts} memos={memos} animate={animated.has(e.id)} ctl={ctl} arriving={arriving} held={held.has(e.id)} />,
        });
      } else if (e.kind === 'hint') {
        out.push({ key: e.id, start: true, node: <HintRow level={e.level} text={e.text} /> });
      } else if (e.kind === 'nudge') {
        // said after the answers were shown: it becomes the newest thing to keep in view
        out.push({ key: e.id, start: true, node: <NudgeRow e={e} /> });
      } else if (e.kind === 'system') {
        out.push({ key: e.id, start: true, node: <p class={`srow srow--${e.tone ?? 'info'}`}>{e.text}</p> });
      }
    }
    return { out, qn };
  }, [log, hidden, animated, arriving, held, progress?.facts, progress?.memos]);

  // Only the newest rows are in the DOM (a long session stays light); the window starts at an exchange.
  let first = Math.max(0, rows.out.length - windowSize);
  while (first > 0 && !rows.out[first].start) first--;
  const visible = first > 0 ? rows.out.slice(first) : rows.out;

  /** Apply the follow mode. Always instant: a smooth programmatic scroll would look like the player scrolling. */
  const apply = () => {
    const el = scroller.current;
    const inn = inner.current;
    if (!el || !inn) return;
    const m = follow.current;
    const max = el.scrollHeight - el.clientHeight;
    if (m === 'bottom') el.scrollTop = max;
    else if (m === 'anchor') {
      const starts = inn.querySelectorAll<HTMLElement>(':scope > .chat__row[data-start]');
      const a = starts[starts.length - 1];
      el.scrollTop = Math.max(0, Math.min(max, a ? a.offsetTop - 10 : max));
    }
    const below = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (below <= 72 || rowsRef.current === 0) setJump(null);
    else if (m === 'anchor') setJump('more');
    else if (m === 'free') setJump((j) => j ?? 'latest');
  };

  // follow content growth (typing, chips opening, cards landing, new rows)
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // sending a question (or an error / hint row) brings the newest exchange into view
  const lastRowKey = visible.length ? visible[visible.length - 1].key : '';
  useLayoutEffect(() => {
    if (pending) follow.current = 'anchor';
    apply();
  }, [lastRowKey, !!pending, asking]);
  useLayoutEffect(() => {
    if (transient.length) follow.current = 'bottom';
    apply();
  }, [transient]);

  // Only the player's own scrolling changes the mode; programmatic scrolls never do.
  const userAt = useRef(0);
  const markUser = () => (userAt.current = performance.now());
  const onScroll = () => {
    const el = scroller.current;
    if (!el || performance.now() - userAt.current > 900) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    if (near) {
      follow.current = 'bottom';
      setJump(null);
    } else if (follow.current !== 'free') {
      follow.current = 'free';
    }
  };

  const empty = rows.qn === 0 && !pending;
  rowsRef.current = rows.qn;
  // the case was restarted (bad token → start over) → show the brief from the top again
  const prevQn = useRef(rows.qn);
  useEffect(() => {
    const was = prevQn.current;
    prevQn.current = rows.qn;
    if (!(was > 0 && rows.qn === 0)) return;
    follow.current = 'free';
    if (scroller.current) scroller.current.scrollTop = 0;
    setJump(null);
    setWindowSize(WINDOW);
  }, [rows.qn]);

  // 以前の記録を表示: grow the window and keep the view where it was
  const grow = useRef<{ h: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    const g = grow.current;
    if (!el || !g) return;
    grow.current = null;
    el.scrollTop = g.top + (el.scrollHeight - g.h);
  }, [windowSize]);
  const showEarlier = () => {
    const el = scroller.current;
    if (el) grow.current = { h: el.scrollHeight, top: el.scrollTop };
    follow.current = 'free';
    setWindowSize((n) => n + WINDOW);
    audio.sfx('page');
  };

  return (
    <div class="chat">
      <div
        class="chat__scroll"
        ref={scroller}
        onScroll={onScroll}
        onWheel={markUser}
        onTouchStart={markUser}
        onTouchMove={markUser}
        onPointerDown={markUser}
        onKeyDown={markUser}
        role="log"
        aria-label="質問と返答の記録"
        tabIndex={0}
      >
        <div class="chat__inner" ref={inner}>
          {empty && <ChatIntro pub={pub} />}
          {first > 0 && (
            <button type="button" class="chat__earlier" onClick={showEarlier}>
              <Icon name="log" size={14} />
              以前の記録を表示
              <span class="t-mono">（あと{first}件）</span>
            </button>
          )}
          {visible.map((r) => (
            <div class="chat__row" key={r.key} data-start={r.start ? '' : undefined}>
              {r.node}
            </div>
          ))}
          {pending && (
            <div class="chat__row" key={pending.id} data-start="">
              <QuestionRow n={rows.qn + 1} text={pending.text} pending />
            </div>
          )}
          {asking && (
            <div class="chat__row" key="thinking">
              <ThinkingRow />
            </div>
          )}
          {transient.map((t) => (
            <div class="chat__row" key={t.id} data-start="">
              <div class={`arow arow--error ${t.kind === 'rate' ? 'is-rate' : ''}`}>
                <div class="arow__avatar">
                  <HolmaFace mood={t.mood} />
                </div>
                <div class="arow__body">
                  <div class="arow__meta">
                    <span class="arow__name">ホルマ</span>
                    <span class="arow__badge arow__badge--warn">
                      <Icon name="alert" size={12} />
                      {t.kind === 'rate' ? '少々お待ちを' : '送信できませんでした'}
                    </span>
                  </div>
                  <p class="arow__line">{t.line}</p>
                  {t.kind === 'network' && (
                    <button type="button" class="arow__retry" onClick={() => ctl.retry(t.retryText)}>
                      <Icon name="refresh" size={16} />
                      もう一度送る
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {jump && (
        <button
          type="button"
          class={`chat__jump ${jump === 'more' ? 'is-more' : ''}`}
          onClick={() => {
            follow.current = 'bottom';
            setJump(null);
            apply();
          }}
        >
          <Icon name="chevronDown" size={16} />
          {jump === 'more' ? '続きを読む' : '最新の返答へ'}
        </button>
      )}
    </div>
  );
}
