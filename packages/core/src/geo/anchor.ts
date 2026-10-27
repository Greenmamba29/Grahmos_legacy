/**
 * Venue anchor — the one definition of where a venue's metre grid sits on Earth.
 *
 * Floors are authored in a local east/north metre grid. The anchor is the WGS84 position of that
 * grid's origin plus the grid's rotation from true north. It lives IN the pack manifest, so the
 * basemap and the floor can never be built from two different numbers (the reference product once
 * drifted a hospital 4.6 km from its own floor plan exactly that way).
 *
 * Projection is a local tangent plane (equirectangular about the anchor latitude): sub-centimetre
 * over any single venue and trivially invertible.
 */
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { Pt } from '../safetymap/astar.js';
import type { XY } from '../safetymap/floor.js';

export interface VenueAnchor {
  lng: number;
  lat: number;
  /** Clockwise rotation of grid north from true north, degrees. 0 = grid north is true north. */
  rotationDeg?: number;
}

const EARTH_R = 6378137;
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export function metersToLngLat(anchor: VenueAnchor, p: XY | Pt): [number, number] {
  const x = Array.isArray(p) ? p[0] : p.x;
  const y = Array.isArray(p) ? p[1] : p.y;
  const rot = toRad(anchor.rotationDeg ?? 0);
  // Rotate grid east/north into true east/north (grid rotated clockwise by rot → unrotate).
  const east = x * Math.cos(rot) + y * Math.sin(rot);
  const north = -x * Math.sin(rot) + y * Math.cos(rot);
  const lat = anchor.lat + toDeg(north / EARTH_R);
  const lng = anchor.lng + toDeg(east / (EARTH_R * Math.cos(toRad(anchor.lat))));
  return [lng, lat];
}

export function lngLatToMeters(anchor: VenueAnchor, lngLat: [number, number]): XY {
  const rot = toRad(anchor.rotationDeg ?? 0);
  const north = toRad(lngLat[1] - anchor.lat) * EARTH_R;
  const east = toRad(lngLat[0] - anchor.lng) * EARTH_R * Math.cos(toRad(anchor.lat));
  const x = east * Math.cos(rot) - north * Math.sin(rot);
  const y = east * Math.sin(rot) + north * Math.cos(rot);
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

function mapPositions(g: Geometry, f: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Point':
      return { ...g, coordinates: f(g.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { ...g, coordinates: g.coordinates.map(f) };
    case 'MultiLineString':
    case 'Polygon':
      return { ...g, coordinates: g.coordinates.map((r) => r.map(f)) };
    case 'MultiPolygon':
      return { ...g, coordinates: g.coordinates.map((poly) => poly.map((r) => r.map(f))) };
    case 'GeometryCollection':
      return { ...g, geometries: g.geometries.map((x) => mapPositions(x, f)) };
  }
}

/** Project a metre-grid floor (or any metre-grid FeatureCollection) to WGS84 for a geo renderer. */
export function projectToWgs84(fc: FeatureCollection, anchor: VenueAnchor): FeatureCollection {
  const f = (p: Position): Position => (Number.isFinite(p[0]) && Number.isFinite(p[1]) ? metersToLngLat(anchor, [p[0]!, p[1]!]) : p);
  return { type: 'FeatureCollection', features: fc.features.map<Feature>((ft) => ({ ...ft, geometry: mapPositions(ft.geometry, f) })) };
}

/** A hazard disc as a WGS84 polygon. */
export function hazardPolygon(anchor: VenueAnchor, centre: Pt, radiusM: number, segments = 48): Feature {
  const ring: Position[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push(metersToLngLat(anchor, [centre.x + radiusM * Math.cos(a), centre.y + radiusM * Math.sin(a)]));
  }
  return { type: 'Feature', properties: { kind: 'hazard' }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

export function lineFeature(anchor: VenueAnchor, pts: Pt[], properties: Record<string, unknown>): Feature {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: pts.map((p) => metersToLngLat(anchor, p)) } };
}
