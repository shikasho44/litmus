/**
 * Coach marks — highlights the real UI element of the current tutorial step (a lit window in a
 * light dim layer) with a short line in Holma's voice. Mounted once by App; reads the route and
 * the DOM (polling every 200 ms while the tutorial runs), so the scenes need no tutorial code.
 *
 * Never blocking: the dim layer lets every click through, the bubble has 「次へ」 and
 * 「スキップ」, and it hides itself while a dialog, sheet, cut-in or title card is up.
 */
import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { route, transitioning } from '../../app/router';
import { audio } from '../../audio';
import { motionReduced } from '../../fx/motion';
import { layout } from '../../lib/viewport';
import { saveData } from '../../state/save';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { toast } from '../../ui/Toast';
import { currentStep, endTutorial, TUT_CHAPTERS, TUT_STEPS, tutorialGoto, tutorialNext, tutorialRunsIn, type TutStepId } from './tutorial';
import './tutorial.css';

interface StepDef {
  title: string;
  text: () => string;
  /** The element to highlight (first match that is visible). */
  target: () => Element | null;
  /** Extra condition before the step shows. */
  ready?: () => boolean;
  next?: string;
}

const $ = (sel: string) => document.querySelector(sel);
const visible = (el: Element | null) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 ? el : null;
};
const first = (...sels: string[]) => {
  for (const s of sels) {
    const all = document.querySelectorAll(s);
    for (let i = all.length - 1; i >= 0; i--) {
      const v = visible(all[i]);
      if (v) return v;
    }
  }
  return null;
};
const narrow = () => layout.peek() === 'narrow';
const invSettled = () => !!$('.iv') && !$('.iv.is-presenting, .flight, .whisper');
const iqAt = (phase: string, extra = '') => !!$(`.iq[data-phase="${phase}"][data-dialogue="off"][data-card="off"]${extra}`);
const verdictMode = () => ($('.vpanel') as HTMLElement | null)?.dataset.verdictMode ?? 'free';

const STEPS: Record<TutStepId, StepDef> = {
  ask: {
    title: '質問してみましょう',
    // 質問の例 cards may not be on the table yet (教授 starts without them)
    text: () => `まずは質問を。「はい／いいえ」で答えられる問いを打って、送信してくださいな。${$('.dock__chip') ? `${narrow() ? '' : '下の'}「質問の例」を押しても構いませんよ。` : ''}`,
    target: () => first('.iv .dock'),
    ready: invSettled,
  },
  stamp: {
    title: '判定スタンプ',
    text: () => '答えはスタンプで。「はい」「いいえ」のほかに、「関係ない」「具体的に」などもあります。私は嘘をつけませんからねェ。',
    target: () => first('.iv .arow[data-answer]'),
    ready: invSettled,
  },
  notebook: {
    title: '所見と捜査ノート',
    text: () => '大事なことを言い当てると「所見カード」が手に入り、この捜査ノートに綴じられます。審問では、それを彼女の記憶に当てて確かめますよ。',
    target: () => (narrow() ? first('.iv .ivtop__nb') : first('.iv .sl__side.is-open', '.iv .ivtop__nb')),
    ready: invSettled,
  },
  shards: {
    title: 'ジェーンの破片',
    text: () => '所見が増えるほど、彼女の破片が灯ります。すべてつながれば……名前が戻りますとも。',
    target: () => first('.iv .ivs__jane'),
    ready: invSettled,
  },
  hints: {
    title: 'ホルマの囁き',
    text: () => '詰まったら、私の囁きを。3回まで、あとになるほど具体的に。ランクには、ほんの少し響きますがねェ。',
    target: () => first('.iv .ivtop__hint'),
    ready: invSettled,
  },
  inquest: {
    title: '審問を開く',
    text: () => '所見が揃ったと思ったら、ここから審問へ。いつ開いても構いません。……続きは、審問の間でお話ししましょう。',
    target: () => first('.iv .ivtop__inquest'),
    ready: invSettled,
    next: 'わかった',
  },
  'noise-target': {
    title: '反証',
    text: () => `彼女の間違った記憶が流れていきます。光る言葉——記憶の誤差を${narrow() ? 'タップ' : '押'}して、選びなさい。`,
    target: () => first('.iq .debate__bands .band:not(.is-leaving)', '.iq .debate__bands'),
    ready: () => iqAt('debate', '[data-step="play"]'),
  },
  'noise-fire': {
    title: 'セットして、当てる',
    text: () => 'その誤差を正せる所見を選んでセットし、「当てる」。正しければ、試験紙のように色が変わります。反応なしなら集中力が減りますが、詰むことはありませんよ。',
    target: () => (narrow() ? first('.iq .iq-dock') : first('.iq .iq-mag')),
    ready: () => iqAt('debate', '[data-step="play"]'),
  },
  'noise-skip': {
    title: '反証は任意',
    text: () => '反証は任意です。反応が出れば死因宣告で手がかりがもらえますし、急ぐなら、ここから宣告へ進めます。',
    target: () => first('.iq [data-skip-debate]'),
    ready: () => iqAt('debate', '[data-step="play"]'),
    next: 'わかった',
  },
  verdict: {
    title: '死因宣告',
    text: () => {
      const m = verdictMode();
      const how =
        m === 'choice'
          ? '選択肢から彼女の死因を選んで「宣告する」。'
          : m === 'cloze'
            ? '文の空欄を押して言葉を選び、全部埋めたら「宣告する」。'
            : '何が起きて、なぜ死んだのか——あなたの言葉で書いて「宣告する」。';
      return `最後に死因宣告。${how}外すと、彼女の灯がひとつ消えますよ。`;
    },
    target: () => first('.iq .vpanel__body'),
    ready: () => iqAt('verdict', '[data-verdict-step="write"]') && !!$('.vpanel__body .vchoice, .vpanel__body .vcloze, .vpanel__body #verdict-text'),
    next: 'はじめる',
  },
};

