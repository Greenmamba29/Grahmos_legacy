import type { Feature, FeatureCollection } from 'geojson';
import type { AmenityCategory, Ring, UnitCategory, XY } from '../floor.js';

export const rect = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];

export const unit = (
  id: string,
  name: string,
  ring: Ring,
  category: UnitCategory = 'room',
): Feature => ({
  type: 'Feature',
  properties: { feature_type: 'unit', category, id, name },
  geometry: { type: 'Polygon', coordinates: [ring] },
});
export const walkway = (id: string, name: string, ring: Ring): Feature =>
  unit(id, name, ring, 'walkway');
export const path = (id: string, coords: XY[]): Feature => ({
  type: 'Feature',
  properties: { feature_type: 'path', id },
  geometry: { type: 'LineString', coordinates: coords },
});
export const opening = (id: string, unitId: string, at: XY): Feature => ({
  type: 'Feature',
  properties: { feature_type: 'opening', id, unit: unitId },
  geometry: { type: 'Point', coordinates: at },
});
export const amenity = (
  id: string,
  category: AmenityCategory,
  name: string,
  at: XY,
  extra: Record<string, unknown> = {},
): Feature => ({
  type: 'Feature',
  properties: { feature_type: 'amenity', category, id, name, ...extra },
  geometry: { type: 'Point', coordinates: at },
});
export const compartment = (id: string, name: string, ring: Ring): Feature => ({
  type: 'Feature',
  properties: { feature_type: 'compartment', id, name },
  geometry: { type: 'Polygon', coordinates: [ring] },
});
export const floor = (features: Feature[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});
