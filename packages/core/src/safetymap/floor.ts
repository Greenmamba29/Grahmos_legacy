/**
 * Floor contract — the one GeoJSON shape every importer (DXF / IFC / OSM / hand-digitised) emits
 * and every consumer (renderer, router, exit board, audit) reads.
 *
 * Coordinates are VENUE METRES (east, north) from the venue origin, not WGS84. A floor is a
 * FeatureCollection of:
 *   unit         Polygon   category: room | walkway | refuge | restricted      (id, name)
 *   opening      Point     a door; `unit` names the room it serves
 *   path         LineString|MultiLineString  corridor centrelines; coincident vertices join
 *   amenity      Point     category: exit | stairwell | aed | first_aid | fire_extinguisher |
 *                          assembly | refuge | you_are_here | incident (id, name, accessible?)
 *   compartment  Polygon   smoke compartment (hospitals) — enables horizontal evacuation
 */
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
  Polygon,
} from 'geojson';

export type FeatureType = 'unit' | 'opening' | 'path' | 'amenity' | 'compartment';
export type UnitCategory = 'room' | 'walkway' | 'refuge' | 'restricted';
export type AmenityCategory =
  | 'exit'
  | 'stairwell'
  | 'aed'
  | 'first_aid'
  | 'fire_extinguisher'
  | 'assembly'
  | 'refuge'
  | 'checkpoint'
  | 'you_are_here'
  | 'incident';

export const AMENITY_CATEGORIES: readonly AmenityCategory[] = [
  'exit',
  'stairwell',
  'aed',
  'first_aid',
  'fire_extinguisher',
  'assembly',
  'refuge',
  'checkpoint',
  'you_are_here',
  'incident',
];
export const UNIT_CATEGORIES: readonly UnitCategory[] = ['room', 'walkway', 'refuge', 'restricted'];

/** Static POIs a map renders; the dynamic you_are_here / incident points come from state. */
export const RENDERABLE_AMENITIES: ReadonlySet<AmenityCategory> = new Set<AmenityCategory>([
  'exit',
  'stairwell',
  'aed',
  'first_aid',
  'fire_extinguisher',
  'assembly',
  'refuge',
]);

export type XY = [number, number];
export type Ring = XY[];

export interface FloorLevel {
  id: string;
  name: string;
  ordinal: number;
  isOutdoor?: boolean;
}

export interface FloorIssue {
  severity: 'error' | 'warning';
  feature: string;
  message: string;
}

export type Floor = FeatureCollection;

const ft = (f: Feature): string => String(f.properties?.feature_type ?? '');
const cat = (f: Feature): string => String(f.properties?.category ?? '');
const pid = (f: Feature): string => String(f.properties?.id ?? '');

export const featureKey = (f: Feature): string => `${ft(f)}:${pid(f) || '?'}`;

