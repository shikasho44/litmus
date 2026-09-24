/**
 * 事件の導入 (INTRO) — PLACEHOLDER. The scene builder replaces this file.
 * Keep the export name `IntroScene` (registered in src/app/scenes.ts).
 * Props: { params: { caseId } } — see docs/frontend.md "Building a scene".
 */
import type { SceneProps } from '../../app/router';
import { Placeholder } from '../_shared/Placeholder';

export function IntroScene({ params }: SceneProps) {
  return <Placeholder en="INTRO" jp="事件の導入" caseId={params.caseId} />;
}
