import { hashValue } from '../crypto/sha256.js';

/**
 * Tamper-evident log: entry_hash = SHA256(canonical({ ...entry, prev_hash })).
 * Editing or removing any entry breaks every hash after it. Verifiable offline with no server.
 * This is NOT a signature: it proves internal consistency, not authorship (signed checkpoints are a
 * later trust milestone).
 */
export const GENESIS_HASH = 'genesis';

export interface Sealed<T> {
  entry: T;
  prevHash: string;
  hash: string;
}

export function sealEntry<T>(entry: T, prevHash: string): Sealed<T> {
  const prev = prevHash || GENESIS_HASH;
  return { entry, prevHash: prev, hash: hashValue({ entry, prev_hash: prev }) };
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  /** Zero-based index of the first broken link, if any. */
  brokenAt?: number;
  reason?: string;
}

export function verifyChain<T>(chain: ReadonlyArray<Sealed<T>>): ChainVerification {
  let prev = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i]!;
    if (link.prevHash !== prev)
      return { ok: false, count: chain.length, brokenAt: i, reason: 'prev_hash mismatch' };
    const expected = hashValue({ entry: link.entry, prev_hash: link.prevHash });
    if (expected !== link.hash)
      return { ok: false, count: chain.length, brokenAt: i, reason: 'entry hash mismatch' };
    prev = link.hash;
  }
  return { ok: true, count: chain.length };
}

export const headHash = <T>(chain: ReadonlyArray<Sealed<T>>): string =>
  chain.length ? chain[chain.length - 1]!.hash : GENESIS_HASH;
