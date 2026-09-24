/**
 * 審問の記録 (CASE COMPLETE) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `ResultScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function ResultScene({ params }: SceneProps) {
  return <Placeholder en="CASE COMPLETE" jp="審問の記録" caseId={params.caseId} />;
}
