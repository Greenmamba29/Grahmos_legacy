/**
 * Multi-leg egress timeline: "walk corridor → descend stairwell → cross lobby → assembly point".
 * A leg is a RUN OF THE PATH THROUGH ONE KIND OF SPACE, derived from the building, so a route that
 * never leaves one corridor yields exactly one leg. Amenities (stairwells, exits) win over the unit
 * containing them, matched by proximity.
 */
import type { FeatureCollection } from 'geojson';
import { dist, type Pt } from './astar.js';
import { floorPois, floorUnits, pointInRing } from './floor.js';
import { WALK_MPS, metersToFeet } from './planner.js';

export type LegKind = 'corridor' | 'room' | 'stairwell' | 'exit' | 'refuge' | 'outdoor';

export interface EgressLeg {
  kind: LegKind;
  label: string;
  distanceMeters: number;
  distanceFt: number;
  seconds: number;
  endsAtMeters: number;
  /** Boundary crossed to ENTER the next leg; absent on the final leg. */
  handoff?: string;
}

interface Space {
  kind: LegKind;
  label: string;
}

const UNMAPPED: Space = { kind: 'corridor', label: 'Corridor' };

function spaceAt(floor: FeatureCollection, p: Pt, amenityRadiusM: number): Space {
  let nearest: { d: number; space: Space } | null = null;
  for (const poi of floorPois(floor)) {
    const kind: LegKind | null =
      poi.category === 'stairwell'
        ? 'stairwell'
        : poi.category === 'exit'
          ? 'exit'
          : poi.category === 'assembly' || poi.category === 'refuge'
            ? 'refuge'
            : null;
    if (!kind) continue;
    const d = dist(p, { x: poi.xy[0], y: poi.xy[1] });
    if (d <= amenityRadiusM && (!nearest || d < nearest.d))
      nearest = { d, space: { kind, label: poi.name } };
  }
  if (nearest) return nearest.space;
  for (const u of floorUnits(floor)) {
    if (!pointInRing([p.x, p.y], u.ring)) continue;
    if (u.category === 'walkway') return { kind: 'corridor', label: u.name || 'Corridor' };
    if (u.category === 'refuge') return { kind: 'refuge', label: u.name };
    return { kind: 'room', label: u.name };
  }
  return UNMAPPED;
}

export function egressLegs(floor: FeatureCollection, path: Pt[], amenityRadiusM = 4): EgressLeg[] {
  if (path.length < 2) return [];
  const legs: EgressLeg[] = [];
  let cumulative = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const space = spaceAt(floor, mid, amenityRadiusM);
    const d = dist(a, b);
    cumulative += d;
    const last = legs[legs.length - 1];
    if (last && last.kind === space.kind && last.label === space.label) {
      last.distanceMeters += d;
      last.endsAtMeters = cumulative;
    } else {
      if (last) last.handoff = space.label;
      legs.push({
        kind: space.kind,
        label: space.label,
        distanceMeters: d,
        distanceFt: 0,
        seconds: 0,
        endsAtMeters: cumulative,
      });
    }
  }
  // Final destination becomes the last handoff when the path ends on a named amenity.
  const end = path[path.length - 1]!;
  const endSpace = spaceAt(floor, end, amenityRadiusM);
  const lastLeg = legs[legs.length - 1]!;
  if (endSpace.kind !== lastLeg.kind || endSpace.label !== lastLeg.label)
    lastLeg.handoff = endSpace.label;
  for (const l of legs) {
    l.distanceMeters = Math.round(l.distanceMeters * 10) / 10;
    l.distanceFt = metersToFeet(l.distanceMeters);
    l.seconds = Math.max(1, Math.round(l.distanceMeters / WALK_MPS));
    l.endsAtMeters = Math.round(l.endsAtMeters * 10) / 10;
  }
  return legs;
}
