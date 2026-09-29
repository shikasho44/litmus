import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../../audio';
import { layout } from '../../lib/viewport';
import { Icon } from '../../ui/Icon';
import { BudgetCounter } from '../budget/BudgetCounter';
import type { BudgetView } from '../budget/budget';
import type { Controller } from './controller';
import { HolmaFace } from './HolmaFace';

export const MAX_QUESTION = 200;

const CARDS_PREF = 'janedoe:examples-open';

function readCardsPref(): boolean {
  try {
    return localStorage.getItem(CARDS_PREF) !== '0';
  } catch {
    return true;
  }
}
function writeCardsPref(open: boolean) {
  try {
    localStorage.setItem(CARDS_PREF, open ? '1' : '0');
  } catch {
    /* per-viewer convenience only */
  }
}

/** 1:05 */
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface InputDockProps {
  ctl: Controller;
  /** 質問の例 cards on the table (src/features/examples, ≤ 3). */
  cards: string[];
  /** ms until the next card (a slot free and cards left), else null. */
  nextInMs?: number | null;
  disabled?: boolean;
  inputId: string;
  /** 質問枠 of the run (null until the case data is known). 'closed' replaces the input. */
  budget?: BudgetView | null;
  /** The closed dock's button (教授, questions used up). */
  onOpenInquest?: () => void;
}

/**
 * Question input. Enter sends (never while an IME is composing), Shift+Enter is ignored
 * (questions are one line), 200-char limit with a live counter, read-only while Holma is
 * examining (keeps the phone keyboard up). Above it the 質問の例 cards (dealt over time, at most 3):
 * a card fills the input without sending; once sent it is an ordinary question and leaves the
 * table. The row can be folded (remembered per viewer); a card dealt while it is folded lights a
 * dot on the 「質問の例」 button.
 */
