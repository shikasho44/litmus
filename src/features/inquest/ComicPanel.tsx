/**
 * One frame of the 真相再構成 comic strip.
 * Art: public/cases/<n>/panel-N.webp when present; otherwise an ink-and-screentone frame
 * with focus lines and the panel number (the designed fallback — never a broken image).
 */
import { useImage } from '../../lib/asset';
import { hashString } from '../../lib/rng';
import { Icon } from '../../ui/Icon';

export type PanelState = 'open' | 'blank' | 'picked' | 'wrong' | 'verified' | 'revealed';

export interface ComicPanelProps {
  id: string;
  index: number;
  image?: string;
  caption: string;
  prompt?: string;
  pickText?: string;
  state: PanelState;
  active?: boolean;
  lit?: boolean;
  dim?: boolean;
  onOpen?: () => void;
  seed: string;
}

export function PanelFallback({ index, seed }: { index: number; seed: string }) {
  const h = hashString(`${seed}:${index}`);
  const fx = 22 + (h % 56);
  const fy = 24 + ((h >>> 8) % 48);
  const ang = (h >>> 16) % 360;
  return (
    <div class="cpanel__fallback" style={{ '--fx': `${fx}%`, '--fy': `${fy}%`, '--ang': `${ang}deg` }} aria-hidden="true">
      <div class="cpanel__tone" />
      <div class="cpanel__focus" />
      <div class="cpanel__hatch" />
      <span class="cpanel__num">{String(index + 1).padStart(2, '0')}</span>
      <span class="cpanel__en">PANEL</span>
    </div>
  );
}

export function ComicPanel({ id, index, image, caption, prompt, pickText, state, active, lit, dim, onOpen, seed }: ComicPanelProps) {
  const url = useImage(state === 'revealed' || state === 'open' ? image : undefined);
  const blankish = state === 'blank' || state === 'picked' || state === 'wrong' || state === 'verified';
  const clickable = !!onOpen && (state === 'blank' || state === 'picked' || state === 'wrong');
  const label = `コマ${index + 1}${blankish ? (state === 'blank' ? '：空白' : state === 'verified' ? '：正しい' : state === 'wrong' ? '：違う' : `：${pickText ?? ''}`) : ''}`;
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      {...(clickable ? { type: 'button', onClick: onOpen } : {})}
      class={`cpanel cpanel--${state} ${active ? 'is-active' : ''} ${lit ? 'is-lit' : ''} ${dim ? 'is-dim' : ''}`}
      data-panel-id={id}
      data-panel-state={state}
      aria-label={label}
      aria-pressed={clickable ? !!active : undefined}
    >
      <span class="cpanel__art">
        {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <PanelFallback index={index} seed={seed} />}
        {state === 'blank' && (
          <span class="cpanel__blank" aria-hidden="true">
            <span class="cpanel__q">？</span>
          </span>
        )}
        {(state === 'picked' || state === 'wrong' || state === 'verified') && pickText && (
          <span class="cpanel__pick">
            <span class="cpanel__pick-k">{state === 'verified' ? '確定' : 'あなたの選択'}</span>
            <span class="cpanel__pick-t">{pickText}</span>
          </span>
        )}
        {state === 'wrong' && (
          <span class="cpanel__x" aria-hidden="true">
            ✕
          </span>
        )}
        {state === 'verified' && (
          <span class="cpanel__ok" aria-hidden="true">
            <Icon name="check" size={22} strokeWidth={3} />
          </span>
        )}
        <span class="cpanel__no" aria-hidden="true">
          {index + 1}
        </span>
      </span>
      {blankish && state !== 'verified' ? (
        <span class="cpanel__cap cpanel__cap--prompt">
          <Icon name="help" size={14} />
          {prompt}
        </span>
      ) : caption ? (
        <span class="cpanel__cap">{caption}</span>
      ) : null}
    </Tag>
  );
}
