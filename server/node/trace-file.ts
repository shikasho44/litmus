/**
 * Dev-only JSONL trace sink: logs/trace-YYYY-MM-DD.jsonl (one TraceRecord per line).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceRecord, TraceSink } from '../engine/trace.js';

export function createFileTraceSink(dir: string): TraceSink {
  let ready = false;
  return {
    write(r: TraceRecord) {
      if (!ready) {
        mkdirSync(dir, { recursive: true });
        ready = true;
      }
      appendFileSync(join(dir, `trace-${r.at.slice(0, 10)}.jsonl`), JSON.stringify(r) + '\n', 'utf8');
    },
  };
}
