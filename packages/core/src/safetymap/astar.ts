/**
 * A* shortest path — pure, dependency-free, hazard-aware.
 * Edge cost = Euclidean length × hazard penalty; the heuristic (straight-line) stays admissible, so
 * the result is optimal with respect to the penalised cost. Graphs are small (tens to thousands of
 * nodes); callers may still run this in a worker.
 */
export interface Pt {
  x: number;
  y: number;
}

export interface NavGraph {
  nodes: Record<string, Pt>;
  /** Undirected adjacency: both directions present. */
  adj: Record<string, string[]>;
}

export interface HazardZone {
  x: number;
  y: number;
  r: number;
}

export interface RouteResult {
  path: string[];
  points: Pt[];
  /** Geometric (unpenalised) length in metres. */
  distanceMeters: number;
  /** True only when no clear path exists and the route crosses the zone. */
  throughHazard: boolean;
  /** Closest approach of the route to the hazard centre, metres (Infinity without a hazard). */
  hazardClearanceM: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

const isRoutablePt = (p: Pt | undefined): p is Pt =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Distance from point p to segment ab. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Fraction (sampled) of segment a→b inside the hazard disc, 0..1. */
export function hazardOverlap(a: Pt, b: Pt, hz: HazardZone): number {
  const SAMPLES = 6;
  let inside = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    if (Math.hypot(a.x + (b.x - a.x) * t - hz.x, a.y + (b.y - a.y) * t - hz.y) <= hz.r) inside++;
  }
  return inside / (SAMPLES + 1);
}

/** Big-but-finite so a hazard edge is avoided whenever ANY alternative exists. */
export const HAZARD_PENALTY = 40;

export function edgeCost(a: Pt, b: Pt, hazard: HazardZone | null): number {
  const base = dist(a, b);
  if (!hazard) return base;
  const overlap = hazardOverlap(a, b, hazard);
  return overlap === 0 ? base : base * (1 + HAZARD_PENALTY * overlap);
}

class MinHeap {
  private items: Array<{ id: string; f: number }> = [];
  get size(): number {
    return this.items.length;
  }
  push(id: string, f: number): void {
    const a = this.items;
    a.push({ id, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): { id: string; f: number } | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function aStar(
  graph: NavGraph,
  startId: string,
  goalId: string,
  hazard: HazardZone | null = null,
): RouteResult | null {
  const { nodes, adj } = graph;
  const start = nodes[startId];
  const goal = nodes[goalId];
  if (!isRoutablePt(start) || !isRoutablePt(goal)) return null;

  const open = new MinHeap();
  const cameFrom = new Map<string, string>();
  const g = new Map<string, number>([[startId, 0]]);
  const closed = new Set<string>();
  open.push(startId, dist(start, goal));

  while (open.size > 0) {
    const { id: current } = open.pop()!;
    if (closed.has(current)) continue;
    if (current === goalId) {
      const path = [current];
      let c = current;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c)!;
        path.unshift(c);
      }
      const points = path.map((id) => nodes[id]!);
      let distanceMeters = 0;
      let throughHazard = false;
      let clearance = Infinity;
      for (let i = 1; i < points.length; i++) {
        distanceMeters += dist(points[i - 1]!, points[i]!);
        if (hazard) {
          if (hazardOverlap(points[i - 1]!, points[i]!, hazard) > 0) throughHazard = true;
          clearance = Math.min(
            clearance,
            segmentDistance({ x: hazard.x, y: hazard.y }, points[i - 1]!, points[i]!),
          );
        }
      }
      if (hazard && points.length === 1) clearance = dist(points[0]!, { x: hazard.x, y: hazard.y });
      return { path, points, distanceMeters, throughHazard, hazardClearanceM: clearance };
    }
    closed.add(current);
    const cp = nodes[current];
    if (!isRoutablePt(cp)) continue;
    for (const nb of adj[current] ?? []) {
      if (closed.has(nb)) continue;
      const np = nodes[nb];
      if (!isRoutablePt(np)) continue;
      const tentative = g.get(current)! + edgeCost(cp, np, hazard);
      if (tentative < (g.get(nb) ?? Infinity)) {
        cameFrom.set(nb, current);
        g.set(nb, tentative);
        open.push(nb, tentative + dist(np, goal));
      }
    }
  }
  return null;
}

export type NearestRoute = RouteResult & { goalId: string };

/** Best route to any goal, comparing penalised cost (a hazard-crossing route always loses to a clear one). */
export function routeToNearest(
  graph: NavGraph,
  startId: string,
  goalIds: string[],
  hazard: HazardZone | null = null,
): NearestRoute | null {
  let best: NearestRoute | null = null;
  let bestScore = Infinity;
  for (const goalId of goalIds) {
    const r = aStar(graph, startId, goalId, hazard);
    if (!r) continue;
    const score = r.distanceMeters + (r.throughHazard ? 1e6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { ...r, goalId };
    }
  }
  return best;
}

/** Pathless multi-source distance map (Dijkstra, unpenalised). Used by audits and the exit board. */
export function distancesFromAny(graph: NavGraph, sources: string[]): Map<string, number> {
  const d = new Map<string, number>();
  const heap = new MinHeap();
  for (const s of sources)
    if (graph.nodes[s]) {
      d.set(s, 0);
      heap.push(s, 0);
    }
  while (heap.size) {
    const { id, f } = heap.pop()!;
    if (f > (d.get(id) ?? Infinity)) continue;
    for (const nb of graph.adj[id] ?? []) {
      const nd = f + dist(graph.nodes[id]!, graph.nodes[nb]!);
      if (nd < (d.get(nb) ?? Infinity)) {
        d.set(nb, nd);
        heap.push(nb, nd);
      }
    }
  }
  return d;
}
