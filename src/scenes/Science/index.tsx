/**
 * 科学解剖 (SCIENCE AUTOPSY) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `ScienceScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function ScienceScene({ params }: SceneProps) {
  return <Placeholder en="SCIENCE AUTOPSY" jp="科学解剖" caseId={params.caseId} />;
}
