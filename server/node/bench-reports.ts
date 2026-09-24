/**
 * Lists benchmark reports written by `npm run bench` (bench/reports/*.json) for
 * GET /api/admin/bench. Returns [] when the folder does not exist (e.g. on Vercel).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchReportInfo } from '../http/runtime.js';

const MAX_INLINE_BYTES = 2 * 1024 * 1024;

export async function listBenchReports(dir: string): Promise<BenchReportInfo[]> {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out: BenchReportInfo[] = [];
  for (const file of files) {
    try {
      const p = join(dir, file);
      const st = statSync(p);
      let report: unknown = null;
      if (st.size <= MAX_INLINE_BYTES) report = JSON.parse(readFileSync(p, 'utf8'));
      out.push({ file, modified: new Date(st.mtimeMs).toISOString(), size: st.size, report });
    } catch (e) {
      out.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out.sort((a, b) => String(b.modified ?? '').localeCompare(String(a.modified ?? '')));
}
