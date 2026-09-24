/**
 * Node-only content loader: reads content/cases/<id>/case.json, content/holma-lines.json
 * and content/prologue.json from disk. Used by the Vite plugin (dev + preview), the Vercel
 * function (content/** is shipped via vercel.json includeFiles), scripts and tests.
 *
 * With `watch: true` (dev) the registry is rebuilt whenever a file's mtime/size changes, so
 * editing a case.json takes effect on the next request without restarting anything.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContentRegistry, type RawContent } from '../engine/registry.js';
import type { EnvLike } from '../engine/env.js';

export function resolveContentRoot(env: EnvLike = {}): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    env.CONTENT_ROOT,
    resolve(process.cwd(), 'content'),
    resolve(here, '../../content'),
    resolve(here, '../../../content'),
  ].filter((x): x is string => !!x);
  for (const c of candidates) if (existsSync(join(c, 'cases'))) return c;
  return candidates.find((c) => existsSync(c)) ?? resolve(process.cwd(), 'content');
}

/** Display path relative to the project (content/…). */
function rel(...p: string[]): string {
  return ['content', ...p].join('/');
}

function readJsonFile(path: string): { data?: unknown; error?: string } {
  try {
    let text = readFileSync(path, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    return { data: JSON.parse(text) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function caseDirs(root: string): string[] {
  const dir = join(root, 'cases');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_') && existsSync(join(dir, d.name, 'case.json')))
    .map((d) => d.name)
    .sort();
}

export function readRawContent(root: string): RawContent {
  const cases = caseDirs(root).map((dir) => {
    const r = readJsonFile(join(root, 'cases', dir, 'case.json'));
    return { dir, path: rel('cases', dir, 'case.json'), data: r.data, error: r.error };
  });
  const raw: RawContent = { cases };
  const linesPath = join(root, 'holma-lines.json');
  if (existsSync(linesPath)) {
    const r = readJsonFile(linesPath);
    raw.lines = r.data;
    raw.linesError = r.error;
  }
  const prologuePath = join(root, 'prologue.json');
  if (existsSync(prologuePath)) {
    const r = readJsonFile(prologuePath);
    raw.prologue = r.data;
    raw.prologueError = r.error;
  }
  return raw;
}

function signature(root: string): string {
  const parts: string[] = [];
  const stamp = (p: string) => {
    try {
      const s = statSync(p);
      parts.push(`${p}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${p}:-`);
    }
  };
  for (const d of caseDirs(root)) stamp(join(root, 'cases', d, 'case.json'));
  stamp(join(root, 'holma-lines.json'));
  stamp(join(root, 'prologue.json'));
  return parts.join('|');
}

export function loadRegistry(root: string): ContentRegistry {
  return ContentRegistry.fromRaw(readRawContent(root));
}

/** Registry provider. `watch` → reload on change (dev); otherwise loaded once. */
export function createFsContent(root: string, opts: { watch?: boolean } = {}): () => ContentRegistry {
  let cached: ContentRegistry | undefined;
  let sig = '';
  let checkedAt = 0;
  return () => {
    if (!cached) {
      sig = signature(root);
      cached = loadRegistry(root);
      checkedAt = Date.now();
      reportIssues(cached);
      return cached;
    }
    if (opts.watch && Date.now() - checkedAt > 250) {
      checkedAt = Date.now();
      const s = signature(root);
      if (s !== sig) {
        sig = s;
        cached = loadRegistry(root);
        reportIssues(cached);
      }
    }
    return cached;
  };
}

function reportIssues(reg: ContentRegistry): void {
  const errs = reg.issues.filter((i) => i.level === 'error');
  if (errs.length === 0) return;
  const byPath = new Map<string, number>();
  for (const e of errs) byPath.set(e.path, (byPath.get(e.path) ?? 0) + 1);
  for (const [p, n] of byPath) console.warn(`[janedoe] content: ${p} skipped (${n} error${n > 1 ? 's' : ''}) — run npm run validate`);
}
