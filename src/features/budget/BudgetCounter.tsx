/**
 * 質問枠の札 — the compact counter on the top edge of the question field (「残り 26/29」).
 * States: ok · low (amber) · zero / over (alarm on 審問官, amber on 見習い) · closed (教授).
 * Sits on the field's border (legend style) so it never covers the typed text or the chat.
 * A tap shows the rule; the number pops when a question is counted (not with reduced motion).
 */
import { gsap } from 'gsap';
import { useEffect, useRef } from 'preact/hooks';
import { motionReduced } from '../../fx/motion';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/Toast';
import { counterText, ruleText, type BudgetView } from './budget';
import './budget.css';

export function BudgetCounter({ view }: { view: BudgetView }) {
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef(view.spent);
  const t = counterText(view);

  useEffect(() => {
    const el = ref.current;
    const changed = view.spent !== prev.current;
    prev.current = view.spent;
    if (!el || !changed || motionReduced()) return;
    const tw = gsap.fromTo(el.querySelector('.qbudget__num'), { scale: 1.45 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' });
    return () => tw.kill();
  }, [view.spent]);

  return (
    <button
      ref={ref}
      type="button"
      class={`qbudget qbudget--${view.state} qbudget--${view.kind}`}
      aria-label={t.aria}
      data-tip={ruleText(view)}
      data-tip-side="top"
      data-budget-state={view.state}
      onClick={() => toast(`${ruleText(view)}。「具体的に」や雑談・ヒントの相談は数えません。`, { icon: 'info', duration: 4200 })}
    >
      {view.kind === 'hard' && <Icon name="lock" size={11} class="qbudget__lock" />}
      <span class="qbudget__label">{t.label}</span>
      <b class="qbudget__num t-mono">{t.value}</b>
      {t.of && <span class="qbudget__of t-mono">{t.of}</span>}
    </button>
  );
}
