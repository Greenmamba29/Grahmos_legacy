/**
 * Smoke compartments. Hospitals do not evacuate vertically on first alarm: non-ambulatory patients
 * are moved through a rated smoke barrier into an ADJACENT compartment on the same floor, then
 * defended in place (NFPA 101 horizontal evacuation). A compartment is a `feature_type:
 * 'compartment'` polygon on the floor.
 */
import type { FeatureCollection, Polygon } from 'geojson';
import type { Pt } from './astar.js';
import { pointInRing, type Ring } from './floor.js';

export interface Compartment {
  id: string;
  name: string;
  ring: Ring;
}

export function compartmentsOf(floor: FeatureCollection): Compartment[] {
  const out: Compartment[] = [];
  for (const f of floor.features) {
    if (f.properties?.feature_type !== 'compartment' || f.geometry.type !== 'Polygon') continue;
    const ring = (f.geometry as Polygon).coordinates[0] as Ring | undefined;
    if (!ring) continue;
    out.push({
      id: String(f.properties?.id ?? `c${out.length + 1}`),
      name: String(f.properties?.name ?? 'Compartment'),
      ring,
    });
  }
  return out;
}

export function compartmentAt(
  floor: FeatureCollection,
  p: Pt | null | undefined,
): Compartment | null {
  if (!p) return null;
  for (const c of compartmentsOf(floor)) if (pointInRing([p.x, p.y], c.ring)) return c;
  return null;
}

/** True when the path exits the compartment and never re-enters it (the horizontal-evac property). */
export function leavesCompartmentOnce(path: Pt[], comp: Compartment): boolean {
  let left = false;
  for (const p of path) {
    const inside = pointInRing([p.x, p.y], comp.ring);
    if (!inside) left = true;
    else if (left) return false;
  }
  return left;
}
