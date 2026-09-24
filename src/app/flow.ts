/** Case flow helpers shared by Title / Files and the case scenes. */
import { getCaseProgress, resetCase, setStage, updateMeta } from '../state/save';
import type { CaseStage } from '../state/types';
import { goto, type SceneName } from './router';

const STAGE_SCENE: Record<CaseStage, SceneName> = {
  new: 'intro',
  intro: 'intro',
  investigation: 'investigation',
  inquest: 'inquest',
  resolution: 'resolution',
  science: 'science',
  quiz: 'quiz',
  result: 'result',
  complete: 'intro',
};

export function sceneForStage(stage: CaseStage): SceneName {
  return STAGE_SCENE[stage] ?? 'intro';
}

/**
 * Open a case where the player left off. New cases start at the intro; a completed case
 * starts a fresh run (resetCase keeps best rank and clear count).
 */
export function openCase(caseId: string) {
  let c = getCaseProgress(caseId);
  updateMeta({ lastCaseId: caseId });
  if (c?.stage === 'complete') {
    resetCase(caseId);
    c = getCaseProgress(caseId);
  }
  const scene = c ? sceneForStage(c.stage) : 'intro';
  if (!c || c.stage === 'new') setStage(caseId, 'intro');
  goto(scene, { caseId });
}
