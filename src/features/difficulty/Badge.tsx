/** The difficulty badge (investigation / inquest headers, result, files). */
import type { Difficulty } from '../../../shared/api';
import { DIFFICULTY_META } from './meta';
import './difficulty.css';

export function DifficultyBadge({ difficulty, compact, class: cls }: { difficulty: Difficulty; compact?: boolean; class?: string }) {
  const d = DIFFICULTY_META[difficulty];
  return (
    <span class={`dbadge dbadge--${difficulty} ${compact ? 'dbadge--compact' : ''} ${cls ?? ''}`} aria-label={`難易度 ${d.jp}（${d.modeJp}）`} data-difficulty={difficulty}>
      <b class="dbadge__jp" aria-hidden="true">
        {d.jp}
      </b>
      {!compact && (
        <i class="dbadge__en" aria-hidden="true">
          {d.en}
        </i>
      )}
    </span>
  );
}
