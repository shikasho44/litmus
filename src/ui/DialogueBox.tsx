import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { audio, type Speaker } from '../audio';
import { settings } from '../state/save';
import type { TextSpeed } from '../state/types';
import './dialogue.css';

/** Increment to force every DialogueBox to finish its line instantly (used by __JD.skipText). */
export const skipTextTick = signal(0);
export function skipText() {
  skipTextTick.value++;
}

export const TEXT_SPEED_MS: Record<TextSpeed, number> = { slow: 52, normal: 30, fast: 13, instant: 0 };

export const SPEAKER_NAME: Record<Speaker, string> = {
  holma: 'ホルマ',
  jane: 'ジェーン・ドゥ',
  narration: '',
  system: 'SYSTEM',
};

export interface DialogueBoxProps {
  speaker: Speaker;
  text: string;
  /** Override the name plate (e.g. the restored name after solving). */
  name?: string;
  /** Change to restart typing even if the text is identical. */
  lineKey?: string | number;
  /** Called on click / Enter / Space once the line is fully shown. */
  onAdvance?: () => void;
  /** Called when the typewriter finishes. */
  onComplete?: () => void;
  /** Auto-advance after completion (ms computed from length). */
  auto?: boolean;
  /** Listen to Enter/Space globally (default true). Disable when an input has focus. */
  keyboard?: boolean;
  /** Show the ▼ advance indicator when complete (default true when onAdvance is set). */
  showNext?: boolean;
  /** Jane's lines flicker like corrupted memory. */
  glitch?: boolean;
  class?: string;
  /** Visual size. */
  size?: 'md' | 'lg';
}

function isInteractive(el: Element | null) {
  if (!el) return false;
  return !!el.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]');
}

/**
 * Typewriter dialogue box. First click/Enter/Space completes the line; the next advances.
 * Screen readers receive the whole line at once through a polite live region.
 */
export function DialogueBox({ speaker, text, name, lineKey, onAdvance, onComplete, auto, keyboard = true, showNext, glitch, class: cls, size = 'md' }: DialogueBoxProps) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [count, setCount] = useState(0);
  const done = count >= chars.length;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const advRef = useRef(onAdvance);
  advRef.current = onAdvance;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const doneRef = useRef(done);
  doneRef.current = done;
  const charsRef = useRef(chars);
  charsRef.current = chars;
  const speed = TEXT_SPEED_MS[settings.value.textSpeed];

  // typing loop
  useEffect(() => {
    clearTimeout(timer.current);
    if (speed === 0) {
      setCount(chars.length);
      return;
    }
    setCount(0);
    let i = 0;
    const step = () => {
      i++;
      setCount(i);
      const ch = chars[i - 1];
      if (ch && ch.trim() && i % 2 === 1) audio.blip(speaker);
      if (i >= chars.length) return;
      const f = speed / 30;
      let d = speed;
      if (ch === '、' || ch === ',') d += 110 * f;
      else if ('。！？!?…'.includes(ch)) d += 230 * f;
      else if (ch === '—') d += 40 * f;
      timer.current = setTimeout(step, d);
    };
    timer.current = setTimeout(step, 90);
    return () => clearTimeout(timer.current);
  }, [text, lineKey, speed]);

  // completion callback + auto advance
  useEffect(() => {
    if (!done) return;
    completeRef.current?.();
    if (!auto) return;
    const t = setTimeout(() => advRef.current?.(), 900 + chars.length * 45);
    return () => clearTimeout(t);
  }, [done, auto, text, lineKey]);

  // external skip
  useEffect(() => {
    let last = skipTextTick.peek();
    const unsub = skipTextTick.subscribe((v) => {
      if (v === last) return;
      last = v;
      clearTimeout(timer.current);
      setCount(chars.length);
    });
    return unsub;
  }, [chars]);

  const activate = () => {
    if (!doneRef.current) {
      clearTimeout(timer.current);
      setCount(charsRef.current.length);
      return;
    }
    advRef.current?.();
  };

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.isComposing || e.repeat) return;
      if (isInteractive(document.activeElement) && !(document.activeElement as HTMLElement).classList.contains('dlg')) return;
      if (document.querySelector('.modal-root, .sheet-root')) return;
      e.preventDefault();
      activate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard]);

  const plate = name ?? SPEAKER_NAME[speaker];
  const shown = chars.slice(0, count).join('');
  const rest = chars.slice(count).join('');
  const next = showNext ?? !!onAdvance;

  return (
    <div
      class={`dlg dlg--${speaker} dlg--${size} ${done ? 'is-done' : 'is-typing'} ${glitch ? 'is-glitch' : ''} ${cls ?? ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button:not(.dlg__next)')) return;
        activate();
      }}
    >
      {plate && (
        <div class="dlg__plate" aria-hidden="true">
          <span>{plate}</span>
        </div>
      )}
      <div class="dlg__frame">
        <p class="dlg__text" aria-hidden="true">
          <span class="dlg__shown">{shown}</span>
          <span class="dlg__rest">{rest}</span>
        </p>
        {next && (
          <button
            type="button"
            class="dlg__next"
            aria-label={done ? '次へ' : '全文を表示'}
            onClick={(e) => {
              e.stopPropagation();
              activate();
            }}
          >
            <span class="dlg__next-tri" aria-hidden="true" />
          </button>
        )}
      </div>
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {plate ? `${plate}：` : ''}
        {text}
      </p>
    </div>
  );
}
