import { back, goto } from '../../app/router';
import { caseTitle } from '../../lib/cases';
import { Button } from '../../ui/Button';
import { HolmaSprite } from '../../ui/HolmaSprite';
import './placeholder.css';

/**
 * Temporary panel for scenes another builder implements. Replace the scene's index.tsx
 * body entirely; keep the exported component name.
 */
export function Placeholder({ en, jp, caseId, note }: { en: string; jp: string; caseId?: string; note?: string }) {
  const title = caseId ? caseTitle(caseId) : undefined;
  return (
    <section class="scene placeholder">
      <div class="placeholder__panel">
        <div class="placeholder__holma" aria-hidden="true">
          <HolmaSprite mood="serious" framing="bust" />
        </div>
        <div class="placeholder__body">
          <p class="eyebrow">{en}</p>
          <h1 class="placeholder__title">{jp}</h1>
          {caseId && (
            <p class="placeholder__case t-mono">
              CASE: {caseId}
              {title ? ` ／ ${title}` : ''}
            </p>
          )}
          <p class="placeholder__msg">
            <span class="placeholder__stamp">準備中</span>
            この部屋は、まだ開いていません。{note ?? ''}
          </p>
          <div class="row row--wrap" style={{ marginTop: 18 }}>
            <Button icon="back" variant="ghost" sfx="cancel" onClick={() => back()} data-autofocus>
              戻る
            </Button>
            <Button icon="tag" onClick={() => goto('files')}>
              事件ファイルへ
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
