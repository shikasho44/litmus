import { useEffect, useRef } from 'preact/hooks';
import { gsap } from 'gsap';
import type { CasePublic } from '../../../shared/api';
import { motionReduced } from '../../fx/motion';
import { layout } from '../../lib/viewport';
import { formatElapsed } from '../../state/hooks';
import type { CaseProgress } from '../../state/types';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { DifficultyBadge } from '../difficulty/Badge';
import { caseNo } from './caseData';
import type { Controller } from './controller';

export interface TopBarProps {
  ctl: Controller;
  pub?: CasePublic;
  progress?: CaseProgress;
  elapsed: number;
  newFacts: number;
  notebookOpen: boolean;
  onMenu: () => void;
  onHint: () => void;
  onNotebook: () => void;
  onInquest: () => void;
}

export function TopBar({ ctl, pub, progress, elapsed, newFacts, notebookOpen, onMenu, onHint, onNotebook, onInquest }: TopBarProps) {
  const narrow = layout.value === 'narrow';
  const nbRef = useRef<HTMLButtonElement>(null);
  const bump = ctl.bumpTick.value;
  const hintsUsed = progress?.snapshot?.hintsUsed ?? progress?.hints.length ?? 0;
  const hintTotal = pub?.hintCount ?? 3;
  const hintsLeft = Math.max(0, hintTotal - hintsUsed);
  const asked = progress?.snapshot?.asked ?? 0;
  const facts = progress?.factOrder.length ?? 0;
  const busy = ctl.asking.value || ctl.presenting.value;

  useEffect(() => {
    if (!bump || motionReduced()) return;
    const el = nbRef.current;
    if (!el) return;
    gsap.fromTo(el, { scale: 1.28, rotation: -8 }, { scale: 1, rotation: 0, duration: 0.55, ease: 'elastic.out(1.3, 0.4)' });
  }, [bump]);

  return (
    <div class="ivtop">
      <IconButton icon="menu" label="メニュー" onClick={onMenu} tooltipSide="right" />
      <div class="ivtop__title">
        <span class="ivtop__tags">
          <span class="ivtop__case">CASE {caseNo(pub?.number)}</span>
          <DifficultyBadge difficulty={progress?.difficulty ?? 'normal'} compact={narrow} class="ivtop__diff" />
        </span>
        <span class="ivtop__jp">{pub?.title ?? '……'}</span>
        {!narrow && pub && <span class="ivtop__en">{pub.titleEn}</span>}
      </div>
      <div class="spacer" />
      {!narrow && (
        <dl class="ivtop__stats t-mono" aria-label="捜査の記録">
          <div>
            <dt>QUESTIONS</dt>
            <dd>{String(asked).padStart(2, '0')}</dd>
          </div>
          <div>
            <dt>FINDINGS</dt>
            <dd>
              {String(facts).padStart(2, '0')}
              <small>/{pub?.totalFacts ?? '—'}</small>
            </dd>
          </div>
          <div>
            <dt>ELAPSED</dt>
            <dd>{formatElapsed(elapsed)}</dd>
          </div>
        </dl>
      )}
      <button
        type="button"
        class="ivtop__btn ivtop__hint"
        onClick={onHint}
        aria-label={`ホルマの囁き（ヒント）残り${hintsLeft}回`}
        data-tip={narrow ? undefined : 'ヒント（H）'}
        disabled={ctl.hintBusy.value}
      >
        <Icon name="whisper" size={20} />
        {!narrow && <span class="ivtop__btn-label">ホルマの囁き</span>}
        <span class="ivtop__pips" aria-hidden="true">
          {Array.from({ length: hintTotal }, (_, i) => (
            <span key={i} class={i < hintsLeft ? 'is-on' : ''} />
          ))}
        </span>
      </button>
      <button
        ref={nbRef}
        type="button"
        class={`ivtop__btn ivtop__nb ${notebookOpen ? 'is-open' : ''}`}
        onClick={onNotebook}
        aria-label={`捜査ノート${newFacts ? `（新しい所見 ${newFacts}）` : ''}`}
        aria-expanded={notebookOpen}
        data-tip={narrow ? undefined : '捜査ノート（N）'}
        data-notebook-target={notebookOpen && !narrow ? undefined : ''}
      >
        <Icon name="notebook" size={20} />
        {!narrow && <span class="ivtop__btn-label">捜査ノート</span>}
        {newFacts > 0 && <span class="ivtop__badge">{newFacts}</span>}
      </button>
      {/* Busy (Holma answering): stays at full strength — no per-turn flicker — but ignores
          clicks until the answer is over (onInquest also checks). */}
      <button
        type="button"
        class={`ivtop__inquest ${busy ? 'is-busy' : ''}`}
        onClick={() => !busy && onInquest()}
        aria-disabled={busy || undefined}
        aria-label={busy ? '審問を開く（ホルマの返答のあとで押せます）' : '審問を開く'}
      >
        <span class="ivtop__inquest-bg" aria-hidden="true" />
        <Icon name="gavel" size={20} />
        <span class="ivtop__inquest-label">{narrow ? '審問' : '審問を開く'}</span>
        {!narrow && <span class="ivtop__inquest-en">INQUEST</span>}
      </button>
    </div>
  );
}
