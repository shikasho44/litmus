/**
 * The flowing statements of a 反証 (litmus test) round. One band at a time slides in, holds
 * (readable), and gives way to the next; the list loops. Locking a target, pausing, a
 * running dialogue or an open drawer halts the flow. A statement strip lets the player jump.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../../audio';
import { motionReduced } from '../../fx/motion';
import { Icon } from '../../ui/Icon';
import type { InquestSession, Target } from './session';
import { bandPos, StatementBand } from './StatementBand';

export function holdMsFor(chars: number, narrow: boolean) {
  const base = Math.min(8200, Math.max(3600, 2300 + chars * 120));
  return Math.round(base * (narrow ? 1.5 : 1));
}

export interface DebateStageProps {
  session: InquestSession;
  narrow: boolean;
  /** Extra reasons to stop the flow (drawer open, modal …). */
  hold?: boolean;
}

export function DebateStage({ session: s, narrow, hold }: DebateStageProps) {
  const statements = s.statements.value;
  const n = statements.length;
  const current = Math.min(s.current.value, Math.max(0, n - 1));
  const step = s.step.value;
  const target = s.target.value;
  const halted = s.userPaused.value || !!target || step !== 'play' || !!s.dialogue.value || !!hold;
  const interactive = step === 'play' && !s.dialogue.value;
  const [bands, setBands] = useState<{ idx: number; key: number; leaving?: boolean }[]>(() => [{ idx: current, key: 0 }]);
  const keySeq = useRef(0);
  const shown = useRef({ idx: current, key: 0 });
  const timer = useRef({ idx: -1, key: -1, remaining: 0 });
  const roundId = s.round.value?.id;

  // statement change → new band (with the old one leaving)
  useEffect(() => {
    if (shown.current.idx === current && bands.length && !bands[bands.length - 1].leaving) return;
    const prev = shown.current;
    const key = ++keySeq.current;
    shown.current = { idx: current, key };
    // Reduced motion: no slide-out — two statements must never sit on top of each other.
    if (motionReduced()) {
      setBands([{ idx: current, key }]);
      return;
    }
    setBands([{ idx: prev.idx, key: prev.key, leaving: true }, { idx: current, key }]);
    const t = setTimeout(() => setBands((b) => b.filter((x) => !x.leaving)), 480);
    return () => clearTimeout(t);
  }, [current, s.current.value]);

  // new round → fresh band list
  const lastRound = useRef(roundId);
  useEffect(() => {
    if (lastRound.current === roundId) return;
    lastRound.current = roundId;
    const key = ++keySeq.current;
    shown.current = { idx: 0, key };
    setBands([{ idx: 0, key }]);
  }, [roundId]);

  const liveKey = bands.length ? bands[bands.length - 1].key : 0;

  // auto flow (remembers the remaining hold across pauses)
  useEffect(() => {
    if (!n) return;
    const st = statements[current];
    const chars = st ? st.segments.reduce((a, g) => a + [...g.text].length, 0) : 20;
    if (timer.current.idx !== current || timer.current.key !== liveKey) timer.current = { idx: current, key: liveKey, remaining: holdMsFor(chars, narrow) };
    if (halted) return;
    const start = performance.now();
    const t = setTimeout(() => {
      s.current.value = (current + 1) % n;
    }, timer.current.remaining);
    return () => {
      clearTimeout(t);
      timer.current.remaining = Math.max(500, timer.current.remaining - (performance.now() - start));
    };
  }, [current, liveKey, halted, n, narrow]);

  const jump = (i: number) => {
    audio.sfx('page');
    if (i === current) {
      // re-enter the same statement: restart its hold
      const key = ++keySeq.current;
      shown.current = { idx: i, key };
      setBands([{ idx: i, key }]);
      return;
    }
    s.current.value = (i + n) % n;
  };

  const onNoise = (t: Target) => {
    const same = target && target.statementId === t.statementId && target.seg === t.seg;
    audio.sfx(same ? 'cancel' : 'toggle');
    s.setTarget(same ? null : t);
  };

  return (
    <div class={`debate ${halted ? 'is-halted' : ''} ${s.userPaused.value ? 'is-paused' : ''}`} data-step={step}>
      <div class="debate__bands">
        {bands.map((b) => {
          const st = statements[b.idx];
          if (!st) return null;
          const chars = st.segments.reduce((a, g) => a + [...g.text].length, 0);
          return (
            <StatementBand
              key={`${roundId}-${b.key}`}
              statement={st}
              index={b.idx}
              total={n}
              pos={bandPos(b.idx, narrow)}
              leaving={b.leaving}
              holdMs={holdMsFor(chars, narrow)}
              halted={halted}
              target={target}
              broken={s.broken.value}
              interactive={interactive && !b.leaving}
              onNoise={onNoise}
              onTap={() => {
                if (!interactive) return;
                audio.sfx('toggle');
                s.userPaused.value = !s.userPaused.peek();
              }}
            />
          );
        })}
      </div>

      <nav class="debate__nav" aria-label="発言の切り替え">
        <button type="button" class="debate__navbtn" aria-label="前の発言" onClick={() => jump(current - 1)} disabled={!interactive}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <ol class="debate__dots">
          {statements.map((st, i) => (
            <li key={st.id}>
              <button
                type="button"
                class={`debate__dot debate__dot--${st.speaker} ${i === current ? 'is-on' : ''} ${target?.statementId === st.id ? 'is-target' : ''}`}
                aria-label={`発言${i + 1}（${st.speaker === 'jane' ? 'ジェーン・ドゥ' : 'ホルマ'}）`}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => jump(i)}
                disabled={!interactive}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" class="debate__navbtn" aria-label="次の発言" onClick={() => jump(current + 1)} disabled={!interactive}>
          <Icon name="chevronRight" size={18} />
        </button>
        <button
          type="button"
          class={`debate__pause ${s.userPaused.value ? 'is-on' : ''}`}
          aria-pressed={s.userPaused.value}
          aria-label={s.userPaused.value ? '発言を流す' : '一時停止'}
          disabled={!interactive}
          onClick={() => {
            audio.sfx('toggle');
            s.userPaused.value = !s.userPaused.peek();
          }}
        >
          {s.userPaused.value ? <Icon name="play" size={16} /> : <span class="debate__pause-ico" aria-hidden="true" />}
          <span>{s.userPaused.value ? '再開' : '停止'}</span>
        </button>
      </nav>
    </div>
  );
}