function finiteXY(c: unknown): c is XY {
  return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

/** Structural validation. Errors make a floor unusable; warnings are surfaced but tolerated. */
export function validateFloor(floor: FeatureCollection): FloorIssue[] {
  const issues: FloorIssue[] = [];
  if (floor.type !== 'FeatureCollection' || !Array.isArray(floor.features)) {
    return [{ severity: 'error', feature: 'root', message: 'not a FeatureCollection' }];
  }
  const unitIds = new Set<string>();
  let paths = 0;
  let exits = 0;
  const seen = new Map<string, number>();
  for (const f of floor.features) {
    const key = featureKey(f);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const type = ft(f);
    const g = f.geometry;
    switch (type) {
      case 'unit':
        if (g.type !== 'Polygon')
          issues.push({ severity: 'error', feature: key, message: 'unit must be a Polygon' });
        else if (!(g as Polygon).coordinates[0]?.every(finiteXY))
          issues.push({
            severity: 'error',
            feature: key,
            message: 'unit ring has non-finite coordinates',
          });
        if (!UNIT_CATEGORIES.includes(cat(f) as UnitCategory))
          issues.push({
            severity: 'warning',
            feature: key,
            message: `unknown unit category "${cat(f)}"`,
          });
        if (pid(f)) unitIds.add(pid(f));
        break;
      case 'opening':
        if (g.type !== 'Point' || !finiteXY((g as Point).coordinates))
          issues.push({
            severity: 'error',
            feature: key,
            message: 'opening must be a finite Point',
          });
        break;
      case 'path':
        paths += 1;
        if (g.type !== 'LineString' && g.type !== 'MultiLineString')
          issues.push({
            severity: 'error',
            feature: key,
            message: 'path must be a LineString or MultiLineString',
          });
        else {
          const lines =
            g.type === 'LineString'
              ? [(g as LineString).coordinates]
              : (g as MultiLineString).coordinates;
          if (!lines.every((l) => l.length >= 2 && l.every(finiteXY)))
            issues.push({
              severity: 'error',
              feature: key,
              message: 'path has a degenerate or non-finite segment',
            });
        }
        break;
      case 'amenity':
        if (g.type !== 'Point' || !finiteXY((g as Point).coordinates))
          issues.push({
            severity: 'error',
            feature: key,
            message: 'amenity must be a finite Point',
          });
        if (!AMENITY_CATEGORIES.includes(cat(f) as AmenityCategory))
          issues.push({
            severity: 'warning',
            feature: key,
            message: `unknown amenity category "${cat(f)}"`,
          });
        if (cat(f) === 'exit') exits += 1;
        if (!pid(f))
          issues.push({ severity: 'error', feature: key, message: 'amenity needs an id' });
        break;
      case 'compartment':
        if (g.type !== 'Polygon')
          issues.push({
            severity: 'error',
            feature: key,
            message: 'compartment must be a Polygon',
          });
        break;
      default:
        issues.push({
          severity: 'warning',
          feature: key,
          message: `unknown feature_type "${type}" ignored`,
        });
    }
  }
  for (const f of floor.features) {
    if (ft(f) === 'opening') {
      const unit = String(f.properties?.unit ?? '');
      if (unit && !unitIds.has(unit))
        issues.push({
          severity: 'warning',
          feature: featureKey(f),
          message: `opening references unknown unit "${unit}"`,
        });
    }
  }
  for (const [key, n] of seen) {
    if (n > 1 && !key.startsWith('unit:walkway') && !key.endsWith(':?'))
      issues.push({ severity: 'warning', feature: key, message: `duplicate feature key (${n})` });
  }
  if (paths === 0)
    issues.push({
      severity: 'error',
      feature: 'floor',
      message: 'floor has no path (corridor centreline)',
    });
  if (exits === 0)
    issues.push({ severity: 'error', feature: 'floor', message: 'floor has no exit amenity' });
  return issues;
}

export const floorHasErrors = (issues: FloorIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');

// --------------------------------------------------------------------------- accessors

export interface FloorRoom {
  id: string;
  name: string;
  category: UnitCategory;
  ring: Ring;
  centroid: XY;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface FloorPoi {
  id: string;
  category: AmenityCategory;
  name: string;
  xy: XY;
  accessible: boolean;
}

export interface FloorDoor {
  id: string;
  unit: string;
  xy: XY;
}

export function ringCentroid(ring: Ring): XY {
  const pts =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
      ? ring.slice(0, -1)
      : ring;
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

export function floorUnits(floor: FeatureCollection): FloorRoom[] {
  const out: FloorRoom[] = [];
  for (const f of floor.features) {
    if (ft(f) !== 'unit' || f.geometry.type !== 'Polygon') continue;
    const ring = (f.geometry as Polygon).coordinates[0] as Ring | undefined;
    if (!ring || !ring.every(finiteXY)) continue;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    out.push({
      id: pid(f),
      name: String(f.properties?.name ?? pid(f)),
      category: (cat(f) as UnitCategory) || 'room',
      ring,
      centroid: ringCentroid(ring),
      bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    });
  }
  return out;
}

export const floorRooms = (floor: FeatureCollection): FloorRoom[] =>
  floorUnits(floor).filter((u) => u.category === 'room');

export function floorPois(
  floor: FeatureCollection,
  categories: ReadonlySet<AmenityCategory> = RENDERABLE_AMENITIES,
): FloorPoi[] {
  const out: FloorPoi[] = [];
  for (const f of floor.features) {
    if (ft(f) !== 'amenity' || f.geometry.type !== 'Point') continue;
    const c = cat(f) as AmenityCategory;
    if (!categories.has(c)) continue;
    const xy = (f.geometry as Point).coordinates;
    if (!finiteXY(xy)) continue;
    out.push({
      id: pid(f),
      category: c,
      name: String(f.properties?.name ?? pid(f)),
      xy: [xy[0], xy[1]],
      accessible: f.properties?.accessible !== false,
    });
  }
  return out;
}

export function floorDoors(floor: FeatureCollection): FloorDoor[] {
  const out: FloorDoor[] = [];
  for (const f of floor.features) {
    if (ft(f) !== 'opening' || f.geometry.type !== 'Point') continue;
    const xy = (f.geometry as Point).coordinates;
    if (!finiteXY(xy)) continue;
    out.push({ id: pid(f), unit: String(f.properties?.unit ?? ''), xy: [xy[0], xy[1]] });
  }
  return out;
}

export function amenityXY(floor: FeatureCollection, category: AmenityCategory): XY | null {
  const f = floor.features.find(
    (x) => ft(x) === 'amenity' && cat(x) === category && x.geometry.type === 'Point',
  );
  if (!f) return null;
  const c = (f.geometry as Point).coordinates;
  return finiteXY(c) ? [c[0], c[1]] : null;
}

/** Bounding box of every finite coordinate on the floor — what a renderer frames. */
export function floorBounds(floor: FeatureCollection): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (finiteXY(c)) {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const f of floor.features) visit((f.geometry as { coordinates?: unknown }).coordinates);
  if (!Number.isFinite(minX)) return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  return { minX, minY, maxX, maxY };
}

/** Name of the room containing a point, when any does. */
export function roomAt(floor: FeatureCollection, p: XY): FloorRoom | null {
  for (const u of floorRooms(floor)) if (pointInRing(p, u.ring)) return u;
  return null;
}

/** Point-in-polygon, ray cast. Ring may be open or closed. */
export function pointInRing(p: XY, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
