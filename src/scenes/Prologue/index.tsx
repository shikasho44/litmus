import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Mood, ScriptLine } from '../../../shared/lines-schema';
import { goto, type SceneProps } from '../../app/router';
import { audio } from '../../audio';
import { fx } from '../../fx';
import { PROLOGUE } from '../../lib/lines';
import { layout } from '../../lib/viewport';
import { updateMeta } from '../../state/save';
import { Button, IconButton } from '../../ui/Button';
import { DialogueBox, SPEAKER_NAME } from '../../ui/DialogueBox';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { Modal } from '../../ui/Modal';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { StageLayout } from '../../ui/StageLayout';
import './prologue.css';

function cutInText(text: string): string {
  const first = text.split(/[。！？!?]/)[0].replace(/[「」『』]/g, '').trim();
  return first.length <= 16 ? first : first.slice(0, 15) + '…';
}

/** Runs a script line's fx / bgm cues. */
function runCue(line: ScriptLine, mood: Mood, dialogueEl: HTMLElement | null) {
  if (line.bgm) audio.bgm(line.bgm === 'none' ? 'none' : line.bgm);
  switch (line.fx) {
    case 'shake':
      fx.shake(1);
      break;
    case 'flash':
      fx.flash('#FFFFFF', { opacity: 0.6 });
      break;
    case 'stamp-yes':
      void fx.stamp('yes', { hold: 0.9 });
      break;
    case 'stamp-no':
      void fx.stamp('no', { hold: 0.9 });
      break;
    case 'stamp-irrelevant':
      void fx.stamp('irrelevant', { hold: 0.9 });
      break;
    case 'cutin':
      void fx.cutIn({ text: cutInText(line.text), en: 'ROOM ZERO', tone: 'formalin', character: line.speaker === 'holma' ? 'holma' : null, mood });
      break;
    case 'glitch':
      fx.glitch(dialogueEl);
      audio.sfx('error');
      break;
    case 'gavel':
      audio.sfx('gavel');
      fx.shake(0.7);
      break;
    case 'heartbeat':
      fx.pulse('alarm');
      break;
  }
}

export function PrologueScene({ params }: SceneProps) {
  const lines = PROLOGUE.lines;
  // ?line=N (via goto('prologue', { line: 'N' })) starts mid-script — QA / debug only.
  const [i, setI] = useState(() => Math.max(0, Math.min(lines.length - 1, Number(params.line) || 0)));
  const [auto, setAuto] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const dlgRef = useRef<HTMLDivElement>(null);
  const line = lines[Math.min(i, lines.length - 1)];

  // Holma keeps his last mood until a line changes it.
  const mood = useMemo<Mood>(() => {
    for (let k = i; k >= 0; k--) if (lines[k].speaker === 'holma' && lines[k].mood) return lines[k].mood!;
    return 'normal';
  }, [i]);
  const janeSeen = useMemo(() => lines.slice(0, i + 1).some((l) => l.speaker === 'jane'), [i]);

  useEffect(() => {
    if (!lines.some((l) => l.bgm) && i === 0) audio.bgm('title');
    runCue(line, mood, dlgRef.current);
  }, [i]);

  const finish = () => {
    updateMeta({ prologueSeen: true });
    goto('files', {}, { replace: true });
  };

  const advance = () => {
    if (logOpen) return;
    if (i >= lines.length - 1) finish();
    else setI(i + 1);
  };

  const speaker = line.speaker;
  const dialogue = (
    <div ref={dlgRef} class="prologue__dlg">
      <DialogueBox speaker={speaker} text={line.text} lineKey={i} onAdvance={advance} auto={auto} glitch={speaker === 'jane'} size="lg" keyboard={!logOpen} />
    </div>
  );

  return (
    <section class={`scene prologue speaker-${speaker}`}>
      <StageLayout
        cinematic
        background={PROLOGUE.background}
        tone={speaker === 'jane' ? 'cyan' : 'formalin'}
        top={
          <div class="topbar prologue__top">
            <div class="topbar__title">
              <span class="topbar__en">PROLOGUE</span>
              <span class="topbar__jp">零番安置室</span>
            </div>
            <div class="spacer" />
            <span class="prologue__count t-mono" aria-label={`${i + 1} / ${lines.length}`}>
              {String(i + 1).padStart(2, '0')}/{String(lines.length).padStart(2, '0')}
            </span>
            <IconButton icon="log" label="ログ" onClick={() => setLogOpen(true)} />
            <IconButton icon="auto" label={auto ? 'オート（オン）' : 'オート'} pressed={auto} onClick={() => setAuto(!auto)} />
            <Button variant="ghost" size="sm" icon="skip" sfx="cancel" onClick={finish}>
              スキップ
            </Button>
          </div>
        }
        stage={
          <div class="prologue__stage" onClick={() => dlgRef.current?.querySelector<HTMLElement>('.dlg')?.click()}>
            <div class={`prologue__letterbox ${speaker === 'narration' ? 'is-on' : ''}`} aria-hidden="true" />
            <div class={`prologue__jane ${janeSeen ? 'is-in' : ''} ${speaker === 'jane' ? 'is-speaking' : ''}`}>
              <ShardPortrait revealed={0} seed="prologue" label="ジェーン・ドゥの影" glow={speaker === 'jane'} />
            </div>
            <div class={`prologue__holma ${speaker === 'holma' ? 'is-speaking' : ''} ${speaker === 'narration' && i < 2 ? 'is-hidden' : ''}`}>
              <HolmaSprite mood={mood} talking={speaker === 'holma'} framing={layout.value === 'narrow' ? 'hip' : 'knee'} rim={speaker === 'holma' ? 'rgba(198,255,61,0.28)' : undefined} />
            </div>
          </div>
        }
        bottom={dialogue}
      />
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="会話ログ" en="BACKLOG" size="md">
        <ol class="backlog">
          {lines.slice(0, i + 1).map((l, k) => (
            <li key={k} class={`backlog__item backlog__item--${l.speaker}`}>
              {SPEAKER_NAME[l.speaker] && <span class="backlog__who">{SPEAKER_NAME[l.speaker]}</span>}
              <p class="backlog__text">{l.text}</p>
            </li>
          ))}
        </ol>
      </Modal>
    </section>
  );
}
