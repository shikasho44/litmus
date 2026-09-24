/**
 * 身元回復 (IDENTITY RESTORED) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `ResolutionScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function ResolutionScene({ params }: SceneProps) {
  return <Placeholder en="IDENTITY RESTORED" jp="身元回復" caseId={params.caseId} />;
}
