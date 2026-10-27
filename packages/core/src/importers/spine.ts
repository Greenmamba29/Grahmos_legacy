/**
 * Circulation-spine synthesis for sources with no authored corridor centreline (OSM indoor, IFC).
 * Doors are ordered along their principal axis into a polyline; when the doors spread in two
 * dimensions (an L or a ring), a minimum-spanning tree over door positions keeps every door
 * connected, which is what the Stage-1 gate needs.
 */
import type { XY } from '../safetymap/floor.js';

export function orderAlongPrincipalAxis(pts: XY[]): XY[] {
  if (pts.length < 3) return pts.slice();
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  return pts.slice().sort((a, b) => a[0] * ux + a[1] * uy - (b[0] * ux + b[1] * uy));
}

/** Minimum spanning tree (Prim) over points → list of segments. */
export function spanningSegments(pts: XY[]): Array<[XY, XY]> {
  if (pts.length < 2) return [];
  const inTree = new Set<number>([0]);
  const segs: Array<[XY, XY]> = [];
  while (inTree.size < pts.length) {
    let best: { i: number; j: number; d: number } | null = null;
    for (const i of inTree) {
      for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) break;
    inTree.add(best.j);
    segs.push([pts[best.i]!, pts[best.j]!]);
  }
  return segs;
}

/**
 * Spine as MultiLineString coordinates. A near-linear door set yields one polyline along the
 * principal axis; otherwise a spanning network. Linearity is judged by the ratio of variance
 * along the principal axis to the total variance.
 */
export function synthesizeSpine(doors: XY[]): XY[][] {
  if (doors.length < 2) return [];
  const ordered = orderAlongPrincipalAxis(doors);
  const cx = doors.reduce((s, p) => s + p[0], 0) / doors.length;
  const cy = doors.reduce((s, p) => s + p[1], 0) / doors.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of doors) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const lambda1 = tr / 2 + Math.sqrt(Math.max(0, (tr / 2) ** 2 - det));
  const linearity = tr > 0 ? lambda1 / tr : 1;
  if (linearity >= 0.9) return [ordered];
  return spanningSegments(doors).map(([a, b]) => [a, b]);
}
