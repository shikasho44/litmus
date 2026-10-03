/**
 * GameApi running the engine in the browser (static build: `vite build --mode static`).
 *
 * Rules mode only, no network. Case files and the line bank are bundled with
 * import.meta.glob, so adding content/cases/<id>/case.json needs no code change here either.
 *
 * NOT SECURE BY DESIGN: every secret (truth, probes, answers) ships in this chunk and the
 * token key is a fixed constant. That is acceptable for offline play / QA only. This module
 * is only ever loaded through a dynamic import that is compiled out of the http build.
 */
import type { GameApi } from '../../shared/api';
import { GameService } from '../../server/engine/game';
import { ContentRegistry, type RawCaseFile } from '../../server/engine/registry';
import { EMBEDDED_SESSION_SECRET } from '../../server/engine/env';
import { TraceRing } from '../../server/engine/trace';
import { PROTOS } from '../config/proto';

const caseFiles = import.meta.glob('../../content/cases/*/case.json', { eager: true, import: 'default' });
const extraFiles = import.meta.glob('../../content/{holma-lines,prologue}.json', { eager: true, import: 'default' });

function buildRegistry(): ContentRegistry {
  const cases: RawCaseFile[] = Object.entries(caseFiles).map(([path, data]) => {
    const parts = path.split('/');
    return { dir: parts[parts.length - 2], path: path.replace(/^(\.\.\/)+/, ''), data };
  });
  const find = (name: string) => Object.entries(extraFiles).find(([p]) => p.endsWith(`/${name}`))?.[1];
  return ContentRegistry.fromRaw({ cases, lines: find('holma-lines.json'), prologue: find('prologue.json') });
}

/** Recent turn traces (dev tools: `__JD_TRACES__()` in the console of a dev static build). */
export const embeddedTraces = new TraceRing(100);

export function createEmbeddedApi(): GameApi {
  const registry = buildRegistry();
  if (import.meta.env.DEV) {
    for (const i of registry.issues) console.warn(`[janedoe] ${i.level}: ${i.path}: ${i.message}`);
    (globalThis as { __JD_TRACES__?: () => unknown }).__JD_TRACES__ = () => embeddedTraces.list();
  }
  const svc = new GameService({
    content: () => registry,
    secret: EMBEDDED_SESSION_SECRET,
    components: { mode: 'rules', warnings: [] },
    dev: import.meta.env.DEV,
    traces: embeddedTraces,
  });
  // Results are cloned so UI code can never mutate the bundled case data.
  const clone = <T>(p: Promise<T>): Promise<T> => p.then((v) => structuredClone(v));
  // the tab's prototype switches (?proto=…): a prototype case exists only with its switch (shared/proto.ts)
  const o = { protos: PROTOS };
  return {
    listCases: () => clone(svc.listCases(o)),
    getCase: (id) => clone(svc.getCase(id, o)),
    newToken: (id) => clone(svc.newToken(id, o)),
    ask: (req) => clone(svc.ask(req, o)),
    hint: (req) => clone(svc.hint(req, o)),
    inquestStart: (req) => clone(svc.inquestStart(req, o)),
    shot: (req) => clone(svc.shot(req, o)),
    grant: (req) => clone(svc.grant(req, o)),
    verdictSetup: (req) => clone(svc.verdictSetup(req, o)),
    verdict: (req) => clone(svc.verdict(req, o)),
    reconstruction: (req) => clone(svc.reconstruction(req, o)),
    submitReconstruction: (req) => clone(svc.submitReconstruction(req, o)),
    solution: (req) => clone(svc.solution(req, o)),
  };
}
