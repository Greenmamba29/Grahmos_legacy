import type { FeatureCollection } from 'geojson';
import type { Pt } from './astar.js';
import { floorPois } from './floor.js';
import { HAZARD_RADIUS_M, etaSeconds, metersToFeet, planRoutes } from './planner.js';

export type ExitCondition = 'clear' | 'hazard' | 'unreachable';

export interface ExitStatus {
  id: string;
  label: string;
  condition: ExitCondition;
  accessible: boolean;
  distanceMeters?: number;
  distanceFt?: number;
  etaSeconds?: number;
  /** Closest approach to the hazard centre, metres; present only when an incident is declared. */
  hazardClearanceM?: number;
}

export interface ExitBoardInput {
  floor: FeatureCollection;
  originXY?: Pt | null;
  hazardXY?: Pt | null;
}

const RANK: Record<ExitCondition, number> = { clear: 0, hazard: 1, unreachable: 2 };

/**
 * Best first: clear before hazard before unreachable, then nearest. Deliberately NOT by distance
 * alone — the nearest exit can be the one the fire is standing in.
 */
export function sortBoard(statuses: ExitStatus[]): ExitStatus[] {
  return [...statuses].sort(
    (a, b) =>
      RANK[a.condition] - RANK[b.condition] ||
      (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
  );
}

/** Status of every exit on the floor from the occupant's position. One A* per exit over a shared graph. */
export function exitBoard({
  floor,
  originXY = null,
  hazardXY = null,
}: ExitBoardInput): ExitStatus[] {
  const exits = floorPois(floor).filter((p) => p.category === 'exit');
  return sortBoard(
    exits.map<ExitStatus>((exit) => {
      const plan = planRoutes({
        floor,
        mode: 'occupant',
        originXY,
        hazardXY,
        destinationNodeId: `exit:${exit.id}`,
      });
      const r = plan.primary;
      if (!r)
        return {
          id: exit.id,
          label: exit.name,
          accessible: exit.accessible,
          condition: 'unreachable',
        };
      const clearance = hazardXY ? r.hazardClearanceM : null;
      return {
        id: exit.id,
        label: exit.name,
        accessible: exit.accessible,
        condition: clearance !== null && clearance < HAZARD_RADIUS_M ? 'hazard' : 'clear',
        distanceMeters: r.distanceMeters,
        distanceFt: metersToFeet(r.distanceMeters),
        etaSeconds: etaSeconds(r.distanceMeters),
        ...(clearance !== null ? { hazardClearanceM: clearance } : {}),
      };
    }),
  );
}
