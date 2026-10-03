/**
 * Content registry (pure): turns raw JSON (read from disk by server/node/content-fs.ts, or
 * bundled with import.meta.glob by src/api/embedded.ts) into validated, indexed cases.
 *
 * Adding a case = adding content/cases/<id>/case.json. No code edits.
 * A broken case never takes the server down: it is skipped and reported in `issues`
 * (visible in GET /api/admin/cases and `npm run validate`).
 */
import { CaseSchema, type Case } from '../../shared/case-schema.js';
import { ScriptSchema, type Script } from '../../shared/lines-schema.js';
import { caseVisible } from '../../shared/proto.js';
import { buildCaseIndex, type CaseIndex } from './case-index.js';
import { LineBank } from './lines.js';

export interface RawCaseFile {
  /** Folder name under content/cases (should equal case.id). */
  dir: string;
  /** Display path, e.g. content/cases/c01-x/case.json */
  path: string;
  data?: unknown;
  /** JSON parse / read error. */
  error?: string;
}

export interface RawContent {
  cases: RawCaseFile[];
  lines?: unknown;
  linesError?: string;
  prologue?: unknown;
  prologueError?: string;
}

export interface LoadedCase {
  data: Case;
  index: CaseIndex;
  path: string;
  dir: string;
}

export interface LoadIssue {
  level: 'error' | 'warning';
  path: string;
  caseId?: string;
  message: string;
}

export function formatZodIssues(err: { issues: { path: PropertyKey[]; message: string }[] }, limit = 30): string[] {
  const out = err.issues.slice(0, limit).map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
  if (err.issues.length > limit) out.push(`… and ${err.issues.length - limit} more`);
  return out;
}

export class ContentRegistry {
  private readonly byId: Map<string, LoadedCase>;

  constructor(
    readonly cases: LoadedCase[],
    readonly issues: LoadIssue[],
    readonly lines: LineBank,
    readonly prologue: Script | undefined,
  ) {
    this.byId = new Map(cases.map((c) => [c.data.id, c]));
  }

  static fromRaw(raw: RawContent): ContentRegistry {
    const issues: LoadIssue[] = [];
    const cases: LoadedCase[] = [];
    for (const file of raw.cases) {
      if (file.error !== undefined || file.data === undefined) {
        issues.push({ level: 'error', path: file.path, message: `cannot read case: ${file.error ?? 'empty'}` });
        continue;
      }
      const parsed = CaseSchema.safeParse(file.data);
      if (!parsed.success) {
        const id = (file.data as { id?: unknown })?.id;
        for (const m of formatZodIssues(parsed.error)) issues.push({ level: 'error', path: file.path, caseId: typeof id === 'string' ? id : file.dir, message: m });
        continue;
      }
      const c = parsed.data;
      if (cases.some((x) => x.data.id === c.id)) {
        issues.push({ level: 'error', path: file.path, caseId: c.id, message: `duplicate case id ${c.id} — skipped` });
        continue;
      }
      if (file.dir && file.dir !== c.id) issues.push({ level: 'warning', path: file.path, caseId: c.id, message: `folder "${file.dir}" does not match case id "${c.id}"` });
      try {
        cases.push({ data: c, index: buildCaseIndex(c), path: file.path, dir: file.dir });
      } catch (e) {
        issues.push({ level: 'error', path: file.path, caseId: c.id, message: `index failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    cases.sort((a, b) => a.data.number - b.data.number || a.data.id.localeCompare(b.data.id));

    let lines: LineBank;
    if (raw.linesError) {
      issues.push({ level: 'warning', path: 'content/holma-lines.json', message: `cannot read: ${raw.linesError} — using built-in lines` });
      lines = LineBank.default();
    } else if (raw.lines === undefined) {
      issues.push({ level: 'warning', path: 'content/holma-lines.json', message: 'missing — using built-in lines' });
      lines = LineBank.default();
    } else {
      lines = LineBank.from(raw.lines);
      for (const m of lines.info.issues) issues.push({ level: 'warning', path: 'content/holma-lines.json', message: `${m} (section falls back to built-in lines)` });
    }

    let prologue: Script | undefined;
    if (raw.prologue !== undefined) {
      const p = ScriptSchema.safeParse(raw.prologue);
      if (p.success) prologue = p.data;
      else for (const m of formatZodIssues(p.error, 10)) issues.push({ level: 'warning', path: 'content/prologue.json', message: m });
    } else if (raw.prologueError) {
      issues.push({ level: 'warning', path: 'content/prologue.json', message: `cannot read: ${raw.prologueError}` });
    }

    return new ContentRegistry(cases, issues, lines, prologue);
  }

  /**
   * The cases a caller may see. `includeUnpublished`: dev / admin. `protos`: the prototype switches
   * of the request (shared/proto.ts): a prototype case (case.json `proto`) is there only when its
   * switch is on, whatever `publish` and `includeUnpublished` say — GameService always passes them,
   * so the dev server lists the public cases only unless the switch is on. Without `protos` (tools,
   * tests, the admin catalogue) a prototype counts as unpublished: `list(true)` is every case,
   * `list()` the public ones.
   */
  list(includeUnpublished = false, protos?: readonly string[]): LoadedCase[] {
    return this.cases.filter((c) => caseVisible(c.data, includeUnpublished, protos));
  }

  get(id: string, includeUnpublished = false, protos?: readonly string[]): LoadedCase | undefined {
    const c = this.byId.get(id);
    return c && caseVisible(c.data, includeUnpublished, protos) ? c : undefined;
  }
}
