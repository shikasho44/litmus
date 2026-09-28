/**
 * 難易度を選ぶ — the full-screen chooser shown before a case's intro (Files 「解剖を始める」,
 * 「次の事件へ」, a replay) and from the investigation menu ('change', until the inquest opens).
 *
 * Three slanted specimen cards (見習い / 審問官 / 教授) in a radio group: ←→↑↓ move, Enter
 * starts, Esc goes back. Holma comments on the focused card. Reduced motion → a plain fade.
 */
import { gsap } from 'gsap';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../../../shared/api';
import { beginCase } from '../../app/flow';
import type { DifficultyOverlayProps } from '../../app/router';
import { audio } from '../../audio';
import { motionReduced } from '../../fx/motion';
import { caseList } from '../../lib/cases';
import { layout } from '../../lib/viewport';
import { caseDifficulty, getCaseProgress, saveData, setCaseDifficulty } from '../../state/save';
import { Button, IconButton } from '../../ui/Button';
import { portalRoot, useDialog } from '../../ui/dialog';
import { HolmaSprite } from '../../ui/HolmaSprite';
import { toast } from '../../ui/Toast';
import { LightsRow } from './Lights';
import { budgetFor, chooserText, spentOf } from '../budget/budget';
import { Icon } from '../../ui/Icon';
import { canChangeDifficulty, DIFFICULTY_META, DIFFICULTY_ORDER } from './meta';
import './difficulty.css';

export function DifficultyChooser({ open, props, onClose }: { open: boolean; props: DifficultyOverlayProps | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const last = useRef<DifficultyOverlayProps | null>(null);
  if (props) last.current = props;
  const p = props ?? last.current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      audio.sfx('open');
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted || !p) return null;
  return createPortal(<Chooser key={`${p.caseId}:${p.mode}`} p={p} closing={closing} active={open && !closing} onClose={onClose} />, portalRoot());
}

