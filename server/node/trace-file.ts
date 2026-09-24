/**
 * Dev-only JSONL trace sink: logs/trace-YYYY-MM-DD.jsonl (one TraceRecord per line).
 *
 * Retention: the privacy page promises traces are kept for at most 90 days, so creating the
 * sink (server start / first API request after a config change) deletes trace files whose date
 * is more than TRACE_RETENTION_DAYS old. Only files named trace-YYYY-MM-DD.jsonl are touched.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceRecord, TraceSink } from '../engine/trace.js';

export const TRACE_RETENTION_DAYS = 90;
const TRACE_FILE = /^trace-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes trace-YYYY-MM-DD.jsonl files older than `maxAgeDays` (by the date in the name; the
 * file's mtime when the name holds no valid date). Returns the deleted file names. Never throws.
 */
export function pruneTraceFiles(dir: string, maxAgeDays = TRACE_RETENTION_DAYS, now = Date.now()): string[] {
  const deleted: string[] = [];
  if (!existsSync(dir)) return deleted;
  const cutoff = now - maxAgeDays * DAY_MS;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return deleted;
  }
  for (const name of names) {
    const m = TRACE_FILE.exec(name);
    if (!m) continue;
    const path = join(dir, name);
    try {
      let day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isFinite(day)) day = statSync(path).mtimeMs;
      // A day's file may still receive lines until that day ends.
      if (day + DAY_MS <= cutoff) {
        unlinkSync(path);
        deleted.push(name);
      }
    } catch {
      /* a file we cannot stat or delete is left alone */
    }
  }
  return deleted;
}

export function createFileTraceSink(dir: string, opts: { retentionDays?: number; now?: () => number } = {}): TraceSink {
  const removed = pruneTraceFiles(dir, opts.retentionDays ?? TRACE_RETENTION_DAYS, (opts.now ?? Date.now)());
  if (removed.length > 0) console.warn(`[janedoe] removed ${removed.length} trace file(s) older than ${opts.retentionDays ?? TRACE_RETENTION_DAYS} days`);
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
