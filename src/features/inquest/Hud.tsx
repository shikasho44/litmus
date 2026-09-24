/** Small HUD pieces of the inquest: fire button, instruction strip, hint, Holma's quip, phase rail, status panel. */
import type { ComponentChildren } from 'preact';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import type { InquestSession, Phase } from './session';

export function FireButton({ session: s, onFire, compact }: { session: InquestSession; onFire: () => void; compact?: boolean }) {
  const hasT = !!s.target.value;
  const hasC = !!s.selected.value;
  const ready = s.ready.value && !s.busy.value && !s.dialogue.value && !s.tokenDead.value;
  const label = !hasT ? 'ノイズを選ぶ' : !hasC ? '所見を選ぶ' : '反証する！';
  return (
    <button type="button" class={`fire ${compact ? 'fire--compact' : ''} ${ready ? 'is-ready' : ''}`} disabled={!ready} onClick={onFire} data-fire aria-label={ready ? '反証する（撃つ）' : `撃てません：${label}`}>
      <span class="fire__bg" aria-hidden="true" />
      <span class="fire__en" aria-hidden="true">
        FIRE
      </span>
      <span class="fire__jp">{label}</span>
      {!compact && (
        <kbd class="fire__kbd" aria-hidden="true">
          Enter
        </kbd>
      )}
    </button>
  );
}

export function InstructionStrip({ session: s, narrow }: { session: InquestSession; narrow: boolean }) {
  const hasT = !!s.target.value;
  const hasC = !!s.selected.value;
  const stepN = !hasT ? 1 : !hasC ? 2 : 3;
  const items = narrow ? ['光る言葉をタップ', '所見を選ぶ', '撃つ'] : ['光る言葉（ノイズ）を選ぶ', '反証できる所見を装填', '反証する'];
  return (
    <div class="istrip" role="note" aria-label="遊び方">
      <ol class="istrip__steps">
        {items.map((t, i) => (
          <li key={i} class={`istrip__step ${i + 1 < stepN || (i === 0 && hasT) || (i === 1 && hasC) ? 'is-done' : ''} ${i + 1 === stepN ? 'is-now' : ''}`}>
            <span class="istrip__n">{i + 1}</span>
            <span class="istrip__t">{t}</span>
          </li>
        ))}
      </ol>
      {!narrow && (
        <span class="istrip__keys" aria-hidden="true">
          <kbd>↑↓</kbd>発言 <kbd>←→</kbd>ノイズ <kbd>E</kbd>所見 <kbd>Enter</kbd>撃つ <kbd>Space</kbd>停止
        </span>
      )}
    </div>
  );
}

export function HintBanner({ text, onBeg, canBeg }: { text: string; onBeg?: () => void; canBeg?: boolean }) {
  return (
    <div class="hintb" role="status" aria-live="polite">
      <span class="hintb__k">
        <Icon name="hint" size={16} />
        ホルマの囁き
      </span>
      <p class="hintb__t">{text}</p>
      {canBeg && onBeg && (
        <button type="button" class="hintb__beg" onClick={onBeg}>
          所見が足りない？ <b>ホルマに泣きつく</b>
        </button>
      )}
    </div>
  );
}

export function Quip({ session: s }: { session: InquestSession }) {
  const b = s.bark.value;
  return (
    <div class="quip-live" aria-live="polite" aria-atomic="true">
      {b && (
        <div key={b.key} class={`quip quip--${b.tone}`}>
          <span class="quip__who">{b.tone === 'warn' ? 'SYSTEM' : 'ホルマ'}</span>
          <p class="quip__t">{b.text}</p>
        </div>
      )}
    </div>
  );
}

const RAIL: { id: 'debate' | 'verdict' | 'reconstruction'; jp: string; en: string }[] = [
  { id: 'debate', jp: 'ノイズ・ブレイク', en: 'NOISE BREAK' },
  { id: 'verdict', jp: '死因宣告', en: 'VERDICT' },
  { id: 'reconstruction', jp: '真相再構成', en: 'RECONSTRUCTION' },
];

export function PhaseRail({ phase }: { phase: Phase }) {
  const cur = phase === 'finale' || phase === 'done' ? 'reconstruction' : phase === 'suspended' ? 'debate' : phase;
  const at = RAIL.findIndex((r) => r.id === cur);
  return (
    <ol class="prail" aria-label="審問の段階">
      {RAIL.map((r, i) => (
        <li key={r.id} class={`prail__i ${i < at ? 'is-done' : ''} ${i === at ? 'is-now' : ''}`} aria-current={i === at ? 'step' : undefined}>
          <span class="prail__n">{i + 1}</span>
          <span class="prail__jp">{r.jp}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Loading / error panel of the inquest: an ink card on a scrim with Holma's bust (surprised when
 * something went wrong), a kicker, the message and the actions. Never floats text over the art.
 */
export function InquestStatus({ kind, kicker, title, body, children }: { kind: 'loading' | 'error'; kicker: string; title: string; body?: string; children?: ComponentChildren }) {
  return (
    <div class={`iqstat iqstat--${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading' ? 'true' : undefined}>
      <div class="iqstat__holma" aria-hidden="true">
        <HolmaSprite mood={kind === 'error' ? 'surprised' : 'normal'} framing="bust" />
      </div>
      <div class="iqstat__body">
        <p class="iqstat__k">
          {kind === 'loading' ? (
            <span class="iqstat__gavel" aria-hidden="true">
              <Icon name="gavel" size={16} />
            </span>
          ) : (
            <Icon name="alert" size={16} />
          )}
          {kicker}
        </p>
        <h2 class="iqstat__t">{title}</h2>
        {body && <p class="iqstat__p">{body}</p>}
        {kind === 'loading' && (
          <span class="iqstat__bar" aria-hidden="true">
            <i />
          </span>
        )}
        {children && <div class="iqstat__actions">{children}</div>}
      </div>
    </div>
  );
}
