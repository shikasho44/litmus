/**
 * Room binding of a progress token (online versus, server/versus/*).
 *
 * A versus run is played with an ordinary progress token that additionally carries `room`
 * (`vs` in the payload): `<room code>.<room nonce>.<player id>.<e|n|h>`. The server issues it
 * only when the room starts; every later action keeps it (state updates spread the old state),
 * so a solved token proves the solve happened in THAT room's run of THAT player. Tokens without
 * it (single player, older saves) stay valid everywhere else.
 *
 * The last segment is the room's difficulty: the verdict of a bound run must be declared in that
 * difficulty's format (game.ts), so a player cannot switch to the easier choice verdict mid-race.
 * Pure (no Node API) — part of the engine the embedded build also bundles, but inert there.
 */
import type { Difficulty } from '../../shared/api.js';

export const ROOM_BINDING_PATTERN = /^[A-Z0-9]{4,8}\.[A-Za-z0-9_-]{4,16}\.[a-z0-9]{2,10}\.[enh]$/;
const DIFF: Record<string, Difficulty> = { e: 'easy', n: 'normal', h: 'hard' };
const CODE: Record<Difficulty, string> = { easy: 'e', normal: 'n', hard: 'h' };

export function isRoomBinding(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 64 && ROOM_BINDING_PATTERN.test(v);
}

export function makeRoomBinding(code: string, nonce: string, playerId: string, difficulty: Difficulty): string {
  const b = `${code}.${nonce}.${playerId}.${CODE[difficulty]}`;
  if (!isRoomBinding(b)) throw new Error('invalid room binding');
  return b;
}

export function parseRoomBinding(v: unknown): { code: string; nonce: string; playerId: string; difficulty: Difficulty } | undefined {
  if (!isRoomBinding(v)) return undefined;
  const [code, nonce, playerId, d] = v.split('.');
  return { code, nonce, playerId, difficulty: DIFF[d] };
}

/** The difficulty a bound run is played on (undefined = not a versus run). */
export function roomDifficulty(room: string | undefined): Difficulty | undefined {
  return room ? parseRoomBinding(room)?.difficulty : undefined;
}
