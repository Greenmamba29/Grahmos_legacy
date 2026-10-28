import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// @noble/ed25519 v3 ships without a hash bound and would otherwise reach for crypto.subtle.
ed.hashes.sha512 = sha512;
ed.hashes.sha512Async = async (m: Uint8Array) => sha512(m);

export class KeyMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyMaterialError';
  }
}

const SEED_LEN = 32;
const PUB_LEN = 32;
const SIG_LEN = 64;

export function assertSeed(seed: Uint8Array): void {
  if (seed.length !== SEED_LEN)
    throw new KeyMaterialError(`seed must be ${SEED_LEN} bytes, got ${seed.length}`);
}

export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  assertSeed(seed);
  return ed.getPublicKey(seed);
}

export function sign(message: Uint8Array, seed: Uint8Array): Uint8Array {
  assertSeed(seed);
  return ed.sign(message, seed);
}

/** Verify; malformed key or signature material throws KeyMaterialError rather than returning false. */
export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  if (publicKey.length !== PUB_LEN)
    throw new KeyMaterialError(`public key must be ${PUB_LEN} bytes, got ${publicKey.length}`);
  if (signature.length !== SIG_LEN)
    throw new KeyMaterialError(`signature must be ${SIG_LEN} bytes, got ${signature.length}`);
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function randomSeed(): Uint8Array {
  return ed.utils.randomSecretKey();
}
