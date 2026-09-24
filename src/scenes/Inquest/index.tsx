/**
 * 死因審問 (INQUEST) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `InquestScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function InquestScene({ params }: SceneProps) {
  return <Placeholder en="INQUEST" jp="死因審問" caseId={params.caseId} />;
}
