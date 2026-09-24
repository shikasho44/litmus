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
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { RubyText } from '../../ui/ruby';
import { ShardPortrait } from '../../ui/ShardPortrait';
import { StageLayout } from '../../ui/StageLayout';
import './prologue.css';

/**
 * The whole first sentence of a cut-in line — never truncated. 「さァ——解剖（しらべ）を始めましょう」
 * becomes lead 「さァ——」 + main 「解剖（しらべ）を始めましょう」 (CutIn renders the reading as ruby
 * and fits the copy to the screen).
 */
function cutInParts(text: string): { lead?: string; text: string; en: string } {
  const first = text.split(/[。！？!?]/)[0].replace(/[「」『』]/g, '').trim();
  const en = /解剖/.test(first) ? 'LET THE AUTOPSY BEGIN' : 'ROOM ZERO';
  const k = first.indexOf('——');
  if (k > 0 && k + 2 < first.length) return { lead: first.slice(0, k + 2), text: first.slice(k + 2), en };
  return { text: first, en };
}

const STAMP_FX = { 'stamp-yes': 'yes', 'stamp-no': 'no', 'stamp-irrelevant': 'irrelevant' } as const;

/**
 * Where in the line a stamp lands: a line that first quotes a question (『…？』——いいえ。) slams
 * its stamp when the typewriter reaches the answer, not while the question is still typing.
 */
function stampAt(text: string): number {
  if (!text.startsWith('『')) return 0;
  const close = text.indexOf('』');
  const dash = text.indexOf('——', close);
  return dash > 0 ? dash + 2 : close > 0 ? close + 1 : 0;
}

/** Runs a script line's fx / bgm cues (stamps are timed by the DialogueBox cue instead). */
function runCue(line: ScriptLine, mood: Mood, dialogueEl: HTMLElement | null) {
  if (line.bgm) audio.bgm(line.bgm === 'none' ? 'none' : line.bgm);
  switch (line.fx) {
    case 'shake':
      fx.shake(1);
      break;
    case 'flash':
      fx.flash('#FFFFFF', { opacity: 0.6 });
      break;
    case 'cutin': {
      const c = cutInParts(line.text);
      void fx.cutIn({ text: c.text, lead: c.lead, en: c.en, tone: 'formalin', character: line.speaker === 'holma' ? 'holma' : null, mood, hold: 1.1 });
      break;
    }
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

/**
 * Hands-on practice: the line right before the first 「はい」 stamp quotes an example question
 * (『ホルマはウサギですか？』). There the player sends it from a real-looking input dock instead
 * of pressing Enter, and the next line's stamp answers it.
 */
function findPractice(lines: ScriptLine[]): { index: number; question: string } | null {
  for (let k = 0; k < lines.length - 1; k++) {
    if (lines[k + 1].fx !== 'stamp-yes') continue;
    const m = [...lines[k].text.matchAll(/『([^』]+[？?])』/g)].pop();
    return m ? { index: k, question: m[1] } : null;
  }
  return null;
}

/** The line that promises "a finding lights a shard" (after Jane has appeared) lights one. */
function findShardLine(lines: ScriptLine[]): number {
  const jane = lines.findIndex((l) => l.speaker === 'jane');
  if (jane < 0) return -1;
  return lines.findIndex((l, k) => k > jane && l.speaker === 'holma' && /破片/.test(l.text) && /灯/.test(l.text));
}

function PracticeDock({ question, onSend }: { question: string; onSend: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // phones with a large font setting: the dock can open below the fold of the dialogue column
    form.current?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => btn.current?.focus({ preventScroll: true }), 60);
    // Enter / Space sends from anywhere (the dialogue's own advance keys are off meanwhile)
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.isComposing || e.repeat) return;
      if (document.querySelector('.modal-root, .sheet-root')) return;
      e.preventDefault();
      onSend();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <form
      ref={form}
      class="pdock"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <p class="pdock__kicker">
        <span class="pdock__en">TRY IT</span>
        <span>質問を送ってみましょう</span>
      </p>
      <div class="pdock__row">
        {/* a prefilled, read-only "field": a block (not an <input>) so the question wraps on
            narrow phones / large font settings instead of being cut off */}
        <p id="pdock-q" class="pdock__input" aria-label={`練習の質問：${question}`}>
          <span>
            {question}
            <span class="pdock__caret" aria-hidden="true" />
          </span>
        </p>
        <button ref={btn} type="submit" class="pdock__send" aria-describedby="pdock-q">
          <Icon name="send" size={20} />
          <span>送る</span>
        </button>
      </div>
      <p class="pdock__hint">本番では、ここに質問を自由に書きます。</p>
    </form>
  );
}

