import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api';
import { b64urlDecode, b64urlEncode, signToken, TOKEN_TTL_MS, verifyToken } from '../../server/engine/token';
import { hmacSha256, sha256 } from '../../server/engine/sha256';
import { initialState } from '../../server/engine/state';
import { fixtureCase, FIXTURE_ID } from './helpers';

const secret = 'unit-test-secret';
const c = fixtureCase();

async function expectBad(p: Promise<unknown>, why?: string) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: ApiError) => {
    expect(e.code).toBe('bad_token');
    if (why) expect(e.message).toContain(why);
  });
}

describe('progress token', () => {
  it('round-trips the full state', async () => {
    const s = { ...initialState(c, 0), unlocked: ['F01', 'F06'], memos: ['M01'], asked: 7, hintsUsed: 2, debateMisses: 3, grants: 1, verdictAttempts: 2, roundMisses: { R1: 2 }, cleared: ['R1'], solved: true, reconstructed: false, nearCore: true };
    const now = 1_800_000_000_000;
    const t = await signToken(s, secret, now);
    expect(t.startsWith('j1.')).toBe(true);
    const back = await verifyToken(t, secret, FIXTURE_ID, now + 1000);
    expect(back).toEqual({ ...s, issuedAt: now });
  });

  it('rejects tampering, other cases, other secrets, garbage and expiry', async () => {
    const now = 1_800_000_000_000;
    const t = await signToken(initialState(c, 0), secret, now);
    const [p, body, sig] = t.split('.');
    // flip the solved flag in the payload
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    payload.f = 1;
    const forged = `${p}.${b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}.${sig}`;
    await expectBad(verifyToken(forged, secret, FIXTURE_ID, now), 'signature');
    await expectBad(verifyToken(t.slice(0, -2) + 'AA', secret, FIXTURE_ID, now), 'signature');
    await expectBad(verifyToken(t, secret, 'c01-other-case', now), 'case');
    await expectBad(verifyToken(t, 'another-secret', FIXTURE_ID, now), 'signature');
    await expectBad(verifyToken('nope', secret, FIXTURE_ID, now));
    await expectBad(verifyToken(undefined, secret, FIXTURE_ID, now));
    await expectBad(verifyToken(t, secret, FIXTURE_ID, now + TOKEN_TTL_MS + 1000), 'expired');
    await expectBad(verifyToken(t, secret, FIXTURE_ID, now - 60 * 60 * 1000), 'future');
  });

  it('pure-JS HMAC matches WebCrypto', async () => {
    const enc = new TextEncoder();
    const key = enc.encode('key-ぴょん');
    const msg = enc.encode('The quick brown fox — 狐');
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const web = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
    expect(b64urlEncode(hmacSha256(key, msg))).toBe(b64urlEncode(web));
    const long = new Uint8Array(200).fill(7); // > block size key
    const k2 = await crypto.subtle.importKey('raw', long, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    expect(b64urlEncode(hmacSha256(long, msg))).toBe(b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', k2, msg))));
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(1000).fill(1)));
    expect(b64urlEncode(sha256(new Uint8Array(1000).fill(1)))).toBe(b64urlEncode(d));
  });
});
