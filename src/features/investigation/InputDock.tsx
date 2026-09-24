import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../../audio';
import { layout } from '../../lib/viewport';
import { Icon } from '../../ui/Icon';
import type { Controller } from './controller';

export const MAX_QUESTION = 200;

export interface InputDockProps {
  ctl: Controller;
  starters: string[];
  /** Log has no question yet → chips open by default. */
  empty: boolean;
  disabled?: boolean;
  inputId: string;
}

/**
 * Question input. Enter sends (never while an IME is composing), Shift+Enter is ignored
 * (questions are one line), 200-char limit with a live counter, starter chips that fill the
 * input without sending, read-only while Holma is examining (keeps the phone keyboard up).
 */
export function InputDock({ ctl, starters, empty, disabled, inputId }: InputDockProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const compEndAt = useRef(0);
  const [chips, setChips] = useState(empty);
  const [now, setNow] = useState(Date.now());
  const text = ctl.inputText.value;
  const asking = ctl.asking.value;
  const presenting = ctl.presenting.value;
  const rateUntil = ctl.rateUntil.value;
  const waitLeft = Math.max(0, Math.ceil((rateUntil - now) / 1000));
  const len = [...text].length;
  const narrow = layout.value === 'narrow';
  const busy = asking || disabled;
  const canSend = !busy && !presenting && text.trim().length > 0 && waitLeft === 0;

  // chips follow the log state until the player toggles them
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) setChips(empty);
  }, [empty]);

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
      ctl.fastForward();
      return;
    }
    if (!canSend) {
      if (waitLeft > 0) audio.sfx('error');
      return;
    }
    const t = text;
    void ctl.ask(t);
    if (!toggled.current) setChips(false);
  };

  const fill = (q: string) => {
    ctl.inputText.value = q.slice(0, MAX_QUESTION);
    audio.sfx('page');
    ctl.touch();
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  return (
    <form
      class={`dock ${busy ? 'is-busy' : ''} ${chips ? 'has-chips' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      aria-busy={asking}
    >
      {chips && starters.length > 0 && (
        <div class="dock__chips" role="group" aria-label="質問の例（押すと入力欄に入ります）">
          {starters.map((q) => (
            <button type="button" key={q} class="dock__chip" onClick={() => fill(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div class="dock__row">
        <button
          type="button"
          class={`dock__examples ${chips ? 'is-on' : ''}`}
          aria-expanded={chips}
          aria-label="質問の例"
          data-tip="質問の例"
          data-tip-side="top"
          onClick={() => {
            toggled.current = true;
            setChips(!chips);
            audio.sfx('toggle');
          }}
        >
          <Icon name="help" size={20} />
          <span class="dock__examples-label">質問の例</span>
        </button>
        <div class={`dock__field ${len >= MAX_QUESTION ? 'is-full' : len >= MAX_QUESTION - 20 ? 'is-near' : ''} ${len >= 120 ? 'is-counting' : ''}`}>
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
        <button type="submit" class="dock__send" disabled={!canSend && !presenting} aria-label={waitLeft > 0 ? `あと${waitLeft}秒で送信できます` : '送信'}>
          {asking ? <span class="dock__spinner" aria-hidden="true" /> : <Icon name="send" size={20} />}
          <span class="dock__send-label">{waitLeft > 0 ? `${waitLeft}s` : '送信'}</span>
        </button>
      </div>
    </form>
  );
}
