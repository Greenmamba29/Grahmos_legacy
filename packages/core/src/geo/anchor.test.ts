import { describe, expect, it } from 'vitest';
import { lngLatToMeters, metersToLngLat, projectToWgs84 } from './anchor.js';
import { CITY_CENTER_L2 } from '../safetymap/fixtures/cityCenter.js';

const anchor = { lng: -122.3313, lat: 47.5951 };

describe('venue anchor projection', () => {
  it('round-trips within a millimetre', () => {
    for (const p of [
      [0, 0],
      [62, -2],
      [-64, 24],
      [1234.5, -987.25],
    ] as Array<[number, number]>) {
      expect(lngLatToMeters(anchor, metersToLngLat(anchor, p))).toEqual(p);
    }
  });
  it('100 m north is ~0.0009° latitude; rotation turns grid north east-ward', () => {
    const [, lat] = metersToLngLat(anchor, [0, 100]);
    expect(lat - anchor.lat).toBeCloseTo(0.000898, 5);
    const [lng90] = metersToLngLat({ ...anchor, rotationDeg: 90 }, [0, 100]);
    expect(lng90).toBeGreaterThan(anchor.lng);
  });
  it('projects a floor keeping properties and feature count', () => {
    const geo = projectToWgs84(CITY_CENTER_L2, anchor);
    expect(geo.features.length).toBe(CITY_CENTER_L2.features.length);
    const exit = geo.features.find((f) => f.properties?.id === 'exitC')!;
    expect(exit.properties?.category).toBe('exit');
    const [lng, lat] = (exit.geometry as { coordinates: [number, number] }).coordinates;
    expect(Math.abs(lng - anchor.lng)).toBeLessThan(0.01);
    expect(Math.abs(lat - anchor.lat)).toBeLessThan(0.01);
  });
});
