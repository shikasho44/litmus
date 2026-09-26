import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api';
import { b64urlDecode, b64urlEncode, signToken, verifyToken } from '../../server/engine/token';
import { hmacSha256 } from '../../server/engine/sha256';
import { initialState } from '../../server/engine/state';
import { makeRoomBinding } from '../../server/engine/room-binding';
import { FIXTURE_ID, SECRET, fixtureCase } from '../engine/helpers';

const now = 1_800_000_000_000;
const enc = new TextEncoder();

/** Signs an arbitrary payload the way token.ts does (to test what verify accepts). */
function signRaw(payload: Record<string, unknown>): string {
  const msg = `j1.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  return `${msg}.${b64urlEncode(hmacSha256(enc.encode(SECRET), enc.encode(msg)))}`;
}

describe('room-bound progress tokens', () => {
  it('carries the binding as `vs` and keeps ordinary tokens as they were', async () => {
    const c = fixtureCase();
    const room = makeRoomBinding('ABC234', 'nonce12345', '1abcde', 'normal');
    const t = await signToken({ ...initialState(c, now), room }, SECRET, now);
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(t.split('.')[1])));
    expect(payload.vs).toBe(room);
    expect((await verifyToken(t, SECRET, FIXTURE_ID, now)).room).toBe(room);
    // no binding → no `vs`, and the state has no room
    const plain = await signToken(initialState(c, now), SECRET, now);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(plain.split('.')[1]))).vs).toBeUndefined();
    expect((await verifyToken(plain, SECRET, FIXTURE_ID, now)).room).toBeUndefined();
  });

  it('a token signed before versus existed (no vs field) still verifies', async () => {
    const t = signRaw({ v: 1, c: FIXTURE_ID, u: ['F01'], m: [], n: [3, 0, 0, 0, 0], rm: {}, r: [], f: 0, t: Math.floor(now / 1000) });
    const s = await verifyToken(t, SECRET, FIXTURE_ID, now);
    expect(s.asked).toBe(3);
    expect(s.room).toBeUndefined();
  });

  it('a malformed binding is a bad token even with a valid signature', async () => {
    for (const vs of ['nope', 42, 'ABC234.n.1abcde.e', 'ABC234.nonce12345.1abcde.x']) {
      const t = signRaw({ v: 1, c: FIXTURE_ID, u: [], m: [], n: [0, 0, 0, 0, 0], rm: {}, r: [], f: 1, vs, t: Math.floor(now / 1000) });
      await expect(verifyToken(t, SECRET, FIXTURE_ID, now)).rejects.toBeInstanceOf(ApiError);
    }
  });
});
