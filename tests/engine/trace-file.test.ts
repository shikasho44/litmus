/**
 * Dev JSONL traces: files older than 90 days are deleted when the sink is created (server start),
 * matching the privacy page's promise. Only trace-YYYY-MM-DD.jsonl files are touched.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileTraceSink, pruneTraceFiles, TRACE_RETENTION_DAYS } from '../../server/node/trace-file';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'janedoe-trace-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 8, 24, 12); // 2026-09-24

describe('trace retention', () => {
  it('deletes trace files older than 90 days and keeps everything else', () => {
    const d = tmp();
    for (const f of ['trace-2026-06-25.jsonl', 'trace-2026-06-26.jsonl', 'trace-2026-01-01.jsonl', 'trace-2026-09-24.jsonl', 'notes.txt', 'trace-latest.jsonl']) writeFileSync(join(d, f), '{}\n');
    expect(TRACE_RETENTION_DAYS).toBe(90);
    const removed = pruneTraceFiles(d, 90, NOW).sort();
    expect(removed).toEqual(['trace-2026-01-01.jsonl', 'trace-2026-06-25.jsonl']);
    expect(readdirSync(d).sort()).toEqual(['notes.txt', 'trace-2026-06-26.jsonl', 'trace-2026-09-24.jsonl', 'trace-latest.jsonl']);
  });

  it('prunes when the sink is created and tolerates a missing directory', () => {
    const d = tmp();
    writeFileSync(join(d, 'trace-2025-01-01.jsonl'), '{}\n');
    const sink = createFileTraceSink(d, { now: () => NOW });
    expect(readdirSync(d)).toEqual([]);
    sink.write({ id: 'x', at: '2026-09-24T12:00:00.000Z', kind: 'ask', caseId: 'c', input: 'q', result: ['yes'], trace: { mode: 'rules', normalized: [], candidates: [], fastPath: true, timings: [], tokens: { input: 0, output: 0 }, costUsd: 0 } });
    expect(readdirSync(d)).toEqual(['trace-2026-09-24.jsonl']);
    expect(pruneTraceFiles(join(d, 'missing'), 90, NOW)).toEqual([]);
  });
});