export function PrologueScene({ params }: SceneProps) {
  const lines = PROLOGUE.lines;
  // ?line=N (via goto('prologue', { line: 'N' })) starts mid-script — QA / debug only.
  const [i, setI] = useState(() => Math.max(0, Math.min(lines.length - 1, Number(params.line) || 0)));
  const [auto, setAuto] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const dlgRef = useRef<HTMLDivElement>(null);
  const line = lines[Math.min(i, lines.length - 1)];
  const practice = useMemo(() => findPractice(lines), [lines]);
  const shardLine = useMemo(() => findShardLine(lines), [lines]);
  const practicing = !!practice && i === practice.index && typed;

  // Holma keeps his last mood until a line changes it.
  const mood = useMemo<Mood>(() => {
    for (let k = i; k >= 0; k--) if (lines[k].speaker === 'holma' && lines[k].mood) return lines[k].mood!;
    return 'normal';
  }, [i]);
  const janeSeen = useMemo(() => lines.slice(0, i + 1).some((l) => l.speaker === 'jane'), [i]);
  const shardsLit = shardLine >= 0 && i >= shardLine ? 1 : 0;

  useEffect(() => {
    setTyped(false);
    if (!lines.some((l) => l.bgm) && i === 0) audio.bgm('title');
    runCue(line, mood, dlgRef.current);
    if (i === shardLine) window.setTimeout(() => audio.sfx('finding'), 260);
  }, [i]);

  const stampCue = useMemo(() => {
    const cls = line.fx && line.fx in STAMP_FX ? STAMP_FX[line.fx as keyof typeof STAMP_FX] : null;
    if (!cls) return undefined;
    // long enough to still be on screen when the line has finished typing
    return { at: stampAt(line.text), run: () => void fx.stamp(cls, { hold: 1.7 }) };
  }, [i]);

  const finish = () => {
    updateMeta({ prologueSeen: true });
    goto('files', {}, { replace: true });
  };

  const advance = () => {
    if (logOpen || practicing) return;
    if (practice && i === practice.index) return; // wait for the practice dock
    if (i >= lines.length - 1) finish();
    else setI(i + 1);
  };

  const send = () => {
    if (!practice) return;
    audio.sfx('send');
    setAsked(practice.question);
    setI(practice.index + 1);
  };

  const speaker = line.speaker;
  const dialogue = (
    <div ref={dlgRef} class={`prologue__dlg ${practicing ? 'is-practice' : ''}`}>
      <DialogueBox
        speaker={speaker}
        text={line.text}
        lineKey={i}
        onAdvance={advance}
        onComplete={() => setTyped(true)}
        auto={auto && !(practice && i === practice.index)}
        glitch={speaker === 'jane'}
        size="lg"
        keyboard={!logOpen && !practicing}
        showNext={!practicing}
        cue={stampCue}
      />
      {practicing && practice && <PracticeDock question={practice.question} onSend={send} />}
    </div>
  );

  return (
    <section class={`scene prologue speaker-${speaker} ${practicing ? 'is-practice' : ''}`}>
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
          <div class="prologue__stage" onClick={() => !practicing && dlgRef.current?.querySelector<HTMLElement>('.dlg')?.click()}>
            <div class={`prologue__letterbox ${speaker === 'narration' ? 'is-on' : ''}`} aria-hidden="true" />
            <div class={`prologue__jane ${janeSeen ? 'is-in' : ''} ${speaker === 'jane' ? 'is-speaking' : ''}`}>
              <ShardPortrait revealed={shardsLit} seed="prologue" label="ジェーン・ドゥの影" glow={speaker === 'jane' || i === shardLine} />
            </div>
            <div class={`prologue__holma ${speaker === 'holma' ? 'is-speaking' : ''} ${speaker === 'narration' && i < 2 ? 'is-hidden' : ''}`}>
              <HolmaSprite mood={mood} talking={speaker === 'holma'} framing={layout.value === 'narrow' ? 'hip' : 'knee'} rim={speaker === 'holma' ? 'rgba(198,255,61,0.28)' : undefined} />
            </div>
            {asked && practice && i === practice.index + 1 && (
              <p class="prologue__asked" aria-hidden="true">
                <span class="prologue__asked-who">審問官</span>
                {asked}
              </p>
            )}
          </div>
        }
        bottom={dialogue}
      />
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="会話ログ" en="BACKLOG" size="md">
        <ol class="backlog">
          {lines.slice(0, i + 1).map((l, k) => (
            <li key={k} class={`backlog__item backlog__item--${l.speaker}`}>
              {SPEAKER_NAME[l.speaker] && <span class="backlog__who">{SPEAKER_NAME[l.speaker]}</span>}
              <p class="backlog__text">
                <RubyText text={l.text} />
              </p>
              {asked && practice && k === practice.index && (
                <p class="backlog__text backlog__text--asked">審問官：{asked}</p>
              )}
            </li>
          ))}
        </ol>
      </Modal>
    </section>
  );
}
