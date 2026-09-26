/**
 * Room codes, player ids and display names (online versus). Pure — no Node API.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, VERSUS_NAME_MAX } from '../../shared/versus.js';

export type RandomBytes = (n: number) => Uint8Array;

export const cryptoRandom: RandomBytes = (n) => {
  const b = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('no secure random source');
  c.getRandomValues(b);
  return b;
};

/** Uniform pick from `alphabet` (rejection sampling, no modulo bias). */
export function randomString(alphabet: string, length: number, rand: RandomBytes = cryptoRandom): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < length) {
    for (const b of rand(length * 2)) {
      if (b >= limit) continue;
      out += alphabet[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 6 characters from an alphabet without 0/O/1/I/L. */
export function newRoomCode(rand: RandomBytes = cryptoRandom): string {
  return randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, rand);
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** Random lowercase id part (player ids, room nonces). */
export const randomId = (length: number, rand: RandomBytes = cryptoRandom) => randomString(ID_ALPHABET, length, rand);

/**
 * What the player typed → a canonical code, or null. Forgiving about case, full-width letters,
 * spaces and hyphens ("abc-def", "ＡＢＣ　ＤＥＦ"); strict about the alphabet.
 */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const s = input.normalize('NFKC').toUpperCase().replace(/[\s\-_.・]/g, '');
  if (s.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** Characters that render as nothing (fillers, blank braille) on top of the \p{C} categories. */
const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u2800\u034F\u17B4\u17B5\u180E]/g;

/**
 * A display name shown to the other players: NFKC, control / format / private-use characters
 * removed (bidi overrides, zero-width joiners…), whitespace collapsed, trimmed, 1..12 code points.
 * Returns null when nothing printable is left or it is too long.
 */
export function sanitizeName(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 200) return null;
  const s = input
    .normalize('NFKC')
    .replace(/\p{C}/gu, '')
    .replace(INVISIBLE, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const n = [...s].length;
  if (n === 0 || n > VERSUS_NAME_MAX) return null;
  return s;
}
