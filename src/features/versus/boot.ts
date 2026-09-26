/**
 * Versus entry points loaded on demand (never by the static build):
 *   bootVersus()   main.tsx, before the first render, when this tab has a versus session: a
 *                  reload inside a race puts the race copy back in the slot before any case
 *                  scene reads the save.
 *   versusMenu()   the title: is versus available here, and is this tab in a room?
 */
import { CASE_SCENES, goto, route } from '../../app/router';
import { mountHud } from './Hud';
import { initVersus, resumeRun, vsSession } from './session';
import { VersusError, vsApi } from './client';

export function bootVersus() {
  initVersus(mountHud);
  const s = vsSession.peek();
  const r = route.peek();
  if (!s || !CASE_SCENES.includes(r.scene) || r.params.caseId !== s.caseId) return;
  // a reload inside the race: back into the slot without navigating (the scene is the same)
  if (!resumeRun(false)) goto('versus', {}, { replace: true });
}

let config: Promise<boolean> | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** /api/versus/config, retried a few times: a cold serverless start can take seconds. */
async function fetchEnabled(): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    try {
      return !!(await vsApi.config()).enabled;
    } catch (e) {
      // a definite answer (4xx) is final; network / timeout / 5xx are worth another try
      if (e instanceof VersusError && e.status >= 400 && e.status < 500) return false;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error('versus config unreachable');
}

export async function versusMenu(): Promise<{ enabled: boolean; inRoom: boolean }> {
  initVersus(mountHud);
  config ??= fetchEnabled().catch(() => {
    config = undefined; // try again next time the title opens
    return false;
  });
  const enabled = await config;
  return { enabled: enabled || !!vsSession.peek(), inRoom: !!vsSession.peek() };
}
