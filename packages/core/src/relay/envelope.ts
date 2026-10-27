/**
 * Signed operation envelopes — the unit that crosses a device boundary.
 *
 * An event leaves its device wrapped in an envelope signed by the device key. The relay and every
 * receiving device verify the signature before storing or folding the event, and the signature
 * covers the event bytes, so a relay cannot alter what a device said; it can only delay or drop it
 * (and the cursor model makes a drop visible as a gap the next catch-up fills).
 *
 * Trust policy for device keys is deliberately simple at Tier 1: a key is pinned on FIRST SIGHT per
 * deviceId and any later envelope from that deviceId must use the same key. That blocks
 * impersonation of a device already seen; it does not prove who enrolled a device in the first
 * place. Facility enrollment (an authority signing device keys) is the Tier-2 step and is said so.
 */
import { canonicalize } from '../crypto/canonicalJson.js';
import { fromHex, toHex } from '../crypto/hex.js';
import { KeyMaterialError, publicKeyFromSeed, sign, verify } from '../crypto/ed25519.js';
import { sha256Hex } from '../crypto/sha256.js';
import type { IncidentEvent } from '../comms/types.js';

export interface Envelope {
  /** Envelope id = SHA-256 of the canonical event; deduplicates across any path. */
  id: string;
  /** Venue the event belongs to, for relay fan-out and filtering. */
  venueSlug: string;
  deviceId: string;
  publicKey: string;
  /** ISO time the envelope was sealed on the device. */
  sealedAt: string;
  event: IncidentEvent;
  alg: 'ed25519';
  signature: string;
}

export function envelopePayload(e: Omit<Envelope, 'signature' | 'alg'>): string {
  return canonicalize({ id: e.id, venueSlug: e.venueSlug, deviceId: e.deviceId, publicKey: e.publicKey, sealedAt: e.sealedAt, event: e.event });
}

export function sealEnvelope(event: IncidentEvent, venueSlug: string, deviceId: string, seed: Uint8Array, sealedAt = new Date().toISOString()): Envelope {
  const publicKey = toHex(publicKeyFromSeed(seed));
  const base = { id: sha256Hex(canonicalize(event)), venueSlug, deviceId, publicKey, sealedAt, event };
  const signature = toHex(sign(new TextEncoder().encode(envelopePayload(base)), seed));
  return { ...base, alg: 'ed25519', signature };
}

export type EnvelopeVerdict = { ok: true; firstSight: boolean } | { ok: false; reason: string };

/** Port for the first-sight key store. */
export interface DeviceKeyStore {
  get(deviceId: string): Promise<string | null> | string | null;
  put(deviceId: string, publicKey: string): Promise<void> | void;
}

export class MemoryDeviceKeyStore implements DeviceKeyStore {
  private m = new Map<string, string>();
  get(id: string): string | null {
    return this.m.get(id) ?? null;
  }
  put(id: string, key: string): void {
    this.m.set(id, key);
  }
}

/** Verify structure, id, actor binding, signature, and the first-sight key policy. */
export async function verifyEnvelope(e: Envelope, keys: DeviceKeyStore): Promise<EnvelopeVerdict> {
  if (e.alg !== 'ed25519') return { ok: false, reason: `unsupported algorithm ${String(e.alg)}` };
  if (!e.event || typeof e.event !== 'object') return { ok: false, reason: 'no event' };
  if (e.id !== sha256Hex(canonicalize(e.event))) return { ok: false, reason: 'envelope id does not match the event' };
  if (e.event.actor?.deviceId !== e.deviceId) return { ok: false, reason: 'event actor does not match the sealing device' };
  const { signature: _s, alg: _a, ...base } = e;
  void _s;
  void _a;
  let valid: boolean;
  try {
    valid = verify(fromHex(e.signature), new TextEncoder().encode(envelopePayload(base)), fromHex(e.publicKey));
  } catch (err) {
    return { ok: false, reason: err instanceof KeyMaterialError ? `unusable key material: ${err.message}` : String(err) };
  }
  if (!valid) return { ok: false, reason: 'signature does not match' };
  const known = await keys.get(e.deviceId);
  if (known && known !== e.publicKey) return { ok: false, reason: `device ${e.deviceId} is pinned to a different key` };
  if (!known) await keys.put(e.deviceId, e.publicKey);
  return { ok: true, firstSight: !known };
}
