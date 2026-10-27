/**
 * Signed checkpoints — binding the hash chain to a device identity.
 *
 * The chain alone proves internal consistency: a party who rewrites the WHOLE chain from a
 * tampered point can still produce a valid one. A checkpoint is the device's Ed25519 signature over
 * {deviceId, headHash, count, at}. Anyone holding the pinned device public key can then prove that
 * THIS device vouched for THIS head at THAT time; later rewrites cannot reproduce the signature.
 * Checkpoints ride in the evidence package and (later) in relay envelopes.
 */
import { canonicalize } from '../crypto/canonicalJson.js';
import { fromHex, toHex } from '../crypto/hex.js';
import { KeyMaterialError, publicKeyFromSeed, sign, verify } from '../crypto/ed25519.js';

export interface Checkpoint {
  deviceId: string;
  headHash: string;
  count: number;
  at: string;
  publicKey: string;
  signature: string;
  alg: 'ed25519';
}

export function checkpointPayload(c: Pick<Checkpoint, 'deviceId' | 'headHash' | 'count' | 'at'>): string {
  return canonicalize({ deviceId: c.deviceId, headHash: c.headHash, count: c.count, at: c.at });
}

export function signCheckpoint(input: Pick<Checkpoint, 'deviceId' | 'headHash' | 'count' | 'at'>, seed: Uint8Array): Checkpoint {
  const pub = publicKeyFromSeed(seed);
  const sig = sign(new TextEncoder().encode(checkpointPayload(input)), seed);
  return { ...input, publicKey: toHex(pub), signature: toHex(sig), alg: 'ed25519' };
}

export type CheckpointVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Verify a checkpoint. `trustedKeys` maps deviceId → public key hex; when absent, the checkpoint's
 * embedded key is used and the verdict says so — self-attested, not pinned.
 */
export function verifyCheckpoint(c: Checkpoint, trustedKeys?: Record<string, string>): CheckpointVerdict & { pinned: boolean } {
  const pinnedKey = trustedKeys?.[c.deviceId];
  const key = pinnedKey ?? c.publicKey;
  if (pinnedKey && pinnedKey !== c.publicKey) return { ok: false, pinned: true, reason: 'embedded key differs from the pinned device key' };
  if (c.alg !== 'ed25519') return { ok: false, pinned: !!pinnedKey, reason: `unsupported algorithm ${String(c.alg)}` };
  try {
    const ok = verify(fromHex(c.signature), new TextEncoder().encode(checkpointPayload(c)), fromHex(key));
    return ok ? { ok: true, pinned: !!pinnedKey } : { ok: false, pinned: !!pinnedKey, reason: 'signature does not match' };
  } catch (e) {
    return { ok: false, pinned: !!pinnedKey, reason: e instanceof KeyMaterialError ? `unusable key material: ${e.message}` : String(e) };
  }
}
