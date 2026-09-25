/**
 * Node entry: `handleApi(request, env)` — used by the Vite plugin (dev via ssrLoadModule,
 * preview via an internal module runner) and by the Vercel function api/router.ts.
 * Wires the file-system content source, the dev JSONL trace sink (old files pruned on start),
 * the bench listing and the public/ asset check into the pure HTTP handler. The runtime is
 * cached per environment signature.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EnvLike } from '../engine/env.js';
import { isDev } from '../engine/env.js';
import { createApiHandler } from '../http/handler.js';
import { createRuntime, type ApiRuntime } from '../http/runtime.js';
import type { TraceSink } from '../engine/trace.js';
import { createFsContent, resolveContentRoot } from './content-fs.js';
import { createFileTraceSink } from './trace-file.js';
import { listBenchReports } from './bench-reports.js';

const ENV_KEYS = [
  'APP_ENV', 'NODE_ENV', 'PIPELINE_MODE', 'DECISION_PROVIDER', 'LLM_PROVIDER', 'LLM_MODEL', 'JEV_MODEL',
  'DAILY_COST_LIMIT_USD', 'SESSION_SECRET', 'ADMIN_TOKEN', 'OPENROUTER_API_KEY', 'CONTENT_ROOT', 'QUESTION_CAP', 'PROJECT_ROOT',
];

interface Cached {
  sig: string;
  runtime: ApiRuntime;
  handler: (req: Request) => Promise<Response>;
}
let cached: Cached | undefined;

function envSignature(env: EnvLike): string {
  // Values are only compared in memory, never logged.
  return ENV_KEYS.map((k) => `${k}=${env[k] ?? ''}`).join('\n');
}

export function getRuntime(env: EnvLike = process.env as EnvLike): { runtime: ApiRuntime; handler: (req: Request) => Promise<Response> } {
  const sig = envSignature(env);
  if (cached && cached.sig === sig) return cached;
  const dev = isDev(env);
  const projectRoot = env.PROJECT_ROOT ?? process.cwd();
  const contentRoot = resolveContentRoot(env);
  const sinks: TraceSink[] = [];
  if (dev && env.TRACE_FILE !== '0') sinks.push(createFileTraceSink(resolve(projectRoot, 'logs')));
  const runtime = createRuntime({
    env,
    content: createFsContent(contentRoot, { watch: dev }),
    sinks,
    listBenchReports: () => listBenchReports(resolve(projectRoot, 'bench', 'reports')),
    assetExists: (p) => existsSync(join(resolve(contentRoot, '..', 'public'), p)),
  });
  cached = { sig, runtime, handler: createApiHandler(runtime) };
  return cached;
}

/** Framework-free API entry for Node hosts. */
export async function handleApi(request: Request, env: EnvLike = process.env as EnvLike): Promise<Response> {
  return getRuntime(env).handler(request);
}
