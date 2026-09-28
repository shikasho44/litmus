/**
 * 遊び方 page art for 質問枠 (src/overlays/HowTo.tsx): the three modes' counters (with the
 * numbers of an easy case — the actual ones depend on the case) and a sample 「ひとりごと」.
 */
import { questionBudget } from '../../../shared/budget';
import { DIFFICULTY_META } from '../difficulty/meta';
import { HolmaFace } from '../investigation/HolmaFace';
import { Icon } from '../../ui/Icon';
import { budgetFor, chooserText, counterText } from './budget';
import './budget.css';

function Pill({ play, spent }: { play: 'easy' | 'normal' | 'hard'; spent: number }) {
  const v = budgetFor({ difficulty: 1 }, play, spent);
  const t = counterText(v);
  return (
    <span class={`qbudget qbudget--static qbudget--${v.state} qbudget--${v.kind}`}>
      {v.kind === 'hard' && <Icon name="lock" size={11} class="qbudget__lock" />}
      <span class="qbudget__label">{t.label}</span>
      <b class="qbudget__num t-mono">{t.value}</b>
      {t.of && <span class="qbudget__of t-mono">{t.of}</span>}
    </span>
  );
}

export function BudgetHowToArt() {
  const rows = [
    { play: 'easy' as const, spent: 12 },
    { play: 'normal' as const, spent: 31 },
    { play: 'hard' as const, spent: questionBudget(1, 'hard') },
  ];
  return (
    <div class="howto-art howto-budget">
      {rows.map((r) => {
        const b = budgetFor({ difficulty: 1 }, r.play, r.spent);
        const t = chooserText(b);
        return (
          <div class={`howto-budget__row howto-budget__row--${r.play}`} key={r.play}>
            <span class="howto-budget__name">{DIFFICULTY_META[r.play].jp}</span>
            <span class="howto-budget__rule">
              {t.head}
              <small>{t.sub}</small>
            </span>
            <Pill play={r.play} spent={r.spent} />
          </div>
        );
      })}
      <div class="nrow howto-budget__nudge">
        <div class="arow__avatar">
          <HolmaFace mood="normal" size={34} />
        </div>
        <div class="nrow__body">
          <div class="nrow__meta">
            <span class="arow__name">ホルマ</span>
            <span class="nrow__tag">
              <Icon name="whisper" size={12} />
              ひとりごと
            </span>
            <span class="nrow__free">（減点なし）</span>
          </div>
          <p class="nrow__line">まだ訊いていない問いがありますよ。たとえば——「時計は動いていましたか？」</p>
        </div>
      </div>
    </div>
  );
}
