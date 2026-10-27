import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { toHex } from './hex.js';
import { canonicalize } from './canonicalJson.js';

const enc = new TextEncoder();

/**
 * SHA-256, synchronous and runtime-independent.
 *
 * Deliberately NOT crypto.subtle: it is undefined on a plain-http origin, which is exactly what an
 * offline facility console served from `http://192.168.x.x` looks like. One bundled backend means
 * a pack that verifies on a laptop also verifies on the facility box.
 */
export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return nobleSha256(typeof data === 'string' ? enc.encode(data) : data);
}

export function sha256Hex(data: Uint8Array | string): string {
  return toHex(sha256Bytes(data));
}

/** SHA-256 hex of the canonical JSON form of a value. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