export function InputDock({ ctl, cards, nextInMs = null, disabled, inputId, budget, onOpenInquest }: InputDockProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const compEndAt = useRef(0);
  const [chips, setChips] = useState(readCardsPref);
  const [dot, setDot] = useState(false);
  const [now, setNow] = useState(Date.now());
  const text = ctl.inputText.value;
  const asking = ctl.asking.value;
  const presenting = ctl.presenting.value;
  const rateUntil = ctl.rateUntil.value;
  const waitLeft = Math.max(0, Math.ceil((rateUntil - now) / 1000));
  const len = [...text].length;
  const narrow = layout.value === 'narrow';
  const busy = asking || disabled;
  const queued = ctl.queued.value && presenting;
  const canSend = !busy && !presenting && text.trim().length > 0 && waitLeft === 0;
  const netError = ctl.transient.value.find((t) => t.kind === 'network');
  const picked = ctl.examplePick.value;

  // a card dealt while the row is folded lights the button's dot
  const seen = useRef(cards);
  useEffect(() => {
    if (!chips && cards.some((q) => !seen.current.includes(q))) setDot(true);
    seen.current = cards;
  }, [cards.join('|'), chips]);

  // rate-limit countdown
  useEffect(() => {
    if (rateUntil <= Date.now()) return;
    const iv = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= rateUntil) clearInterval(iv);
    }, 250);
    return () => clearInterval(iv);
  }, [rateUntil]);

  // auto-grow (1–3 lines)
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 3 * 1.55 * parseFloat(getComputedStyle(el).fontSize) + 18)}px`;
  }, [text]);

  const send = () => {
    if (presenting) {
      // fast-forward; a typed question goes out as soon as the presentation is over
      ctl.fastForward();
      if (text.trim() && waitLeft === 0) ctl.queueSend();
      return;
    }
    if (!canSend) {
      if (waitLeft > 0) audio.sfx('error');
      return;
    }
    const t = text;
    void ctl.ask(t);
  };

  const fill = (q: string) => {
    ctl.inputText.value = q.slice(0, MAX_QUESTION);
    ctl.examplePick.value = q;
    audio.sfx('page');
    ctl.touch();
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  if (budget?.state === 'closed') {
    // 教授: the question budget is used up — no input, Holma's line and the way on
    return (
      <div class="dock is-closed" role="status" data-budget-closed>
        <div class="dock__closed">
          <HolmaFace mood="serious" size={40} />
          <p class="dock__closed-text">
            <b>質問はここまで</b>
            教授の質問枠（{budget.budget}問）を使い切りました。
            <span class="dock__closed-sub">所見が足りなくても、審問で「ホルマに泣きつく」ことができます。</span>
          </p>
          <button type="button" class="dock__closed-btn" onClick={onOpenInquest} data-autofocus>
            <Icon name="gavel" size={20} />
            審問を開く
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      class={`dock ${busy ? 'is-busy' : ''} ${chips ? 'has-chips' : ''} ${queued ? 'is-queued' : ''} ${budget ? 'has-budget' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      aria-busy={asking}
    >
      {netError && !asking && (
        <div class="dock__alert" role="alert">
          <Icon name="alert" size={16} />
          <span class="dock__alert-text">
            通信に失敗しました<span class="dock__alert-sub"> — Enter でもう一度</span>
          </span>
          <button type="button" class="dock__alert-btn" onClick={() => ctl.retry(netError.retryText)}>
            <Icon name="refresh" size={14} />
            もう一度送る
          </button>
        </div>
      )}
      {queued && (
        <p class="dock__queued t-mono" aria-live="polite">
          <span class="dock__spinner dock__spinner--sm" aria-hidden="true" />
          演出のあとに送信します
        </p>
      )}
      {chips && (cards.length > 0 || nextInMs !== null) && (
        <div class="dock__chips" role="group" aria-label="質問の例（押すと入力欄に入ります。送ると1問として数えます）" data-example-cards={cards.length}>
          {cards.map((q) => (
            <button type="button" key={q} class={`dock__chip ${picked === q ? 'is-picked' : ''}`} onClick={() => fill(q)} data-example-card>
              {q}
            </button>
          ))}
          {nextInMs !== null && (
            <span class="dock__chip-next t-mono" title="質問の例は、捜査の時間とともに届きます" data-example-next>
              <Icon name="time" size={12} />
              {cards.length === 0 ? '質問の例まで' : '次の例'} {mmss(nextInMs)}
            </span>
          )}
        </div>
      )}
      <div class="dock__row">
        <button
          type="button"
          class={`dock__examples ${chips ? 'is-on' : ''} ${dot && !chips ? 'has-new' : ''}`}
          aria-expanded={chips}
          aria-label={`質問の例（${cards.length}枚）`}
          data-tip="質問の例"
          data-tip-side="top"
          onClick={() => {
            setChips(!chips);
            writeCardsPref(!chips);
            setDot(false);
            audio.sfx('toggle');
          }}
        >
          <Icon name="help" size={20} />
          <span class="dock__examples-label">質問の例</span>
          {cards.length > 0 && (
            <span class="dock__examples-count t-mono" aria-hidden="true">
              {cards.length}
            </span>
          )}
        </button>
        <div class={`dock__field ${len >= MAX_QUESTION ? 'is-full' : len >= MAX_QUESTION - 20 ? 'is-near' : ''} ${len >= 120 ? 'is-counting' : ''}`}>
          {budget && <BudgetCounter view={budget} />}
          <label class="sr-only" for={inputId}>
            ホルマへの質問（はい／いいえで答えられる形で）
          </label>
          <textarea
            ref={ta}
            id={inputId}
            class="dock__input"
            rows={1}
            maxLength={MAX_QUESTION}
            value={text}
            readOnly={busy}
            placeholder={asking ? 'ホルマが検分中……' : narrow ? 'ホルマに質問する' : 'はい／いいえで答えられる質問を入力'}
            enterkeyhint="send"
            autoComplete="off"
            spellcheck={false}
            data-autofocus
            aria-describedby={`${inputId}-count`}
            onInput={(e) => {
              const v = (e.target as HTMLTextAreaElement).value.replace(/\r?\n/g, ' ');
              ctl.inputText.value = [...v].slice(0, MAX_QUESTION).join('');
              if (!v.trim()) ctl.examplePick.value = null;
              ctl.touch();
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              compEndAt.current = performance.now();
            }}
            onKeyDown={(e) => {
              ctl.touch();
              if (e.key !== 'Enter') return;
              // IME: the Enter that commits a conversion must never send
              if (e.isComposing || e.keyCode === 229 || composing.current || performance.now() - compEndAt.current < 60) return;
              e.preventDefault();
              if (e.shiftKey) return;
              send();
            }}
          />
          <span id={`${inputId}-count`} class="dock__count t-mono" aria-label={`${len}文字（最大${MAX_QUESTION}文字）`}>
            {len}/{MAX_QUESTION}
          </span>
        </div>
        <button
          type="submit"
          class="dock__send"
          disabled={!canSend && !presenting}
          aria-label={waitLeft > 0 ? `あと${waitLeft}秒で送信できます` : presenting ? (text.trim() ? '早送りして送信' : '早送り') : '送信'}
        >
          {asking || queued ? <span class="dock__spinner" aria-hidden="true" /> : <Icon name="send" size={20} />}
          <span class="dock__send-label">{waitLeft > 0 ? `${waitLeft}s` : '送信'}</span>
        </button>
      </div>
    </form>
  );
}
