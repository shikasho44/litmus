/**
 * Vercel Node.js function: every /api/* request → the framework-free game API.
 *
 * vercel.json rewrites /api/<anything> to /api/router?__path=<anything>, because plain (non-Next)
 * Vercel functions do not match multi-segment catch-all file names reliably. Here the original
 * path is rebuilt before handing the request to handleApi. Case files are read from content/**,
 * which vercel.json ships with the function (includeFiles).
 *
 * Relative imports use explicit .js extensions so the compiled ESM output resolves on Node.
 */
import { handleApi } from '../server/node/handler.js';

async function restore(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const p = url.searchParams.get('__path');
  if (p === null) return request;
  url.searchParams.delete('__path');
  url.pathname = '/api/' + p.replace(/^\/+/, '');
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  return new Request(url.toString(), { method, headers: request.headers, body });
}

const handle = async (request: Request): Promise<Response> =>
  handleApi(await restore(request), process.env as Record<string, string | undefined>);

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
