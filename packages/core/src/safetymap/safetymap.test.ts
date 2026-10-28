import { describe, expect, it } from 'vitest';
import { validateFloor, floorHasErrors, floorRooms, floorPois, roomAt } from './floor.js';
import { extractNavGraph, unreachableRooms, MAX_SNAP_DISTANCE_M } from './graph.js';
import { aStar, routeToNearest } from './astar.js';
import { planRoutes, destinationOptions, nearestAsset, HAZARD_RADIUS_M } from './planner.js';
import { exitBoard } from './exitBoard.js';
import { egressLegs } from './egressLegs.js';
import { compartmentAt, leavesCompartmentOnce } from './compartments.js';
import { CITY_CENTER_L2, CITY_CENTER_GROUND } from './fixtures/cityCenter.js';
import { HARBOR_GENERAL_W3 } from './fixtures/harborGeneral.js';
import { amenity, floor, path, rect, unit } from './fixtures/builders.js';

describe('floor contract', () => {
  it('fixtures validate without errors', () => {
    for (const f of [CITY_CENTER_L2, CITY_CENTER_GROUND, HARBOR_GENERAL_W3]) {
      const issues = validateFloor(f);
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
  it('rejects a floor with no path or exit', () => {
    const issues = validateFloor(floor([unit('r', 'Room', rect(0, 0, 10, 10))]));
    expect(floorHasErrors(issues)).toBe(true);
    expect(issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/no path/), expect.stringMatching(/no exit/)]),
    );
  });
  it('accessors', () => {
    expect(floorRooms(CITY_CENTER_L2).map((r) => r.id)).toContain('204');
    expect(floorPois(CITY_CENTER_L2).some((p) => p.id === 'youHere')).toBe(false);
    expect(roomAt(CITY_CENTER_L2, [0, 20])?.name).toBe('Concourse 204');
  });
});

