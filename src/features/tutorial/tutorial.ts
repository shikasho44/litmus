/**
 * The coach-mark tutorial (first play of CASE 01; replayable from the menu / 遊び方 / 設定).
 *
 * State lives in the save (meta.tutorial). Steps belong to a scene; CoachMarks (mounted once by
 * App) shows the current step when its scene is on screen and its target element exists.
 * Nothing here ever blocks the game: the dim layer lets every click through, each step has
 * 「次へ」 and 「スキップ」, and steps that ask for an action also advance on their own.
 */
import { computed } from '@preact/signals';
import { saveData, updateMeta } from '../../state/save';
import type { TutorialState } from '../../state/types';

export type TutStepId = 'ask' | 'stamp' | 'notebook' | 'shards' | 'hints' | 'inquest' | 'noise-target' | 'noise-fire' | 'noise-skip' | 'verdict';

/** Order of the steps. `chapter` = the number shown (1..7). */
export const TUT_STEPS: { id: TutStepId; scene: 'investigation' | 'inquest'; chapter: number }[] = [
  { id: 'ask', scene: 'investigation', chapter: 1 },
  { id: 'stamp', scene: 'investigation', chapter: 2 },
  { id: 'notebook', scene: 'investigation', chapter: 2 },
  { id: 'shards', scene: 'investigation', chapter: 3 },
  { id: 'hints', scene: 'investigation', chapter: 4 },
  { id: 'inquest', scene: 'investigation', chapter: 5 },
  { id: 'noise-target', scene: 'inquest', chapter: 6 },
  { id: 'noise-fire', scene: 'inquest', chapter: 6 },
  { id: 'noise-skip', scene: 'inquest', chapter: 6 },
  { id: 'verdict', scene: 'inquest', chapter: 7 },
];
export const TUT_CHAPTERS = 7;

const OFF: TutorialState = { state: 'off', step: 0 };
export const tutorial = computed<TutorialState>(() => saveData.value.meta.tutorial ?? OFF);

const isFirstCase = (caseId: string | undefined) => !!caseId && /^c01(-|$)/.test(caseId);

/** The tutorial runs in this case right now. */
export function tutorialRunsIn(caseId: string | undefined): boolean {
  const t = tutorial.value;
  return t.state === 'on' && (!!t.anyCase || isFirstCase(caseId));
}

/** First play of CASE 01 → start. A player who already questioned in CASE 01 is not interrupted. */
export function maybeStartTutorial(caseId: string) {
  const t = saveData.peek().meta.tutorial;
  if (t && t.state !== 'off') return;
  if (!isFirstCase(caseId)) return;
  const c = saveData.peek().cases[caseId];
  if (c?.log.some((e) => e.kind === 'question') || c?.inquest) {
    updateMeta({ tutorial: { state: 'done', step: 0 } });
    return;
  }
  updateMeta({ tutorial: { state: 'on', step: 0 } });
}

/** Replay (menu / 遊び方 / 設定): runs in whichever case is played next. */
export function replayTutorial() {
  updateMeta({ tutorial: { state: 'on', step: 0, anyCase: true } });
}

export function tutorialGoto(id: TutStepId) {
  const i = TUT_STEPS.findIndex((s) => s.id === id);
  if (i < 0) return;
  const t = tutorial.peek();
  if (t.state !== 'on' || t.step === i) return;
  updateMeta({ tutorial: { ...t, step: i } });
}

export function tutorialNext() {
  const t = tutorial.peek();
  if (t.state !== 'on') return;
  if (t.step + 1 >= TUT_STEPS.length) endTutorial();
  else updateMeta({ tutorial: { ...t, step: t.step + 1 } });
}

export function endTutorial() {
  updateMeta({ tutorial: { state: 'done', step: 0 } });
}

export function currentStep() {
  const t = tutorial.value;
  return t.state === 'on' ? TUT_STEPS[Math.min(t.step, TUT_STEPS.length - 1)] : null;
}
