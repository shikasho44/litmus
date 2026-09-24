/**
 * 捜査 (INVESTIGATION) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `InvestigationScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function InvestigationScene({ params }: SceneProps) {
  return <Placeholder en="INVESTIGATION" jp="捜査" caseId={params.caseId} />;
}
