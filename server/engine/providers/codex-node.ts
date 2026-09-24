/**
 * Node-only half of the Codex provider (loaded lazily by ./codex.ts — never import statically).
 *
 * app-server transport (default)
 *   One persistent `codex app-server` child, JSON-RPC (newline-delimited JSON, no "jsonrpc"
 *   header) over stdio. Per call: thread/start (ephemeral, read-only sandbox, approval 'never',
 *   the system prompt as baseInstructions, a scratch cwd so no project AGENTS.md is loaded)
 *   → turn/start → collect the last `agentMessage` from item/completed → turn/completed.
 *   Any approval request from the server is declined. The child is restarted on the next call
 *   after it exits, and killed (with its tree on Windows) when the Node process exits.
 * exec transport (fallback)
 *   `codex exec --ephemeral --sandbox read-only -o <file> -` with the prompt on stdin (then
 *   stdin is closed); the answer is read from the --output-last-message file.
 *
 * `-c notify=[]` disables the user's turn-ended notification hook for these sessions.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOptions } from './codex.js';
import { ProviderError, type LlmRequest, type LlmResult } from './types.js';

const now = (): number => performance.now();
const SAFE_ARG = /^[\w.:=\-[\]"/\\ ]+$/;

function quoteWin(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/** Spawns codex. On Windows the npm shim is a .cmd, which Node only runs through the shell. */
function spawnCodex(bin: string, args: string[], cwd?: string): ChildProcess {
  for (const a of [bin, ...args]) if (!SAFE_ARG.test(a)) throw new ProviderError('codex', 'config', 'unsafe codex argument');
  if (process.platform === 'win32') {
    return spawn([bin, ...args].map(quoteWin).join(' '), { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd });
  }
  return spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

let scratch: string | undefined;
function scratchDir(): string {
  if (!scratch) {
    scratch = join(tmpdir(), 'janedoe-codex');
    mkdirSync(scratch, { recursive: true });
  }
  return scratch;
}

function linkSignal(signal: AbortSignal | undefined, timeoutMs: number, onAbort: (why: string) => void): () => void {
  const timer = setTimeout(() => onAbort(`no answer within ${timeoutMs} ms`), timeoutMs);
  const abort = () => onAbort('aborted by caller');
  if (signal) {
    if (signal.aborted) queueMicrotask(abort);
    else signal.addEventListener('abort', abort, { once: true });
  }
  return () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  };
}

/* ------------------------------------------------------------------ */
/* app-server                                                           */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = { id?: number | string; method?: string; params?: any; result?: any; error?: { code?: number; message?: string } };

class AppServer {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
  dead = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<(m: Msg) => void>();
  private stderrTail = '';

