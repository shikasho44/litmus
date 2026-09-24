import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../../audio';
import { DialogueBox } from '../../ui/DialogueBox';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import type { Controller } from './controller';

/**
 * 「ホルマの囁き」 — the hint shown as a special dialogue: the scene dims to a violet
 * vignette, Holma leans in (bust framing) and whispers the hint in a narrow card.
 */
export function WhisperOverlay({ ctl }: { ctl: Controller }) {
  const w = ctl.whisper.value;
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!w) return;
    setDone(false);
    prevFocus.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
    audio.sfx('open');
    return () => {
      prevFocus.current?.focus?.({ preventScroll: true });
    };
  }, [w?.level, w?.text]);

  useEffect(() => {
    if (done) btn.current?.focus({ preventScroll: true });
  }, [done]);

  if (!w) return null;
  const close = () => {
    audio.sfx('close');
    ctl.whisper.value = null;
  };
  return (
    <div
      ref={root}
      class="whisper"
      role="dialog"
      aria-modal="true"
      aria-label={`ホルマの囁き ${w.level}/${w.total}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div class="whisper__veil" onClick={close} aria-hidden="true" />
      <div class="whisper__holma" aria-hidden="true">
        <HolmaSprite mood={w.intro.mood === 'laugh' ? 'laugh' : 'serious'} framing="bust" talking={!done} />
      </div>
      <div class="whisper__card">
        <div class="whisper__head">
          <Icon name="whisper" size={18} />
          <span class="whisper__title">ホルマの囁き</span>
          <span class="whisper__en">WHISPER</span>
          <span class="whisper__lv t-mono">
            {w.level} / {w.total}
          </span>
        </div>
        <p class="whisper__intro">{w.intro.text}</p>
        <DialogueBox
          key={`${w.level}:${w.text}`}
          speaker="holma"
          text={w.text}
          class="whisper__dlg"
          keyboard={false}
          showNext={false}
          onComplete={() => setDone(true)}
        />
        <div class="whisper__actions">
          <button ref={btn} type="button" class="whisper__close" onClick={close}>
            <Icon name="check" size={16} />
            心に留めた
          </button>
        </div>
      </div>
    </div>
  );
}
