/**
 * npm run validate — checks every content/cases/<id>/case.json plus the line bank and the
 * prologue. Exit code 1 when any case has errors (warnings never fail the run).
 *
 *   npm run validate                      all cases under content/
 *   npm run validate -- path/to/case.json one or more files / case folders
 *   npm run validate -- --json            machine-readable report
 *   npm run validate -- --quiet           errors and summary only
 *
 * The checks live in server/engine/validate.ts (shared with GET /api/admin/cases);
 * `validateCase` is re-exported here for scripts that import this file.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCase, type CaseValidation } from '../server/engine/validate.js';
import { LineBank } from '../server/engine/lines.js';
import { formatZodIssues } from '../server/engine/registry.js';
import { ScriptSchema } from '../shared/lines-schema.js';
import { readRawContent, resolveContentRoot } from '../server/node/content-fs.js';

export { validateCase };
export type { CaseValidation };

interface Report {
  cases: CaseValidation[];
  lines: { source: string; issues: string[] };
  prologue: { ok: boolean; issues: string[] };
  ok: boolean;
}

function readCaseArg(p: string): { path: string; data?: unknown; error?: string } {
  const abs = resolve(p);
  const file = existsSync(abs) && statSync(abs).isDirectory() ? join(abs, 'case.json') : abs;
  const shown = relative(process.cwd(), file).replace(/\\/g, '/');
  try {
    let text = readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    return { path: shown, data: JSON.parse(text) };
  } catch (e) {
    return { path: shown, error: e instanceof Error ? e.message : String(e) };
  }
}

export function runValidation(files: string[] = []): Report {
  const root = resolveContentRoot(process.env as Record<string, string | undefined>);
  const raw = readRawContent(root);
  const inputs = files.length > 0 ? files.map(readCaseArg) : raw.cases.map((c) => ({ path: c.path, data: c.data, error: c.error }));
  const cases: CaseValidation[] = inputs.map((i) =>
    i.error !== undefined
      ? { caseId: '(unreadable)', path: i.path, ok: false, errors: [`cannot read/parse JSON: ${i.error}`], warnings: [], info: [] }
      : { ...validateCase(i.data, { path: i.path }), path: i.path },
  );
  for (const c of cases) {
    const dir = c.path?.split('/').slice(-2, -1)[0];
    if (dir && c.caseId !== '(unknown)' && c.caseId !== '(unreadable)' && dir !== c.caseId && files.length === 0) c.warnings.unshift(`folder "${dir}" does not match case id "${c.caseId}"`);
  }
  const ids = new Map<string, number>();
  for (const c of cases) ids.set(c.caseId, (ids.get(c.caseId) ?? 0) + 1);
  for (const c of cases) if ((ids.get(c.caseId) ?? 0) > 1 && !c.caseId.startsWith('(')) c.errors.push(`duplicate case id ${c.caseId} across files`);
  const numbers = new Map<number, string[]>();
  for (const i of inputs) {
    const n = (i.data as { number?: unknown } | undefined)?.number;
    if (typeof n === 'number') numbers.set(n, [...(numbers.get(n) ?? []), i.path]);
  }
  for (const [n, paths] of numbers) if (paths.length > 1) for (const c of cases) if (paths.includes(c.path ?? '')) c.warnings.push(`case number ${n} is used by ${paths.length} cases`);
  for (const c of cases) c.ok = c.errors.length === 0;

  let lines: Report['lines'];
  if (raw.linesError) lines = { source: 'default', issues: [`cannot read holma-lines.json: ${raw.linesError}`] };
  else if (raw.lines === undefined) lines = { source: 'default', issues: ['content/holma-lines.json is missing (built-in lines are used)'] };
  else {
    const bank = LineBank.from(raw.lines);
    lines = { source: bank.info.source, issues: bank.info.issues };
  }
  let prologue: Report['prologue'];
  if (raw.prologueError) prologue = { ok: false, issues: [`cannot read prologue.json: ${raw.prologueError}`] };
  else if (raw.prologue === undefined) prologue = { ok: false, issues: ['content/prologue.json is missing'] };
  else {
    const p = ScriptSchema.safeParse(raw.prologue);
    prologue = p.success ? { ok: true, issues: [] } : { ok: false, issues: formatZodIssues(p.error, 20) };
  }
  return { cases, lines, prologue, ok: cases.every((c) => c.ok) };
}

function print(r: Report, quiet: boolean): void {
  const out: string[] = [];
  const bar = '─'.repeat(72);
  if (r.cases.length === 0) out.push('No cases found under content/cases/*/case.json');
  for (const c of r.cases) {
    out.push(bar);
    out.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.caseId}   ${c.path ?? ''}`);
    for (const e of c.errors) out.push(`  ERROR  ${e}`);
    if (!quiet) {
      for (const w of c.warnings) out.push(`  warn   ${w}`);
      for (const i of c.info) out.push(`  info   ${i}`);
    } else if (c.warnings.length > 0) out.push(`  (${c.warnings.length} warnings hidden)`);
    if (c.stats) {
      const s = c.stats;
      const kinds = Object.entries(s.kinds).map(([k, n]) => `${k}:${n}`).join(' ');
      out.push(`  facts ${s.facts} · probes ${s.probes} (${kinds})`);
      out.push(`  rules self-consistency ${(s.selfConsistency.rate * 100).toFixed(1)}% (${s.selfConsistency.matched}/${s.selfConsistency.total})` + (s.generalization.total > 0 ? ` · leave-one-out ${(s.generalization.rate * 100).toFixed(1)}%` : ''));
    }
  }
  out.push(bar);
  out.push(`LINES  source=${r.lines.source}${r.lines.issues.length ? ` (${r.lines.issues.length} issues)` : ''}`);
  if (!quiet) for (const i of r.lines.issues) out.push(`  warn   ${i}`);
  out.push(`PROLOGUE  ${r.prologue.ok ? 'ok' : 'not usable'}`);
  if (!quiet) for (const i of r.prologue.issues) out.push(`  warn   ${i}`);
  out.push(bar);
  const bad = r.cases.filter((c) => !c.ok).length;
  const warns = r.cases.reduce((n, c) => n + c.warnings.length, 0);
  out.push(`${r.cases.length - bad}/${r.cases.length} cases pass · ${bad} with errors · ${warns} warnings`);
  console.log(out.join('\n'));
}

const isMain = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const report = runValidation(files);
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else print(report, args.includes('--quiet'));
  process.exitCode = report.ok ? 0 : 1;
}