const BLOCKERS = '.modal-root, .sheet-root, .fx-cutin, .tcard, .susp, .gover, .icc';

interface Placement {
  hole: { x: number; y: number; w: number; h: number };
  /** below / above the lit element, or beside it (right / left) when it is too tall */
  bubble: { x: number; y: number; w: number; side: 'below' | 'above' | 'right' | 'left' };
}

const BUBBLE_H = 200; // approximate bubble height (the real one is measured after render)

function place(el: Element): Placement {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const pad = 6;
  const hole = { x: Math.max(4, r.left - pad), y: Math.max(4, r.top - pad), w: 0, h: 0 };
  hole.w = Math.min(vw - 4, r.right + pad) - hole.x;
  hole.h = Math.min(vh - 4, r.bottom + pad) - hole.y;
  const w = Math.min(380, vw - 24);
  const spaceBelow = vh - (hole.y + hole.h);
  const spaceAbove = hole.y;
  const spaceRight = vw - (hole.x + hole.w);
  const spaceLeft = hole.x;
  if (spaceBelow < BUBBLE_H + 14 && spaceAbove < BUBBLE_H + 14 && Math.max(spaceRight, spaceLeft) >= w + 20) {
    const right = spaceRight >= spaceLeft;
    const x = right ? hole.x + hole.w + 14 : hole.x - 14 - w;
    return { hole, bubble: { x, y: hole.y + hole.h / 2, w, side: right ? 'right' : 'left' } };
  }
  const below = spaceBelow >= BUBBLE_H + 14 || spaceBelow >= spaceAbove;
  const x = Math.max(12, Math.min(vw - w - 12, hole.x + hole.w / 2 - w / 2));
  const y = below ? hole.y + hole.h + 14 : hole.y - 14;
  return { hole, bubble: { x, y, w, side: below ? 'below' : 'above' } };
}

export function CoachMarks() {
  const r = route.value;
  const caseId = r.params.caseId;
  const step = currentStep();
  const inScene = r.scene === 'investigation' || r.scene === 'inquest';
  const runs = !!step && inScene && tutorialRunsIn(caseId);
  const [, setTick] = useState(0);
  const base = useRef<{ id: string; answers: number } | null>(null);

  useEffect(() => {
    if (!runs) return;
    const iv = setInterval(() => setTick((t) => t + 1), 200);
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => {
      clearInterval(iv);
      window.removeEventListener('resize', onResize);
    };
  }, [runs]);

  const answers = caseId ? (saveData.value.cases[caseId]?.log ?? []).filter((e) => e.kind === 'answer').length : 0;
  if (step && base.current?.id !== `${caseId}:${step.id}`) base.current = { id: `${caseId}:${step.id}`, answers };

  // reconcile the step with where the player actually is, and auto-advance
  useEffect(() => {
    if (!runs || !step) return;
    if (r.scene === 'inquest') {
      const iq = $('.iq') as HTMLElement | null;
      const phase = iq?.dataset.phase;
      if (phase === 'reconstruction' || phase === 'finale' || phase === 'done') return void endTutorial();
      if (step.scene === 'investigation') return void tutorialGoto('noise-target');
      if (phase === 'verdict' && step.id !== 'verdict') return void tutorialGoto('verdict');
      if (step.id === 'noise-target' && $('.iq .band .noise.is-target')) return void tutorialNext();
    }
    if (step.id === 'ask' && base.current && answers > base.current.answers) tutorialNext();
  });

  if (!runs || !step) return null;
  if (TUT_STEPS.find((s) => s.id === step.id)?.scene !== r.scene) return null;
  const def = STEPS[step.id];
  if (transitioning.value || $(BLOCKERS) || (def.ready && !def.ready())) return null;
  const target = def.target();
  if (!target) return null;
  return <Coach key={step.id} id={step.id} def={def} target={target} />;
}

