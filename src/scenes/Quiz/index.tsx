/**
 * 記憶の定着 (MEMORY CHECK) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `QuizScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function QuizScene({ params }: SceneProps) {
  return <Placeholder en="MEMORY CHECK" jp="記憶の定着" caseId={params.caseId} />;
}
