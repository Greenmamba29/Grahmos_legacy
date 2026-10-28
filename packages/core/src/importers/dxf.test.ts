import { describe, expect, it } from 'vitest';
import { dxfToFloor, parseDxf } from './dxf.js';
import { validateFloor, floorHasErrors, floorRooms, floorPois } from '../safetymap/floor.js';
import { extractNavGraph, unreachableRooms } from '../safetymap/graph.js';
import { planRoutes } from '../safetymap/planner.js';

/** Author a DXF in drawing millimetres (so the transform is exercised) from simple primitives. */
function dxf(parts: string[]): string {
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...parts,
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');
}
const mm = (m: number): string => String(Math.round(m * 1000));
const poly = (layer: string, pts: Array<[number, number]>, closed = true): string[] => [
  '0',
  'LWPOLYLINE',
  '8',
  layer,
  '90',
  String(pts.length),
  '70',
  closed ? '1' : '0',
  ...pts.flatMap(([x, y]) => ['10', mm(x), '20', mm(y)]),
];
const point = (layer: string, x: number, y: number): string[] => [
  '0',
  'POINT',
  '8',
  layer,
  '10',
  mm(x),
  '20',
  mm(y),
];
const text = (layer: string, x: number, y: number, s: string): string[] => [
  '0',
  'TEXT',
  '8',
  layer,
  '10',
  mm(x),
  '20',
  mm(y),
  '1',
  s,
];
const rect = (x: number, y: number, w: number, h: number): Array<[number, number]> => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const SAMPLE = dxf([
  ...poly('A-ROOM', rect(-60, 6, 34, 26)),
  ...text('A-LABEL', -43, 19, 'Concourse 201'),
  ...poly('A-ROOM', rect(-18, 6, 38, 26)),
  ...text('A-LABEL', 1, 19, 'Concourse 204'),
  ...poly('A-ROOM', rect(-18, -32, 38, 26)),
  ...text('A-LABEL', 1, -19, 'Main Concourse'),
  ...poly('WALKWAY', rect(-64, -6, 128, 12)),
  ...poly(
    'CENTERLINE',
    [
      [-64, 0],
      [-43, 0],
      [1, 0],
      [62, 0],
    ],
    false,
  ),
  ...point('A-DOOR', -43, 6),
  ...point('A-DOOR', 1, 6),
  ...point('A-DOOR', 1, -6),
  ...point('EXIT', -64, 24),
  ...text('A-LABEL', -63, 25, 'Exit A'),
  ...point('STAIR_EXIT', 62, -2),
  ...text('A-LABEL', 61, -1, 'Exit C'),
  ...point('AED', -22, 16),
  ...point('STAIR', -24, -4),
  ...point('YOU_ARE_HERE', -2, -14),
  ...['0', 'CIRCLE', '8', 'DECOR', '10', '0', '20', '0', '40', '500'],
]);

describe('DXF importer', () => {
  it('parses entities with layers, closure and text', () => {
    const ents = parseDxf(SAMPLE);
    expect(ents.filter((e) => e.type === 'LWPOLYLINE')).toHaveLength(5);
    expect(ents.find((e) => e.type === 'TEXT')?.text).toBe('Concourse 201');
    expect(ents.find((e) => e.layer === 'CENTERLINE')?.closed).toBe(false);
  });
  it('converts mm drawing into a valid, routable floor with names and accessibility', () => {
    const { floor, counts, ignored } = dxfToFloor(SAMPLE, { transform: { scale: 0.001 } });
    expect(ignored).toEqual(['CIRCLE@DECOR']);
    expect(counts).toMatchObject({
      room: 3,
      walkway: 1,
      path: 1,
      opening: 3,
      'amenity:exit': 2,
      'amenity:aed': 1,
      'amenity:stairwell': 1,
    });
    const issues = validateFloor(floor);
    expect(floorHasErrors(issues)).toBe(false);
    expect(floorRooms(floor).map((r) => r.name)).toEqual([
      'Concourse 201',
      'Concourse 204',
      'Main Concourse',
    ]);
    const exits = floorPois(floor).filter((p) => p.category === 'exit');
    expect(exits.map((e) => [e.name, e.accessible])).toEqual([
      ['Exit A', true],
      ['Exit C', false],
    ]);
    const ex = extractNavGraph(floor);
    expect(ex.suspect).toEqual([]);
    expect(unreachableRooms(ex)).toEqual([]);
    const plan = planRoutes({ floor, mode: 'accessible' });
    expect(plan.primary?.destination).toBe('Exit A');
  });
  it('flipY and origin shift are applied', () => {
    const { floor } = dxfToFloor(SAMPLE, {
      transform: { scale: 0.001, originX: 1000, originY: 0, flipY: true },
    });
    const aed = floorPois(floor).find((p) => p.category === 'aed')!;
    expect(aed.xy).toEqual([-23, -16]);
  });
});
