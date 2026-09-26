/**
 * The current case run when it is NOT the player's ordinary single-player run — today only the
 * online versus race (src/features/versus, http build only). null = single player, as always.
 *
 * The case scenes stay mode-agnostic; they consult this at the few points where such a run
 * behaves differently:
 *   newToken        where a fresh progress token comes from (versus: a room-bound run token)
 *   lockDifficulty  the difficulty is fixed by the room (menu / chooser cannot change it)
 *   gameOver        the last light ends the run for good (no restart): the game-over screen shows
 *                   `text` and a single way out (`action` → `onExit`)
 *   release         the title calls it before reading the save: the run leaves memory and the
 *                   player's own progress is back in place
 * Generic on purpose: nothing mode-specific ships in builds where the mode cannot run.
 */
import { signal } from '@preact/signals';
import type { ProgressSnapshot, ProgressToken } from '../../shared/api';

export interface CaseRunMode {
  caseId: string;
  newToken?: () => Promise<{ token: ProgressToken; progress: ProgressSnapshot }>;
  lockDifficulty?: boolean;
  gameOver?: { text: string; action: string; en?: string; onExit: () => void };
  release?: () => void;
}

export const caseRunMode = signal<CaseRunMode | null>(null);

/** The special run mode of this case, if one is active (non-reactive read). */
export function runModeOf(caseId: string | undefined): CaseRunMode | null {
  const m = caseRunMode.peek();
  return m && caseId && m.caseId === caseId ? m : null;
}
