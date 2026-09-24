/**
 * Signed progress token: `j1.<payload base64url>.<HMAC-SHA256 base64url>`.
 *
 * The browser stores it and sends it back on every call; the server trusts nothing
 * else about the player's progress. Signing uses WebCrypto (crypto.subtle — Node 20+
 * and browsers) with a pure-JS fallback for insecure browser contexts (embedded build).
 *
 * Payload (compact JSON):
 *   v  schema version (1)          c  case id
 *   u  unlocked fact ids            m  science memo ids
 *   n  [asked, hintsUsed, debateMisses, grants, verdictAttempts]
 *   rm misses per debate round      r  cleared debate rounds
 *   f  flags bitmask: 1 solved · 2 reconstructed · 4 nearCore
 *   k  spoilerLevel-4 fact ids already confirmed (optional; omitted when empty)
 *   t  issuedAt (epoch seconds)
 */
import { ApiError } from '../../shared/api.js';
import type { GameState } from './state.js';
import { hmacSha256 } from './sha256.js';

export const TOKEN_VERSION = 1;
const PREFIX = 'j1';
/** Tokens are re-issued on every call; an untouched save stays valid this long. */
export const TOKEN_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_CHARS = 6000;
const CLOCK_SKEW_MS = 10 * 60 * 1000;

interface Payload {
  v: number;
  c: string;
  u: string[];
  m: string[];
  n: [number, number, number, number, number];
  rm: Record<string, number>;
  r: string[];
  f: number;
  k?: string[];
  t: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Signer = (msg: Uint8Array) => Promise<Uint8Array>;
const signerCache = new Map<string, Signer>();

function subtle(): SubtleCrypto | undefined {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && c.subtle && typeof c.subtle.importKey === 'function' ? c.subtle : undefined;
}

function getSigner(secret: string): Signer {
  let s = signerCache.get(secret);
  if (s) return s;
  const keyBytes = enc.encode(secret);
  const sub = subtle();
  if (sub) {
    const keyP = sub.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    s = async (msg) => new Uint8Array(await sub.sign('HMAC', await keyP, msg as BufferSource));
  } else {
    s = async (msg) => hmacSha256(keyBytes, msg);
  }
  if (signerCache.size > 16) signerCache.clear();
  signerCache.set(secret, s);
  return s;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toPayload(s: GameState): Payload {
  const p: Payload = {
    v: TOKEN_VERSION,
    c: s.caseId,
    u: s.unlocked,
    m: s.memos,
    n: [s.asked, s.hintsUsed, s.debateMisses, s.grants, s.verdictAttempts],
    rm: s.roundMisses,
    r: s.cleared,
    f: (s.solved ? 1 : 0) | (s.reconstructed ? 2 : 0) | (s.nearCore ? 4 : 0),
    t: Math.floor(s.issuedAt / 1000),
  };
  if (s.coreSeen && s.coreSeen.length > 0) p.k = s.coreSeen;
  return p;
}

const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 400 && x.every((v) => typeof v === 'string' && v.length <= 64);
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1e7;

function fromPayload(p: unknown): GameState {
  if (!p || typeof p !== 'object') throw new Error('payload');
  const o = p as Partial<Payload>;
  if (o.v !== TOKEN_VERSION) throw new Error('version');
  if (typeof o.c !== 'string' || !isStrArr(o.u) || !isStrArr(o.m) || !isStrArr(o.r)) throw new Error('shape');
  if (!Array.isArray(o.n) || o.n.length !== 5 || !o.n.every(isCount)) throw new Error('counters');
  if (!isCount(o.f)) throw new Error('flags');
  if (typeof o.t !== 'number' || !Number.isInteger(o.t) || o.t < 0 || o.t > 1e11) throw new Error('time');
  const rm: Record<string, number> = {};
  if (o.rm && typeof o.rm === 'object') {
    for (const [k, v] of Object.entries(o.rm)) if (isCount(v) && k.length <= 64) rm[k] = v;
  }
  return {
    caseId: o.c,
    unlocked: o.u,
    memos: o.m,
    asked: o.n[0],
    hintsUsed: o.n[1],
    debateMisses: o.n[2],
    grants: o.n[3],
    verdictAttempts: o.n[4],
    roundMisses: rm,
    cleared: o.r,
    solved: (o.f & 1) !== 0,
    reconstructed: (o.f & 2) !== 0,
    nearCore: (o.f & 4) !== 0,
    coreSeen: isStrArr(o.k) ? o.k : [],
    issuedAt: o.t * 1000,
  };
}

/** Signs a state. `issuedAt` is overwritten with `now`. */
export async function signToken(state: GameState, secret: string, now = Date.now()): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(toPayload({ ...state, issuedAt: now }))));
  const msg = `${PREFIX}.${body}`;
  const sig = b64urlEncode(await getSigner(secret)(enc.encode(msg)));
  return `${msg}.${sig}`;
}

const bad = (why: string) => new ApiError('bad_token', `invalid progress token (${why})`, false);

/** Verifies signature, version, case binding and age. Throws ApiError('bad_token'). */
export async function verifyToken(token: unknown, secret: string, expectedCaseId: string, now = Date.now()): Promise<GameState> {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) throw bad('format');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw bad('format');
  const msg = `${parts[0]}.${parts[1]}`;
  const expected = b64urlEncode(await getSigner(secret)(enc.encode(msg)));
  if (!timingSafeEqual(expected, parts[2])) throw bad('signature');
  let state: GameState;
  try {
    state = fromPayload(JSON.parse(dec.decode(b64urlDecode(parts[1]))));
  } catch (e) {
    throw bad(e instanceof Error ? e.message : 'payload');
  }
  if (state.caseId !== expectedCaseId) throw bad('case');
  if (state.issuedAt > now + CLOCK_SKEW_MS) throw bad('future');
  if (now - state.issuedAt > TOKEN_TTL_MS) throw bad('expired');
  return state;
}