function Coach({ id, def, target }: { id: TutStepId; def: StepDef; target: Element }) {
  const p = place(target);
  const bubble = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const idx = TUT_STEPS.findIndex((s) => s.id === id);
  const chapter = TUT_STEPS[idx]?.chapter ?? 1;
  const last = idx === TUT_STEPS.length - 1;

  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    setH(el.getBoundingClientRect().height);
    if (motionReduced()) return;
    const from = p.bubble.side === 'below' ? { y: -10 } : p.bubble.side === 'above' ? { y: 10 } : { x: p.bubble.side === 'right' ? -10 : 10 };
    const tw = gsap.fromTo(el, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, duration: 0.35, ease: 'power3.out' });
    return () => tw.kill();
  }, [id]);

  const vh = window.visualViewport?.height ?? window.innerHeight;
  const side = p.bubble.side;
  let top = side === 'below' ? p.bubble.y : side === 'above' ? p.bubble.y - h : p.bubble.y - h / 2;
  top = Math.max(8, Math.min(vh - h - 8, top));

  const next = () => {
    audio.sfx('page');
    if (last) {
      endTutorial();
      toast('チュートリアル完了。……あとは、あなたの推理で。', { tone: 'success', icon: 'check' });
    } else tutorialNext();
  };
  const skip = () => {
    audio.sfx('cancel');
    endTutorial();
    toast('チュートリアルを閉じました（メニューや「遊び方」から、もう一度見られます）', { icon: 'info' });
  };

  return (
    <div class="coach" data-coach-step={id}>
      {/* the dim: four panes around the lit window (clicks pass through all of them) */}
      <div class="coach__dim" style={{ left: 0, top: 0, right: 0, height: `${p.hole.y}px` }} aria-hidden="true" />
      <div class="coach__dim" style={{ left: 0, top: `${p.hole.y + p.hole.h}px`, right: 0, bottom: 0 }} aria-hidden="true" />
      <div class="coach__dim" style={{ left: 0, top: `${p.hole.y}px`, width: `${p.hole.x}px`, height: `${p.hole.h}px` }} aria-hidden="true" />
      <div class="coach__dim" style={{ left: `${p.hole.x + p.hole.w}px`, top: `${p.hole.y}px`, right: 0, height: `${p.hole.h}px` }} aria-hidden="true" />
      <div class="coach__hole" style={{ left: `${p.hole.x}px`, top: `${p.hole.y}px`, width: `${p.hole.w}px`, height: `${p.hole.h}px` }} aria-hidden="true" />
      <div
        ref={bubble}
        class={`coach__bubble is-${side}`}
        style={{ left: `${p.bubble.x}px`, top: `${top}px`, width: `${p.bubble.w}px` }}
        role="region"
        aria-label="チュートリアル"
      >
        <div class="coach__head">
          <span class="coach__face" aria-hidden="true">
            <HolmaSprite mood={id === 'verdict' || id === 'inquest' ? 'serious' : 'laugh'} framing="bust" idle={false} />
          </span>
          <span class="coach__kicker t-mono">
            TUTORIAL · {chapter}/{TUT_CHAPTERS}
          </span>
          <span class="coach__title">{def.title}</span>
        </div>
        <p class="coach__text" aria-live="polite">
          {def.text()}
        </p>
        <div class="coach__actions">
          <button type="button" class="coach__skip" onClick={skip} data-coach-skip>
            スキップ
          </button>
          <Button size="sm" iconRight={last ? 'check' : 'chevronRight'} sfx={false} onClick={next} data-coach-next>
            {def.next ?? '次へ'}
          </Button>
        </div>
      </div>
    </div>
  );
}
