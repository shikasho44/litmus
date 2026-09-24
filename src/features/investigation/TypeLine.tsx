import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { audio, type Speaker } from '../../audio';
import { settings } from '../../state/save';
import { skipTextTick, TEXT_SPEED_MS } from '../../ui/DialogueBox';

export interface TypeLineProps {
  text: string;
  /** Type it out (fresh answer). false = show at once (history). */
  animate?: boolean;
  speaker?: Speaker;
  onDone?: () => void;
  class?: string;
  /** Increment to finish instantly. */
  finishKey?: number;
}

/**
 * Lightweight typewriter for chat-log lines. Keeps line breaks (white-space: pre-line in CSS),
 * follows the text-speed setting and global skipText(), blips in the speaker's voice.
 * The full text is rendered in the DOM from the start (the untyped rest is transparent),
 * so the bubble never changes size while typing.
 */
export function TypeLine({ text, animate = false, speaker = 'holma', onDone, class: cls, finishKey = 0 }: TypeLineProps) {
  const chars = useMemo(() => Array.from(text), [text]);
  const speed = TEXT_SPEED_MS[settings.value.textSpeed];
  const [count, setCount] = useState(() => (animate && speed > 0 ? 0 : chars.length));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const fired = useRef(false);

  useEffect(() => {
    if (!animate || speed === 0) {
      setCount(chars.length);
      return;
    }
    let i = 0;
    const step = () => {
      i++;
      setCount(i);
      const ch = chars[i - 1];
      if (ch && ch.trim() && i % 2 === 1) audio.blip(speaker);
      if (i >= chars.length) return;
      const f = speed / 30;
      let d = speed;
      if (ch === '、' || ch === ',') d += 90 * f;
      else if ('。！？!?'.includes(ch)) d += 180 * f;
      else if (ch === '\n') d += 260 * f;
      else if (ch === '…' || ch === '—') d += 30 * f;
      timer.current = setTimeout(step, d);
    };
    timer.current = setTimeout(step, 60);
    return () => clearTimeout(timer.current);
  }, [text, animate]);

  // global skip + local finish
  useEffect(() => {
    let last = skipTextTick.peek();
    return skipTextTick.subscribe((v) => {
      if (v === last) return;
      last = v;
      clearTimeout(timer.current);
      setCount(chars.length);
    });
  }, [chars]);
  useEffect(() => {
    if (!finishKey) return;
    clearTimeout(timer.current);
    setCount(chars.length);
  }, [finishKey]);

  const done = count >= chars.length;
  useEffect(() => {
    if (done && !fired.current) {
      fired.current = true;
      doneRef.current?.();
    }
  }, [done]);

  return (
    <span class={`typeline ${done ? 'is-done' : 'is-typing'} ${cls ?? ''}`}>
      <span class="typeline__shown">{chars.slice(0, count).join('')}</span>
      {!done && <span class="typeline__rest" aria-hidden="true">{chars.slice(count).join('')}</span>}
    </span>
  );
}
