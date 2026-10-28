import type { FeatureCollection } from 'geojson';
import { sha256Hex } from '../crypto/sha256.js';
import type { FloorLevel } from '../safetymap/floor.js';
import {
  PACK_FORMAT,
  isRollback,
  isSemver,
  verifyManifestSignature,
  type PackManifest,
} from './manifest.js';
import { floorFileName } from './build.js';
import { readZip, str, type PackFiles } from './zip.js';

export interface VerifyOptions {
  pinnedKeys: Record<string, string>;
  /** Version currently installed for this venue, for anti-rollback. */
  installedVersion?: string | null;
  /** Escape hatch for engineering builds ONLY; never set in production. */
  allowUnsigned?: boolean;
}

export interface VerifiedPack {
  manifest: PackManifest;
  levels: FloorLevel[];
  floors: Record<string, FeatureCollection>;
  procedures: {
    documents: Array<{ id: string; title: string; kind: string; body: string }>;
  } | null;
  pois: FeatureCollection | null;
  basemap: Uint8Array | null;
  /** Checks that passed, in order, for diagnostics and evidence. */
  checks: string[];
  signedBy: string | null;
}

export class PackVerifyError extends Error {
  constructor(
    public readonly stage:
      'format' | 'manifest' | 'integrity' | 'signature' | 'rollback' | 'content',
    message: string,
  ) {
    super(message);
    this.name = 'PackVerifyError';
  }
}

function parseJson<T>(files: PackFiles, name: string, stage: PackVerifyError['stage']): T {
  const f = files[name];
  if (!f) throw new PackVerifyError(stage, `${name} missing from pack`);
  try {
    return JSON.parse(str(f)) as T;
  } catch {
    throw new PackVerifyError(stage, `${name} is not valid JSON`);
  }
}

/**
 * Verify and open a pack. Order matters and each failure names its stage:
 *   format → manifest shape → SHA-256 of every file → Ed25519 signature → anti-rollback → content.
 * A pack that fails ANY stage is not opened: a tampered floor must never render.
 */
export function verifyPack(zipBytes: Uint8Array, opts: VerifyOptions): VerifiedPack {
  let files: PackFiles;
  try {
    files = readZip(zipBytes);
  } catch (e) {
    throw new PackVerifyError(
      'format',
      `not a readable zip: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const checks: string[] = ['zip readable'];
  const manifest = parseJson<PackManifest>(files, 'manifest.json', 'manifest');
  if (manifest.pack_format !== PACK_FORMAT)
    throw new PackVerifyError(
      'manifest',
      `pack_format ${String(manifest.pack_format)} unsupported (want ${PACK_FORMAT})`,
    );
  if (!manifest.venue_slug || !isSemver(manifest.version))
    throw new PackVerifyError('manifest', 'manifest lacks venue_slug or a semver version');
  if (!manifest.hashes || typeof manifest.hashes !== 'object')
    throw new PackVerifyError('manifest', 'manifest has no hashes');
  checks.push('manifest shape');

  // Integrity: every listed file must exist and match; every present file must be listed.
  for (const [name, expected] of Object.entries(manifest.hashes)) {
    const f = files[name];
    if (!f)
      throw new PackVerifyError('integrity', `${name} listed in hashes but missing from pack`);
    const actual = sha256Hex(f);
    if (actual !== expected.toLowerCase())
      throw new PackVerifyError(
        'integrity',
        `${name} hash mismatch (expected ${expected}, got ${actual})`,
      );
  }
  for (const name of Object.keys(files)) {
    if (name === 'manifest.json') continue;
    if (!(name in manifest.hashes))
      throw new PackVerifyError(
        'integrity',
        `${name} present in pack but not covered by the manifest`,
      );
  }
  checks.push(`sha256 verified for ${Object.keys(manifest.hashes).length} files`);

  const verdict = verifyManifestSignature(manifest, opts.pinnedKeys);
  let signedBy: string | null = null;
  if (verdict.ok) {
    signedBy = verdict.keyId;
    checks.push(`ed25519 signature by ${verdict.keyId}`);
  } else if (manifest.signature || !opts.allowUnsigned) {
    throw new PackVerifyError('signature', verdict.reason);
  } else {
    checks.push('UNSIGNED pack accepted by explicit engineering override');
  }

  if (isRollback(manifest.version, opts.installedVersion)) {
    throw new PackVerifyError(
      'rollback',
      `pack ${manifest.version} is older than installed ${opts.installedVersion}`,
    );
  }
  checks.push('anti-rollback');

  const levelsDoc = parseJson<{ levels: FloorLevel[] }>(files, 'levels.json', 'content');
  if (!Array.isArray(levelsDoc.levels) || levelsDoc.levels.length === 0)
    throw new PackVerifyError('content', 'levels.json has no levels');
  const floors: Record<string, FeatureCollection> = {};
  for (const lvl of levelsDoc.levels) {
    const fc = parseJson<FeatureCollection>(files, floorFileName(lvl.name), 'content');
    if (fc.type !== 'FeatureCollection')
      throw new PackVerifyError('content', `${floorFileName(lvl.name)} is not a FeatureCollection`);
    floors[lvl.name] = fc;
  }
  checks.push(`${levelsDoc.levels.length} floor(s) parsed`);

  return {
    manifest,
    levels: [...levelsDoc.levels].sort((a, b) => a.ordinal - b.ordinal),
    floors,
    procedures: files['procedures.json'] ? parseJson(files, 'procedures.json', 'content') : null,
    pois: files['pois.geojson'] ? parseJson(files, 'pois.geojson', 'content') : null,
    basemap: files['basemap.pmtiles'] ?? null,
    checks,
    signedBy,
  };
}
