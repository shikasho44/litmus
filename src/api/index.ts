/**
 * The one GameApi instance the UI uses. UI code must only import `api` from here and
 * program against the GameApi interface (shared/api.ts).
 *
 *   http      → src/api/http.ts      (/api on the dev server, vite preview, Vercel)
 *   embedded  → src/api/embedded.ts  (static build; engine + cases bundled, rules mode)
 *
 * The choice is a compile-time constant (__JANEDOE_EMBEDDED__, defined in vite.config.ts
 * with the same rule as APP_CONFIG.API_MODE), so in the http build the embedded branch —
 * and with it every case secret — is removed from the bundle entirely.
 */
import type { GameApi } from '../../shared/api';
import { APP_CONFIG } from '../config/app';
import { httpApi } from './http';

declare const __JANEDOE_EMBEDDED__: boolean | undefined;

export const API_MODE: 'http' | 'embedded' =
  typeof __JANEDOE_EMBEDDED__ !== 'undefined' ? (__JANEDOE_EMBEDDED__ ? 'embedded' : 'http') : APP_CONFIG.API_MODE;

function lazyEmbedded(): GameApi {
  let loaded: Promise<GameApi> | undefined;
  const load = () => (loaded ??= import('./embedded').then((m) => m.createEmbeddedApi()));
  const wrap =
    (k: keyof GameApi) =>
    (...args: unknown[]): Promise<unknown> =>
      load().then((a) => (a[k] as (...x: unknown[]) => Promise<unknown>)(...args));
  return {
    listCases: wrap('listCases'),
    getCase: wrap('getCase'),
    newToken: wrap('newToken'),
    ask: wrap('ask'),
    hint: wrap('hint'),
    inquestStart: wrap('inquestStart'),
    shot: wrap('shot'),
    grant: wrap('grant'),
    verdict: wrap('verdict'),
    reconstruction: wrap('reconstruction'),
    submitReconstruction: wrap('submitReconstruction'),
    solution: wrap('solution'),
  } as unknown as GameApi;
}

export const api: GameApi = API_MODE === 'embedded' ? lazyEmbedded() : httpApi;