  constructor(readonly o: CodexOptions) {
    this.child = spawnCodex(o.bin, ['app-server', '-c', 'notify=[]']);
    this.child.stdout!.setEncoding('utf8');
    createInterface({ input: this.child.stdout! }).on('line', (l) => this.onLine(l));
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (d: string) => {
      this.stderrTail = (this.stderrTail + d).slice(-2000);
    });
    this.child.on('error', (e) => this.die(`spawn failed: ${e.message}`, 'config'));
    this.child.on('exit', (code) => this.die(`codex app-server exited (${code ?? 'signal'})${this.stderrTail ? `: ${this.stderrTail.trim().split('\n').pop()?.slice(0, 160)}` : ''}`, 'network'));
    this.ready = this.request('initialize', { clientInfo: { name: 'janedoe_dev', title: 'janedoe', version: '0.1.0' }, capabilities: { experimentalApi: false, requestAttestation: false } }, 30000).then(() => {
      this.send({ method: 'initialized' });
    });
    this.ready.catch(() => undefined);
  }

  private die(why: string, kind: ProviderError['kind']): void {
    if (this.dead) return;
    this.dead = true;
    const err = new ProviderError('codex', kind, why);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    for (const l of this.listeners) l({ method: '__exit', params: { message: why } });
  }

  private send(m: Msg): void {
    if (this.dead || !this.child.stdin?.writable) throw new ProviderError('codex', 'network', 'codex app-server is not running');
    this.child.stdin.write(`${JSON.stringify(m)}\n`);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 30000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProviderError('codex', 'timeout', `${method}: no response within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send({ id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  on(l: (m: Msg) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private onLine(line: string): void {
    const t = line.trim();
    if (!t.startsWith('{')) return;
    let m: Msg;
    try {
      m = JSON.parse(t);
    } catch {
      return;
    }
    if (m.id !== undefined && m.method === undefined) {
      const p = this.pending.get(Number(m.id));
      if (!p) return;
      this.pending.delete(Number(m.id));
      if (m.error) p.reject(new ProviderError('codex', 'server', `${m.error.message ?? 'error'}`.slice(0, 200)));
      else p.resolve(m.result);
      return;
    }
    if (m.method && m.id !== undefined) {
      this.answerServerRequest(m);
      return;
    }
    if (m.method) for (const l of this.listeners) l(m);
  }

  /** The model must not run tools here: every approval is declined, anything else refused. */
  private answerServerRequest(m: Msg): void {
    let result: unknown;
    switch (m.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        result = { decision: 'decline' };
        break;
      case 'applyPatchApproval':
      case 'execCommandApproval':
        result = { decision: 'abort' };
        break;
      default:
        try {
          this.send({ id: m.id, error: { code: -32601, message: 'not supported by this client' } });
        } catch {
          /* dead */
        }
        return;
    }
    try {
      this.send({ id: m.id, result });
    } catch {
      /* dead */
    }
  }

  kill(): void {
    killTree(this.child);
  }
}

let server: AppServer | undefined;
let exitHook = false;

function getServer(o: CodexOptions): AppServer {
  if (server && !server.dead) return server;
  server = new AppServer(o);
  if (!exitHook) {
    exitHook = true;
    process.once('exit', () => server?.kill());
  }
  return server;
}

/**
 * Setup check that spends no model quota: starts the app-server, initializes, opens and
 * closes an ephemeral thread. Returns the model the thread would use.
 */
export async function pingCodexAppServer(o: CodexOptions): Promise<{ model: string; ms: number }> {
  const t0 = now();
  const srv = getServer(o);
  await srv.ready;
  const started = await srv.request<{ thread: { id: string }; model?: string }>('thread/start', {
    model: o.model ?? null, cwd: scratchDir(), approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: 'ping', ephemeral: true,
  });
  await srv.request('thread/unsubscribe', { threadId: started.thread.id }, 5000).catch(() => undefined);
  return { model: started.model ?? 'unknown', ms: Math.round(now() - t0) };
}

/** Stops the shared app-server child (tests / scripts). */
export function shutdownCodex(): void {
  server?.kill();
  server = undefined;
}

async function appServerComplete(o: CodexOptions, req: LlmRequest): Promise<LlmResult> {
  const t0 = now();
  const srv = getServer(o);
  const timeoutMs = req.timeoutMs ?? o.timeoutMs;
  let threadId = '';
  let turnId = '';
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let failure = '';
  let off: () => void = () => undefined;
  let unlink: () => void = () => undefined;
  try {
    await srv.ready;
    const started = await srv.request<{ thread: { id: string }; model?: string }>(
      'thread/start',
      { model: o.model ?? null, cwd: scratchDir(), approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: req.system, ephemeral: true },
      Math.max(5000, timeoutMs),
    );
    threadId = started.thread.id;
    const model = started.model ?? o.model ?? 'codex';
    const done = new Promise<void>((resolve, reject) => {
      off = srv.on((m) => {
        if (m.method === '__exit') return reject(new ProviderError('codex', 'network', m.params?.message ?? 'app-server exited'));
        if (m.params?.threadId !== threadId) return;
        if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage' && typeof m.params.item.text === 'string') text = m.params.item.text;
        else if (m.method === 'thread/tokenUsage/updated') {
          const u = m.params.tokenUsage?.total ?? m.params.tokenUsage?.last;
          if (u) usage = { inputTokens: Number(u.inputTokens) || 0, outputTokens: (Number(u.outputTokens) || 0) + (Number(u.reasoningOutputTokens) || 0) };
        } else if (m.method === 'error' && m.params.willRetry === false) failure = m.params.error?.message ?? 'turn error';
        else if (m.method === 'turn/completed') {
          const turn = m.params.turn;
          if (turn?.status === 'failed') failure = turn.error?.message ?? failure ?? 'turn failed';
          if (!text && Array.isArray(turn?.items)) {
            const last = [...turn.items].reverse().find((it: { type?: string }) => it?.type === 'agentMessage');
            if (last?.text) text = last.text;
          }
          resolve();
        }
      });
      unlink = linkSignal(req.signal, timeoutMs, (why) => {
        if (turnId) srv.request('turn/interrupt', { threadId, turnId }, 5000).catch(() => undefined);
        reject(new ProviderError('codex', 'timeout', why));
      });
    });
    done.catch(() => undefined);
    const input = [{ type: 'text', text: req.json ? `${req.user}\n\nJSON オブジェクトだけを出力すること。` : req.user, text_elements: [] }];
    const turn = await srv.request<{ turn: { id: string } }>('turn/start', { threadId, input, effort: o.effort }, Math.max(5000, timeoutMs));
    turnId = turn.turn.id;
    await done;
    if (failure) throw new ProviderError('codex', 'server', failure.slice(0, 200));
    return { text: text.trim(), usage: { ...usage, costUsd: 0 }, latencyMs: Math.round(now() - t0), model: `codex:${model}` };
  } finally {
    off();
    unlink();
    if (threadId && !srv.dead) srv.request('thread/unsubscribe', { threadId }, 5000).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* exec                                                                */
/* ------------------------------------------------------------------ */

async function execComplete(o: CodexOptions, req: LlmRequest): Promise<LlmResult> {
  const t0 = now();
  const dir = mkdtempSync(join(tmpdir(), 'janedoe-codex-'));
  const out = join(dir, 'last.txt');
  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-c', 'notify=[]', '-c', `model_reasoning_effort=${o.effort}`, '-C', dir, '-o', out];
  if (o.model) args.push('-m', o.model);
  args.push('-');
  const timeoutMs = req.timeoutMs ?? o.timeoutMs;
  try {
    const child = spawnCodex(o.bin, args, dir);
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => {
      stderr = (stderr + d).slice(-2000);
    });
    child.stdout?.resume();
    const exited = new Promise<number>((resolve, reject) => {
      child.on('error', (e) => reject(new ProviderError('codex', 'config', `spawn failed: ${e.message}`)));
      child.on('exit', (code) => resolve(code ?? -1));
    });
    const prompt = `${req.system}\n\n---\n\n${req.user}${req.json ? '\n\nJSON オブジェクトだけを出力すること。' : ''}`;
    child.stdin?.end(prompt, 'utf8');
    let unlink: () => void = () => undefined;
    const timeout = new Promise<never>((_, reject) => {
      unlink = linkSignal(req.signal, timeoutMs, (why) => {
        killTree(child);
        reject(new ProviderError('codex', 'timeout', why));
      });
    });
    let code: number;
    try {
      code = await Promise.race([exited, timeout]);
    } finally {
      unlink();
    }
    let text = '';
    try {
      text = readFileSync(out, 'utf8');
    } catch {
      /* no answer file */
    }
    if (code !== 0 && !text) throw new ProviderError('codex', 'server', `codex exec exited ${code}: ${stderr.trim().split('\n').pop()?.slice(0, 160) ?? ''}`);
    return { text: text.trim(), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: Math.round(now() - t0), model: `codex:${o.model ?? 'default'}` };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export async function codexComplete(o: CodexOptions, req: LlmRequest): Promise<LlmResult> {
  if (o.model && !/^[\w.-]+$/.test(o.model)) throw new ProviderError('codex', 'config', 'CODEX_MODEL contains unsupported characters');
  if (!/^[\w-]+$/.test(o.effort)) throw new ProviderError('codex', 'config', 'CODEX_EFFORT contains unsupported characters');
  return o.transport === 'exec' ? execComplete(o, req) : appServerComplete(o, req);
}
