import { describe, expect, it } from 'vitest';
import { canonicalize, CanonicalizationError } from './canonicalJson.js';
import { sha256Hex, hashValue } from './sha256.js';
import { fromHex, toHex } from './hex.js';
import { publicKeyFromSeed, sign, verify, KeyMaterialError } from './ed25519.js';

describe('canonicalize', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalize({ b: 1, a: { z: [1, { y: 2, x: undefined }], w: 'é' } })).toBe(
      '{"a":{"w":"é","z":[1,{"y":2}]},"b":1}',
    );
  });
  it('serialises dates as ISO strings', () => {
    expect(canonicalize({ t: new Date('2026-01-01T00:00:00.000Z') })).toBe(
      '{"t":"2026-01-01T00:00:00.000Z"}',
    );
  });
  it('refuses non-JSON', () => {
    expect(() => canonicalize({ f: () => 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
  });
});

describe('sha256', () => {
  it('matches the known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('hashValue is key-order independent', () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
  });
});

describe('hex', () => {
  it('round-trips', () => {
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
    expect(() => fromHex('abc')).toThrow();
  });
});

describe('ed25519', () => {
  const seed = fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  it('derives the RFC 8032 test public key and verifies a signature', () => {
    const pub = publicKeyFromSeed(seed);
    expect(toHex(pub)).toBe('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
    const msg = new TextEncoder().encode('terranova');
    const sig = sign(msg, seed);
    expect(verify(sig, msg, pub)).toBe(true);
    sig[0] ^= 1;
    expect(verify(sig, msg, pub)).toBe(false);
  });
  it('rejects malformed material loudly', () => {
    expect(() => verify(new Uint8Array(64), new Uint8Array(1), new Uint8Array(5))).toThrow(
      KeyMaterialError,
    );
  });
});