describe('graph extraction', () => {
  it('every room reaches an exit on every fixture (Stage-1 gate)', () => {
    for (const f of [CITY_CENTER_L2, CITY_CENTER_GROUND, HARBOR_GENERAL_W3]) {
      const ex = extractNavGraph(f);
      expect(ex.malformed).toEqual([]);
      expect(ex.suspect).toEqual([]);
      expect(unreachableRooms(ex)).toEqual([]);
    }
  });
  it('flags a mis-georeferenced exit as suspect but keeps it', () => {
    const f = floor([
      unit('r', 'Room', rect(0, 0, 10, 10)),
      path('p', [
        [0, -5],
        [20, -5],
      ]),
      amenity('far', 'exit', 'Far', [9000, 9000]),
    ]);
    const ex = extractNavGraph(f);
    expect(ex.suspect[0]).toMatch(/amenity:far \(\d+ m to spine:/);
    expect(ex.graph.nodes['exit:far']).toBeDefined();
    expect(MAX_SNAP_DISTANCE_M).toBe(75);
  });
  it('drops non-finite geometry rather than poisoning distances', () => {
    const f = floor([
      path('p', [
        [0, 0],
        [10, 0],
      ]),
      {
        type: 'Feature',
        properties: { feature_type: 'amenity', category: 'exit', id: 'bad' },
        geometry: { type: 'Point', coordinates: [] },
      },
      amenity('ok', 'exit', 'Ok', [10, 2]),
    ]);
    const ex = extractNavGraph(f);
    expect(ex.malformed).toEqual(['amenity:bad']);
    expect(aStar(ex.graph, 'spine:0', 'exit:ok')).not.toBeNull();
  });
});

describe('A* hazard avoidance', () => {
  it('routes around a hazard when a clear alternative exists and reports it otherwise', () => {
    const ex = extractNavGraph(CITY_CENTER_L2);
    const start = 'you_are_here:youHere';
    const clear = routeToNearest(ex.graph, start, ex.exitNodeIds)!;
    expect(clear.goalId).toBe('exit:exitC');
    // Hazard sitting on the eastern corridor forces a westward exit.
    const hz = { x: 30, y: 0, r: HAZARD_RADIUS_M };
    const avoided = routeToNearest(ex.graph, start, ex.exitNodeIds, hz)!;
    expect(avoided.goalId).not.toBe('exit:exitC');
    expect(avoided.throughHazard).toBe(false);
    // Only goal is through the hazard → honest flag.
    const forced = aStar(ex.graph, start, 'exit:exitC', hz)!;
    expect(forced.throughHazard).toBe(true);
    expect(forced.hazardClearanceM).toBeLessThan(HAZARD_RADIUS_M);
  });
  it('returns null for unreachable or unknown nodes', () => {
    const ex = extractNavGraph(CITY_CENTER_L2);
    expect(aStar(ex.graph, 'nope', 'exit:exitA')).toBeNull();
  });
});

describe('planner', () => {
  it('occupant plan has a primary and an independent alternate', () => {
    const plan = planRoutes({ floor: CITY_CENTER_L2, mode: 'occupant' });
    expect(plan.primary?.destination).toBe('Exit C');
    expect(plan.alternate?.goalId).not.toBe(plan.primary?.goalId);
    expect(plan.primary?.etaSeconds).toBeGreaterThan(0);
    expect(plan.primary?.reason).toMatch(/No active incident/);
  });
  it('accessible profile never uses stairs or a stair-discharge exit', () => {
    const plan = planRoutes({ floor: CITY_CENTER_L2, mode: 'accessible' });
    expect(plan.primary?.path.some((n) => n.startsWith('stairwell:'))).toBe(false);
    expect(destinationOptions(CITY_CENTER_L2, 'accessible').map((d) => d.id)).not.toContain(
      'exit:exitB',
    );
    expect(
      planRoutes({ floor: CITY_CENTER_L2, mode: 'accessible', destinationNodeId: 'exit:exitB' })
        .primary,
    ).toBeNull();
  });
  it('responder routes TO the hazard, unpenalised', () => {
    const plan = planRoutes({
      floor: CITY_CENTER_L2,
      mode: 'responder',
      hazardXY: { x: 0, y: 19 },
    });
    expect(plan.goalKind).toBe('incident');
    expect(plan.primary?.destination).toBe('Concourse 204');
  });
  it('occupant plan with a live origin and a hazard steers clear', () => {
    const plan = planRoutes({
      floor: CITY_CENTER_L2,
      mode: 'occupant',
      originXY: { x: 10, y: 20 },
      hazardXY: { x: 50, y: 0 },
    });
    expect(plan.primary).not.toBeNull();
    expect(plan.primary?.throughHazard).toBe(false);
    expect(plan.primary?.goalId).not.toBe('exit:exitC');
  });
  it('horizontal evacuation leaves the fire compartment once into an adjacent refuge', () => {
    const fire = { x: -55, y: 18 }; // inside ICU 301, compartment A
    const plan = planRoutes({
      floor: HARBOR_GENERAL_W3,
      mode: 'horizontal',
      originXY: { x: -40, y: 18 },
      hazardXY: fire,
    });
    expect(plan.incidentCompartmentId).toBe('A');
    expect(plan.targetCompartmentId).toBe('B');
    expect(plan.primary?.destination).toBe('Refuge B');
    const comp = compartmentAt(HARBOR_GENERAL_W3, fire)!;
    expect(leavesCompartmentOnce(plan.primary!.points, comp)).toBe(true);
    expect(plan.primary?.path.some((n) => n.startsWith('stairwell:'))).toBe(false);
  });
  it('nearest asset is hazard-aware', () => {
    const aed = nearestAsset(CITY_CENTER_L2, 'aed', { x: 0, y: -10 }, null)!;
    expect(aed.goalId).toBe('aed:aed2');
    const aedAvoiding = nearestAsset(CITY_CENTER_L2, 'aed', { x: 0, y: -10 }, { x: 22, y: -8 })!;
    expect(aedAvoiding.goalId).toBe('aed:aed1');
  });
  it('explains unavailability instead of inventing a path', () => {
    const plan = planRoutes({ floor: CITY_CENTER_L2, mode: 'responder' });
    expect(plan.primary).toBeNull();
    expect(plan.unavailableReason).toMatch(/no incident/);
  });
});

describe('exit board', () => {
  it('ranks clear exits above hazard exits regardless of distance', () => {
    const board = exitBoard({
      floor: CITY_CENTER_L2,
      originXY: { x: 10, y: -20 },
      hazardXY: { x: 50, y: 0 },
    });
    expect(board[0]!.condition).toBe('clear');
    const c = board.find((e) => e.id === 'exitC')!;
    expect(c.condition).toBe('hazard');
    expect(c.hazardClearanceM).toBeLessThan(HAZARD_RADIUS_M);
    expect(board.indexOf(c)).toBeGreaterThan(0);
    expect(board.every((e) => e.etaSeconds! > 0)).toBe(true);
  });
});

describe('egress legs', () => {
  it('derives legs from the building, naming handoffs', () => {
    const plan = planRoutes({ floor: CITY_CENTER_L2, mode: 'occupant', originXY: { x: 0, y: 20 } });
    const legs = egressLegs(CITY_CENTER_L2, plan.primary!.points);
    expect(legs[0]!.kind).toBe('room');
    expect(legs[0]!.label).toBe('Concourse 204');
    expect(legs.some((l) => l.kind === 'corridor')).toBe(true);
    const last = legs[legs.length - 1]!;
    expect(last.kind).toBe('exit');
    expect(last.label).toBe('Exit C');
    expect(legs[legs.length - 2]!.handoff).toBe('Exit C');
    expect(last.handoff).toBeUndefined();
    const total = legs.reduce((s, l) => s + l.distanceMeters, 0);
    expect(Math.abs(total - plan.primary!.distanceMeters)).toBeLessThan(0.5);
  });
});
