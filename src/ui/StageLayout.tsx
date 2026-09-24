import type { ComponentChildren } from 'preact';
import { useImage } from '../lib/asset';
import { layout } from '../lib/viewport';
import './stage.css';

export interface StageLayoutProps {
  /** Top bar (case name, counters, buttons). */
  top?: ComponentChildren;
  /** Contents of the 16:9 stage (characters, shards, stamps). Marked [data-stage] for fx anchors. */
  stage?: ComponentChildren;
  /** Stage background image (public path). Missing → designed gradient fallback. */
  background?: string;
  /** Tint of the fallback / overlay: 'formalin' | 'alarm' | 'cyan'. */
  tone?: 'formalin' | 'alarm' | 'cyan' | 'amber';
  /** PC left column (collapsible notebook). Hidden on narrow layouts — use a BottomSheet there. */
  side?: ComponentChildren;
  /** Conversation / dialogue area under the stage (PC) or between stage and dock (phone). */
  bottom?: ComponentChildren;
  /** Input bar pinned to the bottom (respects safe area + on-screen keyboard). */
  dock?: ComponentChildren;
  /** PC only: overlay `bottom` on the lower part of the stage (cinematic ADV look). */
  cinematic?: boolean;
  /** Estimated height of bottom+dock on PC (px) used to size the stage. Default 230. */
  bottomHeight?: number;
  class?: string;
}

/**
 * Standard in-case layout.
 *  PC (wide):    [side] | top / 16:9 stage (centered) / bottom / dock — stage width is shared
 *  Phone:        top / stage (38% of visual viewport) / bottom (scrolls) / dock (above keyboard)
 */
export function StageLayout({ top, stage, background, tone = 'formalin', side, bottom, dock, cinematic, bottomHeight = 230, class: cls }: StageLayoutProps) {
  const bg = useImage(background);
  const wide = layout.value === 'wide';
  const cine = !!cinematic && wide;
  return (
    <div class={`sl ${cinematic ? 'sl--cinematic' : ''} ${side ? 'has-side' : ''} ${cls ?? ''}`} data-tone={tone} style={{ '--sl-bottom-h': `${cinematic ? 0 : bottomHeight}px` }}>
      {top && <div class="sl__top">{top}</div>}
      <div class="sl__main">
        {side && wide && <aside class="sl__side">{side}</aside>}
        <div class="sl__center">
          <div class="sl__stage" data-stage>
            <div class={`sl__bg ${bg ? 'has-img' : ''}`} aria-hidden="true">
              {bg ? <img src={bg} alt="" /> : <div class="sl__bg-fallback" />}
              <div class="sl__bg-shade" />
            </div>
            <div class="sl__stage-content">{stage}</div>
            <div class="sl__frame" aria-hidden="true" />
            {cine && bottom && <div class="sl__cine-bottom">{bottom}</div>}
          </div>
          {bottom && !cine && <div class="sl__bottom">{bottom}</div>}
          {dock && <div class="sl__dock">{dock}</div>}
        </div>
      </div>
    </div>
  );
}
