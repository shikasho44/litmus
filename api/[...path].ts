/**
 * Vercel Node.js function: every /api/* request → the framework-free game API.
 * Web-standard handler signature (Request → Response). Case files are read from
 * content/** which vercel.json ships with the function (includeFiles).
 *
 * Relative imports use explicit .js extensions so the compiled ESM output resolves on Node.
 */
import { handleApi } from '../server/node/handler.js';

const handle = (request: Request): Promise<Response> => handleApi(request, process.env as Record<string, string | undefined>);

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
