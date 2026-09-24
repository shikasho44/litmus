/**
 * Vite plugin that mounts the game API (/api/*) on both `vite` (dev) and `vite preview`.
 *
 *   dev      server.ssrLoadModule('/server/node/handler.ts') → engine edits hot-reload,
 *            case.json edits reload on the next request (content-fs watch).
 *   preview  an internal middleware-mode Vite server is created lazily and used as a module
 *            runner for the same entry (no build step for the server needed).
 *
 * Env: loadEnv(mode, envDir, '') — .env, .env.local, .env.[mode], process.env (wins).
 * dev → APP_ENV=development (admin routes open, traces in responses);
 * preview → APP_ENV=production unless set explicitly.
 *
 * Imports nothing from the engine statically (config bundling must stay light).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, loadEnv, type Plugin, type ViteDevServer } from 'vite';

const ENTRY = '/server/node/handler.ts';
const MAX_BODY = 64 * 1024; // hard cap before the handler's own 8 KB check
const DROP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'expect', 'http2-settings']);

type HandleApi = (req: Request, env: Record<string, string | undefined>) => Promise<Response>;

function isApi(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === '/api' || path.startsWith('/api/');
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | 'too-large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += b.length;
    if (size > MAX_BODY) return 'too-large';
    chunks.push(b);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function bridge(req: IncomingMessage, res: ServerResponse, handle: (r: Request) => Promise<Response>): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || DROP_HEADERS.has(k.toLowerCase())) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  // The socket address is the only trustworthy client IP on a local server.
  headers.set('x-real-ip', req.socket.remoteAddress ?? 'local');
  headers.delete('x-vercel-forwarded-for');
  let body: Uint8Array | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const b = await readBody(req);
    if (b === 'too-large') {
      res.statusCode = 413;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { code: 'bad_request', message: 'request body too large', retryable: false } }));
      return;
    }
    body = b;
  }
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const response = await handle(new Request(url, { method, headers, body: body as BodyInit | undefined }));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

function sendCrash(res: ServerResponse, e: unknown): void {
  console.error('[janedoe] API middleware error', e);
  if (res.headersSent) return void res.end();
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: { code: 'server', message: 'internal error', retryable: true } }));
}

export function janedoeApi(): Plugin {
  let env: Record<string, string> = {};
  let root = process.cwd();
  return {
    name: 'janedoe-api',
    configResolved(config) {
      root = config.root;
      env = loadEnv(config.mode, config.envDir || root, '');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isApi(req.url)) return next();
        (async () => {
          const mod = (await server.ssrLoadModule(ENTRY)) as { handleApi: HandleApi };
          await bridge(req, res, (r) => mod.handleApi(r, { ...env, APP_ENV: env.APP_ENV || 'development', PROJECT_ROOT: root }));
        })().catch((e) => {
          if (e instanceof Error) server.ssrFixStacktrace(e);
          sendCrash(res, e);
        });
      });
    },
    configurePreviewServer(server) {
      let runner: Promise<ViteDevServer> | undefined;
      const getRunner = () =>
        (runner ??= createServer({
          configFile: false,
          root,
          logLevel: 'error',
          appType: 'custom',
          server: { middlewareMode: true, hmr: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
        }));
      server.middlewares.use((req, res, next) => {
        if (!isApi(req.url)) return next();
        (async () => {
          const vs = await getRunner();
          const mod = (await vs.ssrLoadModule(ENTRY)) as { handleApi: HandleApi };
          await bridge(req, res, (r) => mod.handleApi(r, { ...env, APP_ENV: env.APP_ENV || 'production', PROJECT_ROOT: root }));
        })().catch((e) => sendCrash(res, e));
      });
      server.httpServer?.once('close', () => {
        void runner?.then((s) => s.close());
      });
    },
  };
}
