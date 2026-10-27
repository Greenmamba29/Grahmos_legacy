/**
 * Venue pack v3 — the unit of installed facility truth.
 *
 * A pack is a zip:
 *   manifest.json           this document
 *   levels.json             { levels: FloorLevel[] }
 *   floors/<level>.geojson  floor contract per level (venue metres)
 *   pois.geojson            optional WGS84 POIs for a geo basemap
 *   basemap.pmtiles         optional offline basemap
 *   procedures.json         optional { documents: [...] } for local search
 *
 * INTEGRITY: `hashes` maps every other file to its SHA-256. AUTHORSHIP: `signature` is Ed25519 over
 * the canonical JSON of the integrity-bearing fields (slug, version, hashes) — covering content
 * transitively while staying a few hundred bytes. The public key is PINNED in the app; a pack signed
 * by any other key is rejected rather than trusted on first use. ANTI-ROLLBACK: installs refuse a
 * version lower than the one already installed (TUF's idea, not its stack).
 */
import { canonicalize } from '../crypto/canonicalJson.js';
import { fromHex } from '../crypto/hex.js';
import { KeyMaterialError, sign, verify } from '../crypto/ed25519.js';
import { toHex } from '../crypto/hex.js';
import type { VenueAnchor } from '../geo/anchor.js';

export const PACK_FORMAT = 3;

export interface PackSignature {
  key_id: string;
  alg: 'ed25519';
  /** Hex Ed25519 signature over `signingPayload`. */
  signature: string;
}

export interface PackProvenance {
  /** Where the geometry came from. */
  sources: string[];
  surveyedAt?: string;
  surveyedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  /** Honest statement of what is NOT verified. */
  limitations?: string[];
  /** 'fixture' = engineering fixture, never a real venue; 'public-data' = demo; 'authority-approved' = partner pack. */
  validation: 'fixture' | 'public-data' | 'authority-approved';
}

export interface PackManifest {
  pack_format: typeof PACK_FORMAT;
  venue_slug: string;
  venue_name: string;
  /** Semver. */
  version: string;
  created_at: string;
  languages: string[];
  /** filename → sha256 hex, for every file except manifest.json. */
  hashes: Record<string, string>;
  stats: { levels: number; exits: number; aeds: number; first_aid: number; refuges: number };
  provenance: PackProvenance;
  /** WGS84 position + rotation of the metre-grid origin. Absent = floor-plan view only. */
  anchor?: VenueAnchor;
  signature?: PackSignature;
}

export interface SignableFields {
  venue_slug: string;
  version: string;
  hashes: Record<string, string>;
  /** Signed too: moving a venue on the map is as dangerous as moving an exit. */
  anchor?: VenueAnchor | undefined;
}

/** Exact bytes signed. Build and runtime MUST derive this identically. */
export function signingPayload(f: SignableFields): string {
  return canonicalize({ venue_slug: f.venue_slug, version: f.version, hashes: f.hashes, ...(f.anchor ? { anchor: f.anchor } : {}) });
}

export function signManifest(
  manifest: PackManifest,
  seed: Uint8Array,
  keyId: string,
): PackManifest {
  const sig = sign(new TextEncoder().encode(signingPayload(manifest)), seed);
  return { ...manifest, signature: { key_id: keyId, alg: 'ed25519', signature: toHex(sig) } };
}

export type SignatureVerdict = { ok: true; keyId: string } | { ok: false; reason: string };

export function verifyManifestSignature(
  manifest: SignableFields & { signature?: PackSignature | undefined },
  pinnedKeys: Record<string, string>,
): SignatureVerdict {
  const s = manifest.signature;
  if (!s) return { ok: false, reason: 'pack carries no signature' };
  if (s.alg !== 'ed25519')
    return { ok: false, reason: `unsupported signature algorithm "${String(s.alg)}"` };
  const pub = pinnedKeys[s.key_id];
  if (!pub)
    return { ok: false, reason: `signed by unknown key "${s.key_id}" — not in the pinned key set` };
  try {
    const ok = verify(
      fromHex(s.signature),
      new TextEncoder().encode(signingPayload(manifest)),
      fromHex(pub),
    );
    return ok
      ? { ok: true, keyId: s.key_id }
      : { ok: false, reason: 'signature does not match the pack manifest' };
  } catch (e) {
    if (e instanceof KeyMaterialError)
      return { ok: false, reason: `unusable key material: ${e.message}` };
    return {
      ok: false,
      reason: `signature check failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// --------------------------------------------------------------------------- semver + rollback

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export const isSemver = (v: string): boolean => SEMVER.test(v);

export function compareSemver(a: string, b: string): number {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (!ma || !mb) throw new Error(`not semver: ${!ma ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d) return d < 0 ? -1 : 1;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa === pb) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  return pa < pb ? -1 : 1;
}

/** True when installing `candidate` over `installed` would move backwards. */
export function isRollback(candidate: string, installed: string | null | undefined): boolean {
  if (!installed) return false;
  return compareSemver(candidate, installed) < 0;
}
