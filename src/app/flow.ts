/** Case flow helpers shared by Title / Files and the case scenes. */
import { batch } from '@preact/signals';
import type { Difficulty } from '../../shared/api';
import { getCaseProgress, resetCase, setCaseDifficulty, setStage, updateMeta } from '../state/save';
import type { CaseStage } from '../state/types';
import { goto, openOverlay, type SceneName } from './router';

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

/** A case that has not started (or was completed) begins a fresh run → the difficulty chooser first. */
export function needsDifficultyChoice(caseId: string): boolean {
  const c = getCaseProgress(caseId);
  return !c || c.stage === 'new' || c.stage === 'complete';
}

/**
 * Open a case where the player left off. A fresh run (new case, or a completed case played
 * again) first shows the difficulty chooser, which then calls beginCase().
 */
export function openCase(caseId: string) {
  updateMeta({ lastCaseId: caseId });
  if (needsDifficultyChoice(caseId)) {
    openOverlay('difficulty', { caseId, mode: 'start' });
    return;
  }
  const c = getCaseProgress(caseId)!;
  goto(sceneForStage(c.stage), { caseId });
}

/**
 * Start a fresh run on the chosen difficulty: a completed case is reset first (resetCase keeps
 * best rank, clear count and the restored name), then the intro plays.
 */
export function beginCase(caseId: string, difficulty: Difficulty) {
  batch(() => {
    if (getCaseProgress(caseId)?.stage === 'complete') resetCase(caseId);
    setCaseDifficulty(caseId, difficulty);
    setStage(caseId, 'intro');
  });
  goto('intro', { caseId });
}