function Chooser({ p, closing, active, onClose }: { p: DifficultyOverlayProps; closing: boolean; active: boolean; onClose: () => void }) {
  const ref = useDialog(active, onClose);
  const [sel, setSel] = useState<Difficulty>(() => caseDifficulty(p.caseId));
  const [busy, setBusy] = useState(false);
  const narrow = layout.value === 'narrow';
  const summary = caseList.value?.find((c) => c.id === p.caseId);
  const progress = saveData.value.cases[p.caseId];
  const locked = p.mode === 'change' && !canChangeDifficulty(progress);
  const current = progress?.difficulty;
  const meta = DIFFICULTY_META[sel];
  const cardsRef = useRef<HTMLDivElement>(null);
  // 質問枠 per mode (shared/budget.ts); while changing mid-investigation, a hard budget already used up is not offered
  const spent = p.mode === 'change' ? spentOf(progress?.snapshot) : 0;
  const budgetOf = (d: Difficulty) => (summary ? budgetFor(summary, d, spent) : null);
  const usedUp = (d: Difficulty) => {
    const b = budgetOf(d);
    return !!b && p.mode === 'change' && b.state === 'closed' && current !== d;
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motionReduced()) {
      const tw = gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25 });
      return () => tw.kill();
    }
    const tl = gsap.timeline();
    tl.fromTo(el.querySelector('.dfc__band'), { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: 'expo.out' }, 0)
      .fromTo(el.querySelectorAll('.dfc__kicker, .dfc__title, .dfc__case'), { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'power3.out' }, 0.08)
      .fromTo(el.querySelectorAll('.dcard'), { y: 60, opacity: 0, rotation: 6 }, { y: 0, opacity: 1, rotation: 0, duration: 0.5, stagger: 0.08, ease: 'back.out(1.6)' }, 0.16)
      .fromTo(el.querySelector('.dfc__foot'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 0.42);
    return () => tl.kill();
  }, []);

  const choose = (d: Difficulty) => {
    if (d === sel) return;
    audio.sfx('toggle');
    setSel(d);
  };

  const confirm = () => {
    if (busy || locked || usedUp(sel)) return;
    setBusy(true);
    audio.sfx('gavel');
    if (p.mode === 'start') {
      // goto() replaces this overlay's history entry: back from the intro returns to the files
      beginCase(p.caseId, sel);
      return;
    }
    const changed = getCaseProgress(p.caseId)?.difficulty !== sel;
    setCaseDifficulty(p.caseId, sel);
    if (changed) toast(`難易度を「${DIFFICULTY_META[sel].jp}」にしました`, { tone: 'success', icon: 'check' });
    onClose();
  };

  /* radio group keys: arrows move (and select), Home/End, Enter confirms */
  const onKey = (e: KeyboardEvent) => {
    const i = DIFFICULTY_ORDER.indexOf(sel);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % 3;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + 2) % 3;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = 2;
    else if (e.key === 'Enter' && !e.isComposing && !e.repeat) {
      e.preventDefault();
      confirm();
      return;
    }
    if (n < 0) return;
    e.preventDefault();
    const d = DIFFICULTY_ORDER[n];
    choose(d);
    requestAnimationFrame(() => cardsRef.current?.querySelector<HTMLElement>(`[data-difficulty="${d}"]`)?.focus());
  };

  const caseNo = summary ? String(summary.number).padStart(2, '0') : '';
  return (
    <div class={`modal-root dfc-root ${closing ? 'is-closing' : ''}`} data-tone="formalin">
      <div class="dfc-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={ref} class={`dfc dfc--${sel}`} role="dialog" aria-modal="true" aria-labelledby="dfc-title" aria-describedby="dfc-desc" tabIndex={-1}>
        <div class="dfc__band" aria-hidden="true">
          <span class="dfc__band-stripes" />
        </div>
        <header class="dfc__head">
          <div class="dfc__titles">
            <p class="dfc__kicker">
              {caseNo && <span class="dfc__caseno">CASE {caseNo}</span>}
              SELECT DIFFICULTY
            </p>
            <h2 id="dfc-title" class="dfc__title">
              {p.mode === 'change' ? '難易度を変える' : '難易度を選ぶ'}
            </h2>
            {summary && <p class="dfc__case">{summary.title}</p>}
          </div>
          <IconButton icon="close" label="戻る" variant="plain" sfx="close" onClick={onClose} class="dfc__close" tooltipSide="left" />
        </header>

        <p id="dfc-desc" class="sr-only">
          難易度によって、死因宣告の答え方と、やり直しできる回数と、質問の数（質問枠）が変わります。
        </p>
        <div ref={cardsRef} class="dfc__cards" role="radiogroup" aria-label="難易度" onKeyDown={onKey}>
          {DIFFICULTY_ORDER.map((d) => {
            const m = DIFFICULTY_META[d];
            const on = d === sel;
            const b = budgetOf(d);
            const bt = b && chooserText(b);
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                class={`dcard dcard--${d} ${on ? 'is-selected' : ''}`}
                data-difficulty={d}
                data-autofocus={on ? true : undefined}
                disabled={locked}
                onClick={() => choose(d)}
              >
                <span class="dcard__slab" aria-hidden="true" />
                {m.recommended && <span class="dcard__rec">おすすめ</span>}
                {current === d && p.mode === 'change' && <span class="dcard__now">いまの難易度</span>}
                <span class="dcard__en" aria-hidden="true">
                  {m.en}
                </span>
                <span class="dcard__jp">{m.jp}</span>
                <span class="dcard__mode">{m.modeJp}</span>
                <span class="dcard__lives">
                  <LightsRow count={m.lives} label={`やり直し ${m.lives}回`} />
                  <b class="t-mono" aria-hidden="true">
                    ×{m.lives}
                  </b>
                </span>
                {bt && (
                  <span class={`dcard__budget ${usedUp(d) ? 'is-used' : ''}`} data-budget-kind={b!.kind}>
                    <Icon name="send" size={13} />
                    <b>{bt.head}</b>
                    <small>{usedUp(d) ? `もう${spent}問使っています` : bt.sub}</small>
                  </span>
                )}
                <span class="dcard__rule">{m.rule}</span>
                <span class="dcard__check" aria-hidden="true">
                  ✔
                </span>
              </button>
            );
          })}
        </div>

        <div class="dfc__foot">
          <div class="dfc__holma" aria-live="polite">
            <div class="dfc__sprite" aria-hidden="true">
              <HolmaSprite mood={sel === 'hard' ? 'laugh' : sel === 'easy' ? 'normal' : 'serious'} framing="bust" idle={false} />
            </div>
            <p class="dfc__bubble">
              <span class="dfc__name">ホルマ</span>
              {locked ? '審問はもう開いています。いまさら椅子は替えられませんよ？' : meta.holma}
            </p>
          </div>
          <div class="dfc__actions">
            <p class="dfc__note">
              {locked
                ? '審問が始まったあとは、難易度を変えられません。'
                : usedUp(sel)
                  ? `この捜査ではもう${spent}問訊いているので、${meta.jp}の質問枠（${budgetOf(sel)?.budget ?? ''}問）には収まりません。`
                  : p.mode === 'change'
                  ? `やり直しの灯は審問の開始時に${meta.lives}つ灯ります。${meta.gameOverRule}`
                  : `${meta.gameOverRule}${narrow ? '' : ' 難易度は、審問が始まる前なら捜査中のメニューから変えられます。'}`}
            </p>
            <div class="dfc__buttons">
              <Button variant="ghost" sfx="cancel" onClick={onClose} icon="back">
                戻る
              </Button>
              <Button variant="big-cta" size="lg" en={`${meta.en}`} iconRight="chevronRight" onClick={confirm} disabled={busy || locked || usedUp(sel)} sfx={false} data-difficulty-confirm>
                {p.mode === 'change' ? 'この難易度にする' : '解剖を始める'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
