import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CasePublic, PublicFact, ScienceMemoView } from '../../../shared/api';
import type { CaseProgress, LogEntry } from '../../state/types';
import { EvidenceCard, factTitle } from '../../ui/EvidenceCard';
import { resolveIcon } from '../../ui/icons';
import { Icon } from '../../ui/Icon';
import { Stamp, STAMP_META } from '../../ui/Stamp';
import type { Controller } from './controller';
import { HolmaFace } from './HolmaFace';
import { SupportCard } from './SupportCard';
import { TypeLine } from './TypeLine';

type AnswerEntry = Extract<LogEntry, { kind: 'answer' }>;

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
}: {
  e: AnswerEntry;
  multi: boolean;
  facts: PublicFact[];
  memos: ScienceMemoView[];
  animate: boolean;
  ctl: Controller;
  arriving: Set<string>;
}) {
  const support = e.notice === 'support';
  const degraded = e.notice === 'degraded' || e.degraded;
  const landed = facts.filter((f) => !arriving.has(f.id));
  return (
    <div class={`arow arow--${e.answerClass} ${support ? 'is-support' : ''}`} data-answer={e.answerClass}>
      <div class="arow__avatar">
        <HolmaFace mood={support ? 'serious' : e.mood} />
      </div>
      <div class="arow__body">
        <div class="arow__meta">
          <span class="arow__name">ホルマ</span>
          {!support && (
            <span class="arow__stamp">
              <Stamp answerClass={e.answerClass} size="xs" tilt={-4} decorative />
              <span class="sr-only">判定：{STAMP_META[e.answerClass].sr}</span>
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
              <EvidenceCard key={f.id} fact={f} index={i} class="arow__card" />
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

/** The conversation: questions, Holma's answers (stamp + line), findings, memos, hints. */
export function ChatLog({ ctl, progress, pub }: ChatLogProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  // An empty log shows the case brief from the top; once questions exist, follow the bottom.
  const stick = useRef((progress?.log ?? []).some((e) => e.kind === 'question'));
  const [showJump, setShowJump] = useState(false);
  const rowsRef = useRef(0);
  const log = progress?.log ?? [];
  const hidden = ctl.hidden.value;
  const animated = ctl.animated.value;
  const arriving = ctl.arriving.value;
  const pending = ctl.pending.value;
  const asking = ctl.asking.value;
  const transient = ctl.transient.value;
  // read here so rows re-render when it ticks
  void ctl.finishTick.value;

  const rows = useMemo(() => {
    const out: { key: string; node: ComponentChildren }[] = [];
    let qn = 0;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      if (e.kind === 'question') {
        qn++;
        out.push({ key: e.id, node: <QuestionRow n={qn} text={e.text} /> });
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
          node: <AnswerRow e={e} multi={multi} facts={facts} memos={memos} animate={animated.has(e.id)} ctl={ctl} arriving={arriving} />,
        });
      } else if (e.kind === 'hint') {
        out.push({ key: e.id, node: <HintRow level={e.level} text={e.text} /> });
      } else if (e.kind === 'system') {
        out.push({ key: e.id, node: <p class={`srow srow--${e.tone ?? 'info'}`}>{e.text}</p> });
      }
    }
    return { out, qn };
  }, [log, hidden, animated, arriving, progress?.facts, progress?.memos]);

  // Always instant: a smooth programmatic scroll would fire intermediate scroll events that
  // look like the player scrolling up and unpin the log.
  const scrollToEnd = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  // stay pinned to the bottom while content grows (typing, cards landing, new rows)
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    if (stick.current) scrollToEnd();
    const ro = new ResizeObserver(() => {
      if (stick.current) scrollToEnd();
      else if (scroller.current && scroller.current.scrollHeight - scroller.current.scrollTop - scroller.current.clientHeight > 72 && rowsRef.current > 0) setShowJump(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // sending a question always brings the conversation back into view
    if (pending) stick.current = true;
    if (stick.current) scrollToEnd();
  }, [rows.out.length, !!pending, asking, transient.length]);

  // Only the player's own scrolling may unpin the log; programmatic scrolls and content
  // growth (typing, cards landing) never do.
  const userAt = useRef(0);
  const markUser = () => (userAt.current = performance.now());
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    if (near) {
      stick.current = true;
      if (showJump) setShowJump(false);
    } else if (performance.now() - userAt.current < 900) stick.current = false;
  };

  const empty = rows.qn === 0 && !pending;
  rowsRef.current = rows.qn;
  // the case was restarted (bad token) → show the brief from the top again
  useEffect(() => {
    if (!empty) return;
    stick.current = false;
    if (scroller.current) scroller.current.scrollTop = 0;
    setShowJump(false);
  }, [empty]);

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
          {rows.out.map((r) => (
            <div class="chat__row" key={r.key}>
              {r.node}
            </div>
          ))}
          {pending && (
            <div class="chat__row" key={pending.id}>
              <QuestionRow n={rows.qn + 1} text={pending.text} pending />
            </div>
          )}
          {asking && (
            <div class="chat__row" key="thinking">
              <ThinkingRow />
            </div>
          )}
          {transient.map((t) => (
            <div class="chat__row" key={t.id}>
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
      {showJump && (
        <button
          type="button"
          class="chat__jump"
          onClick={() => {
            stick.current = true;
            setShowJump(false);
            scrollToEnd();
          }}
        >
          <Icon name="chevronDown" size={16} />
          最新の返答へ
        </button>
      )}
    </div>
  );
}
