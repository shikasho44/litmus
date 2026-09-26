import { describe, expect, it } from 'vitest';
import { newRoomCode, normalizeRoomCode, randomString, sanitizeName } from '../../server/versus/code';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/versus';
import { isRoomBinding, makeRoomBinding, parseRoomBinding, roomDifficulty } from '../../server/engine/room-binding';

describe('room codes', () => {
  it('uses an alphabet without 0/O/1/I/L', () => {
    for (const ch of '0O1IL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('generates 6-character codes from the alphabet only, well spread', () => {
    const seen = new Map<string, number>();
    const codes = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of c) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
        seen.set(ch, (seen.get(ch) ?? 0) + 1);
      }
      codes.add(c);
    }
    expect(codes.size).toBeGreaterThan(2990); // collisions are astronomically rare
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length); // every character shows up
    // rough uniformity: 18000 draws / 31 chars ≈ 580 each
    for (const n of seen.values()) expect(n).toBeGreaterThan(400);
  });

  it('never uses modulo-biased bytes', () => {
    // bytes ≥ 248 (= 256 - 256 % 31) must be skipped, not wrapped
    let calls = 0;
    const rand = (n: number) => {
      calls++;
      return Uint8Array.from({ length: n }, (_, i) => (calls === 1 ? 255 : i));
    };
    expect(randomString('ABC', 3, rand)).toBe('ABC');
  });

  it('normalizes what players type', () => {
    expect(normalizeRoomCode('abcdef')).toBe('ABCDEF');
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normalizeRoomCode('ＡＢＣ２３４')).toBe('ABC234'); // full-width
    expect(normalizeRoomCode('ABC　DEF')).toBe('ABCDEF'); // ideographic space
    expect(normalizeRoomCode('ABCDE')).toBeNull();
    expect(normalizeRoomCode('ABCDEFG')).toBeNull();
    expect(normalizeRoomCode('ABCDE0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode('ABCDEO')).toBeNull();
    expect(normalizeRoomCode('ABCDE1')).toBeNull();
    expect(normalizeRoomCode(123456)).toBeNull();
    expect(normalizeRoomCode('A'.repeat(100))).toBeNull();
  });
});

describe('display names', () => {
  it('trims, collapses whitespace and keeps 1..12 characters', () => {
    expect(sanitizeName('  ホルマ  ')).toBe('ホルマ');
    expect(sanitizeName('a   b')).toBe('a b');
    expect(sanitizeName('ｱｲｳ')).toBe('アイウ'); // NFKC
    expect(sanitizeName('123456789012')).toBe('123456789012');
    expect(sanitizeName('1234567890123')).toBeNull();
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(42)).toBeNull();
  });

  it('strips control, format and invisible characters', () => {
    expect(sanitizeName('ab\u0000c\u0007')).toBe('abc');
    expect(sanitizeName('\u202Eevil\u202C')).toBe('evil'); // bidi override
    expect(sanitizeName('a\u200Bb\u200Dc\uFEFF')).toBe('abc'); // zero-width
    expect(sanitizeName('\u3164\u3164')).toBeNull(); // Hangul filler only
    expect(sanitizeName('line\nbreak')).toBe('linebreak');
    // counted in code points: 12 emoji are fine
    expect(sanitizeName('🐇'.repeat(12))).toBe('🐇'.repeat(12));
  });
});

describe('room binding', () => {
  it('round-trips and carries the difficulty', () => {
    const b = makeRoomBinding('ABC234', 'nonce12345', '1abcde', 'hard');
    expect(isRoomBinding(b)).toBe(true);
    expect(parseRoomBinding(b)).toEqual({ code: 'ABC234', nonce: 'nonce12345', playerId: '1abcde', difficulty: 'hard' });
    expect(roomDifficulty(b)).toBe('hard');
    expect(roomDifficulty(undefined)).toBeUndefined();
    expect(isRoomBinding('ABC234.nonce.1abcde.x')).toBe(false);
    expect(isRoomBinding('abc234.nonce.1abcde.e')).toBe(false);
    expect(isRoomBinding({})).toBe(false);
  });
});
