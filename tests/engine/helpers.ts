import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaseSchema, type Case } from '../../shared/case-schema';
import { ContentRegistry, type RawContent } from '../../server/engine/registry';
import { GameService, type GameServiceOptions } from '../../server/engine/game';
import { buildCaseIndex } from '../../server/engine/case-index';
import { TraceRing } from '../../server/engine/trace';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = resolve(here, '../fixtures/case-fixture.json');
export const FIXTURE_ID = 'c90-fixture-tent';
export const SECRET = 'test-secret-0123456789';

export function fixtureRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

export function fixtureCase(): Case {
  return CaseSchema.parse(fixtureRaw());
}

export function fixtureIndex() {
  return buildCaseIndex(fixtureCase());
}

export function fixtureRegistry(extra: Partial<RawContent> = {}): ContentRegistry {
  return ContentRegistry.fromRaw({
    cases: [{ dir: FIXTURE_ID, path: 'tests/fixtures/case-fixture.json', data: fixtureRaw() }],
    ...extra,
  });
}

export function makeService(over: Partial<GameServiceOptions> = {}): { svc: GameService; traces: TraceRing; registry: ContentRegistry } {
  const registry = fixtureRegistry();
  const traces = new TraceRing(50);
  const svc = new GameService({
    content: () => registry,
    secret: SECRET,
    components: { mode: 'rules', warnings: [] },
    traces,
    ...over,
  });
  return { svc, traces, registry };
}
