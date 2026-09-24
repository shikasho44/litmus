import type { HolmaMood } from '../../../shared/api';
import { ART, holmaMeta, loadHolmaMeta, useImage } from '../../lib/asset';
import { Icon } from '../../ui/Icon';
import { useEffect } from 'preact/hooks';

/**
 * Round avatar crop of Holma's face for the chat log (uses the meta.json face anchor of the
 * given mood). Falls back to the rabbit icon while the art is missing.
 */
export function HolmaFace({ mood = 'normal', size = 40 }: { mood?: HolmaMood; size?: number }) {
  const url = useImage(ART.holma(mood)) ?? null;
  useEffect(() => loadHolmaMeta(), []);
  const meta = holmaMeta.value?.[mood] ?? { w: 574, h: 918, face: { x: 0.5, y: 0.29 } };
  if (!url) {
    return (
      <span class="hface hface--fallback" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true">
        <Icon name="rabbit" size={size * 0.6} />
      </span>
    );
  }
  // the head is roughly 38% of the sprite width → zoom so it fills the circle
  const zoom = 2.7;
  const bw = size * zoom;
  const bh = (bw * meta.h) / meta.w;
  const x = meta.face.x * bw - size / 2;
  const y = meta.face.y * bh - size * 0.5;
  return (
    <span
      class="hface"
      data-mood={mood}
      style={{ width: `${size}px`, height: `${size}px`, backgroundImage: `url("${url}")`, backgroundSize: `${bw}px ${bh}px`, backgroundPosition: `${-x}px ${-y}px` }}
      aria-hidden="true"
    />
  );
}
