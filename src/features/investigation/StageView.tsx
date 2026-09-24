import { useEffect, useRef, useState } from 'preact/hooks';
import type { CasePublic } from '../../../shared/api';
import { fx } from '../../fx';
import { layout } from '../../lib/viewport';
import { formatElapsed } from '../../state/hooks';
import type { CaseProgress } from '../../state/types';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Icon } from '../../ui/Icon';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { Stamp } from '../../ui/Stamp';
import { SHARD_COUNT, shardsLit } from './caseData';
import type { Controller } from './controller';

export interface StageViewProps {
  ctl: Controller;
  pub?: CasePublic;
  progress?: CaseProgress;
  elapsed: number;
}

/** Everything on the stage: haze, Jane's shards, Holma, the question caption, HUD, bubbles. */
export function StageView({ ctl, pub, progress, elapsed }: StageViewProps) {
  const narrow = layout.value === 'narrow';
  const janeRef = useRef<HTMLDivElement>(null);
  const [resonate, setResonate] = useState(false);
  const nearTick = ctl.nearTick.value;
  const shown = ctl.shownProgress.value;
  const lit = shardsLit(shown);
  const near = !!progress?.snapshot?.nearCore;
  const asking = ctl.asking.value;
  const q = ctl.stageQ.value;
  const idle = ctl.idleLine.value;
  const whisper = ctl.whisper.value;
  const mood = ctl.mood.value;

  useEffect(() => {
    if (!nearTick) return;
    setResonate(true);
    fx.glitch(janeRef.current);
    const t = setTimeout(() => setResonate(false), 1700);
    return () => clearTimeout(t);
  }, [nearTick]);

  const asked = progress?.snapshot?.asked ?? 0;
  const unlockedCount = progress?.factOrder.length ?? 0;
  const pct = Math.round(shown * 100);

  return (
    <div class={`ivs ${asking ? 'is-asking' : ''} ${near ? 'is-near' : ''} ${whisper ? 'is-whisper' : ''} ${q ? 'has-caption' : ''}`} onClick={() => ctl.fastForward()}>
      <div class="ivs__haze" aria-hidden="true" />
      <div class="ivs__scan" aria-hidden="true" />

      {/* Jane Doe */}
      <div ref={janeRef} class={`ivs__jane ${resonate ? 'is-resonating' : ''}`}>
        <div class="ivs__jane-halo" aria-hidden="true" />
        <ShardPortrait
          image={pub?.portrait}
          seed={ctl.caseId}
          shardCount={SHARD_COUNT}
          revealed={lit}
          glow={near || resonate}
          label={`${pub?.codename ?? 'ジェーン・ドゥ'}の破片（${lit}/${SHARD_COUNT}）`}
        />
        <div class="ivs__jane-tag">
          <span class="ivs__jane-name">{pub?.codename ?? 'ジェーン・ドゥ'}</span>
          <span class="ivs__jane-meter" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span class="ivs__jane-pct t-mono">
            SHARDS {String(lit).padStart(2, '0')}/{SHARD_COUNT}
          </span>
        </div>
      </div>

      {/* Holma */}
      <div class={`ivs__holma ${asking ? 'is-thinking' : ''}`}>
        <HolmaSprite
          mood={asking ? 'normal' : mood}
          talking={ctl.talking.value}
          thinking={asking}
          framing={narrow ? 'bust' : 'hip'}
          faceX={narrow ? 0.52 : 0.5}
          rim={near ? 'rgba(61,224,255,0.3)' : 'rgba(198,255,61,0.2)'}
        />
        {asking && (
          <div class="ivs__think" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {/* HUD */}
      <div class="ivs__hud t-mono" aria-hidden={narrow ? undefined : 'true'}>
        <span class="ivs__hud-item">
          <Icon name="help" size={12} />Q {String(asked).padStart(2, '0')}
        </span>
        <span class="ivs__hud-item">
          <Icon name="time" size={12} />
          {formatElapsed(elapsed)}
        </span>
        <span class="ivs__hud-item">
          <Icon name="evidence" size={12} />
          {unlockedCount}/{pub?.totalFacts ?? '—'}
        </span>
      </div>

      {/* question caption */}
      {q && (
        <div class={`ivs__caption ${asking ? 'is-live' : ''}`} key={`${q.n}:${q.text}`}>
          <span class="ivs__caption-no">Q.{String(q.n).padStart(2, '0')}</span>
          <span class="ivs__caption-text">{q.text}</span>
          {!asking && q.answerClass && (
            <span class="ivs__caption-stamp">
              <Stamp answerClass={q.answerClass} size="xs" tilt={-6} decorative />
            </span>
          )}
          {asking && <span class="ivs__caption-scan" aria-hidden="true" />}
        </div>
      )}

      {/* idle nudge */}
      {idle && !whisper && (
        <div class="ivs__bubble" key={idle.key} role="note">
          <span class="ivs__bubble-name">ホルマ</span>
          <p>{idle.text}</p>
        </div>
      )}

    </div>
  );
}
