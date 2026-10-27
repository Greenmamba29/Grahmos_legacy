import { describe, expect, it } from 'vitest';
import { signCheckpoint, verifyCheckpoint } from './checkpoint.js';
import { fromHex, toHex } from '../crypto/hex.js';
import { publicKeyFromSeed } from '../crypto/ed25519.js';

const seed = fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');

describe('checkpoint', () => {
  it('signs and verifies, self-attested and pinned', () => {
    const c = signCheckpoint(
      { deviceId: 'dev-A', headHash: 'abc', count: 3, at: '2026-10-27T00:00:00Z' },
      seed,
    );
    expect(verifyCheckpoint(c)).toEqual({ ok: true, pinned: false });
    expect(verifyCheckpoint(c, { 'dev-A': toHex(publicKeyFromSeed(seed)) })).toEqual({
      ok: true,
      pinned: true,
    });
  });
  it('detects a rewritten head or a swapped key', () => {
    const c = signCheckpoint(
      { deviceId: 'dev-A', headHash: 'abc', count: 3, at: '2026-10-27T00:00:00Z' },
      seed,
    );
    expect(verifyCheckpoint({ ...c, headHash: 'abd' }).ok).toBe(false);
    expect(verifyCheckpoint(c, { 'dev-A': 'ff'.repeat(32) }).ok).toBe(false);
  });
});
