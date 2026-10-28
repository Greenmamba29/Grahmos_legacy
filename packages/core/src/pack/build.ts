import type { FeatureCollection } from 'geojson';
import { sha256Hex } from '../crypto/sha256.js';
import {
  floorHasErrors,
  floorPois,
  validateFloor,
  type FloorLevel,
  type FloorIssue,
} from '../safetymap/floor.js';
import { extractNavGraph, unreachableRooms } from '../safetymap/graph.js';
import { PACK_FORMAT, type PackManifest, type PackProvenance, isSemver } from './manifest.js';
import type { VenueAnchor } from '../geo/anchor.js';
import { u8, writeZip, type PackFiles } from './zip.js';

export interface BuildInput {
  venueSlug: string;
  venueName: string;
  version: string;
  levels: FloorLevel[];
  /** level name → floor */
  floors: Record<string, FeatureCollection>;
  provenance: PackProvenance;
  anchor?: VenueAnchor | undefined;
  languages?: string[];
  procedures?: { documents: Array<{ id: string; title: string; kind: string; body: string }> };
  pois?: FeatureCollection;
  basemap?: Uint8Array;
  createdAt?: string;
}

export interface BuildGateFailure {
  level: string;
  issues: FloorIssue[];
  unreachableRooms: string[];
  suspect: string[];
  malformed: string[];
}

export class PackGateError extends Error {
  constructor(public readonly failures: BuildGateFailure[]) {
    super(
      `pack gate failed on ${failures.length} level(s): ${failures.map((f) => f.level).join(', ')}`,
    );
    this.name = 'PackGateError';
  }
}

export const floorFileName = (levelName: string): string => `floors/${levelName}.geojson`;

/** Every level must pass the contract AND the routability gate before it can ship. */
export function gateFloors(
  levels: FloorLevel[],
  floors: Record<string, FeatureCollection>,
): BuildGateFailure[] {
  const failures: BuildGateFailure[] = [];
  for (const lvl of levels) {
    const floor = floors[lvl.name];
    if (!floor) {
      failures.push({
        level: lvl.name,
        issues: [{ severity: 'error', feature: 'floor', message: 'no floor for level' }],
        unreachableRooms: [],
        suspect: [],
        malformed: [],
      });
      continue;
    }
    const issues = validateFloor(floor);
    const ex = extractNavGraph(floor);
    const unreachable = floorHasErrors(issues) ? [] : unreachableRooms(ex);
    if (floorHasErrors(issues) || unreachable.length || ex.suspect.length || ex.malformed.length)
      failures.push({
        level: lvl.name,
        issues,
        unreachableRooms: unreachable,
        suspect: ex.suspect,
        malformed: ex.malformed,
      });
  }
  return failures;
}

/** Build the file set and manifest. Unsigned; see signManifest / buildPackZip. */
export function buildPackFiles(input: BuildInput): { files: PackFiles; manifest: PackManifest } {
  if (!isSemver(input.version))
    throw new Error(`pack version must be semver, got "${input.version}"`);
  const failures = gateFloors(input.levels, input.floors);
  if (failures.length) throw new PackGateError(failures);

  const files: PackFiles = {};
  files['levels.json'] = u8(
    JSON.stringify({ venue_slug: input.venueSlug, levels: input.levels }, null, 2),
  );
  let exits = 0;
  let aeds = 0;
  let firstAid = 0;
  let refuges = 0;
  for (const lvl of input.levels) {
    const floor = input.floors[lvl.name]!;
    files[floorFileName(lvl.name)] = u8(JSON.stringify(floor));
    for (const p of floorPois(floor)) {
      if (p.category === 'exit') exits++;
      else if (p.category === 'aed') aeds++;
      else if (p.category === 'first_aid') firstAid++;
      else if (p.category === 'refuge' || p.category === 'assembly') refuges++;
    }
  }
  if (input.procedures) files['procedures.json'] = u8(JSON.stringify(input.procedures, null, 2));
  if (input.pois) files['pois.geojson'] = u8(JSON.stringify(input.pois));
  if (input.basemap) files['basemap.pmtiles'] = input.basemap;

  const hashes: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) hashes[name] = sha256Hex(files[name]!);

  const manifest: PackManifest = {
    pack_format: PACK_FORMAT,
    venue_slug: input.venueSlug,
    venue_name: input.venueName,
    version: input.version,
    created_at: input.createdAt ?? new Date().toISOString(),
    languages: input.languages ?? ['en'],
    hashes,
    stats: { levels: input.levels.length, exits, aeds, first_aid: firstAid, refuges },
    provenance: input.provenance,
    ...(input.anchor ? { anchor: input.anchor } : {}),
  };
  return { files, manifest };
}

export function packZip(files: PackFiles, manifest: PackManifest): Uint8Array {
  return writeZip({ ...files, 'manifest.json': u8(JSON.stringify(manifest, null, 2)) });
}
