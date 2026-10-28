/**
 * Graph extraction — floor contract → routable NavGraph.
 *   - each path vertex is a spine node; coincident vertices MERGE (corridor networks, ring corridors)
 *   - each room unit is a centroid node
 *   - each opening connects its room centroid to the nearest spine node
 *   - each amenity connects to the nearest spine node; you_are_here / incident snap to the nearest
 *     door instead (they sit inside rooms)
 * Every snap is distance-checked against MAX_SNAP_DISTANCE_M: a feature mis-georeferenced by a units
 * or origin mistake is still *connected*, so connectivity alone cannot catch it.
 */
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
  Polygon,
} from 'geojson';
import { aStar, dist, type NavGraph, type Pt } from './astar.js';
import { ringCentroid, type XY } from './floor.js';

export const MAX_SNAP_DISTANCE_M = 75;

export interface ExtractOptions {
  maxSnapDistanceM?: number;
}

export interface Extracted {
  graph: NavGraph;
  /** amenity id → node id (exitA → 'exit:exitA'). */
  amenityNode: Record<string, string>;
  exitNodeIds: string[];
  roomNodeIds: string[];
  doorNodeIds: string[];
  spineNodeIds: string[];
  /** Features dropped for non-finite geometry, as "<feature_type>:<id>". */
  malformed: string[];
  /** Features KEPT but snapping further than the limit, as "<feature_type>:<id> (<n> m to <node>)". */
  suspect: string[];
}

const finite = (c: unknown): c is XY =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);
const key = (p: XY): string => `${Math.round(p[0] * 1000)}:${Math.round(p[1] * 1000)}`;

export function extractNavGraph(floor: FeatureCollection, options: ExtractOptions = {}): Extracted {
  const limit = options.maxSnapDistanceM ?? MAX_SNAP_DISTANCE_M;
  const nodes: Record<string, Pt> = {};
  const adj: Record<string, Set<string>> = {};
  const ensure = (id: string): void => {
    if (!adj[id]) adj[id] = new Set();
  };
  const addNode = (id: string, p: Pt): void => {
    nodes[id] = p;
    ensure(id);
  };
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    ensure(a);
    ensure(b);
    adj[a]!.add(b);
    adj[b]!.add(a);
  };
  const malformed: string[] = [];
  const suspect: string[] = [];
  const fType = (f: Feature): string => String(f.properties?.feature_type ?? '');
  const fid = (f: Feature): string => String(f.properties?.id ?? '');

  // 1) Spine from every path feature, merging coincident vertices.
  const spineByKey = new Map<string, string>();
  const spineNodeIds: string[] = [];
  let spineN = 0;
  const spineNodeFor = (p: XY): string => {
    const k = key(p);
    let id = spineByKey.get(k);
    if (!id) {
      id = `spine:${spineN++}`;
      spineByKey.set(k, id);
      addNode(id, { x: p[0], y: p[1] });
      spineNodeIds.push(id);
    }
    return id;
  };
  for (const f of floor.features) {
    if (fType(f) !== 'path') continue;
    const g = f.geometry;
    const lines: unknown[][] =
      g.type === 'LineString'
        ? [(g as LineString).coordinates]
        : g.type === 'MultiLineString'
          ? (g as MultiLineString).coordinates
          : [];
    if (!lines.length) {
      malformed.push(`path:${fid(f)}`);
      continue;
    }
    for (const line of lines) {
      let prev: string | null = null;
      for (const c of line) {
        if (!finite(c)) {
          malformed.push(`path:${fid(f)}`);
          prev = null;
          continue;
        }
        const id = spineNodeFor(c);
        if (prev) addEdge(prev, id);
        prev = id;
      }
    }
  }
  const nearestSpine = (p: Pt): { id: string; d: number } | null => {
    let best: string | null = null;
    let bd = Infinity;
    for (const id of spineNodeIds) {
      const d = dist(p, nodes[id]!);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best ? { id: best, d: bd } : null;
  };
  const checkSnap = (label: string, snap: { id: string; d: number }): void => {
    if (snap.d > limit) suspect.push(`${label} (${Math.round(snap.d)} m to ${snap.id})`);
  };

  // 2) Rooms → centroid nodes.
  const roomNodeIds: string[] = [];
  for (const f of floor.features) {
    if (fType(f) !== 'unit' || f.geometry.type !== 'Polygon') continue;
    const category = String(f.properties?.category ?? 'room');
    if (category === 'walkway') continue;
    const ring = (f.geometry as Polygon).coordinates[0];
    if (!ring || !ring.every(finite)) {
      malformed.push(`unit:${fid(f)}`);
      continue;
    }
    const c = ringCentroid(ring as XY[]);
    const id = `unit:${fid(f)}`;
    addNode(id, { x: c[0], y: c[1] });
    roomNodeIds.push(id);
  }

  // 3) Doors connect room ↔ spine.
  const doorNodeIds: string[] = [];
  for (const f of floor.features) {
    if (fType(f) !== 'opening' || f.geometry.type !== 'Point') continue;
    const c = (f.geometry as Point).coordinates;
    if (!finite(c)) {
      malformed.push(`opening:${fid(f)}`);
      continue;
    }
    const id = `door:${fid(f)}`;
    addNode(id, { x: c[0], y: c[1] });
    doorNodeIds.push(id);
    const unit = `unit:${String(f.properties?.unit ?? '')}`;
    if (nodes[unit]) addEdge(unit, id);
    const s = nearestSpine(nodes[id]!);
    if (s) {
      addEdge(id, s.id);
      checkSnap(`opening:${fid(f)}`, s);
    }
  }
  // Rooms with no door at all still attach to the spine, else they are unroutable islands.
  for (const id of roomNodeIds) {
    if ((adj[id]?.size ?? 0) > 0) continue;
    const s = nearestSpine(nodes[id]!);
    if (s) {
      addEdge(id, s.id);
      checkSnap(id, s);
    }
  }

  // 4) Amenities.
  const amenityNode: Record<string, string> = {};
  const exitNodeIds: string[] = [];
  const nearestDoor = (p: Pt): { id: string; d: number } | null => {
    let best: string | null = null;
    let bd = Infinity;
    for (const id of doorNodeIds) {
      const d = dist(p, nodes[id]!);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best ? { id: best, d: bd } : null;
  };
  for (const f of floor.features) {
    if (fType(f) !== 'amenity' || f.geometry.type !== 'Point') continue;
    const c = (f.geometry as Point).coordinates;
    const category = String(f.properties?.category ?? '');
    if (category === 'checkpoint') continue; // surveyed markers position people; they are not destinations
    const label = `amenity:${fid(f)}`;
    if (!finite(c)) {
      malformed.push(label);
      continue;
    }
    const id = `${category}:${fid(f)}`;
    addNode(id, { x: c[0], y: c[1] });
    amenityNode[fid(f)] = id;
    if (category === 'exit') exitNodeIds.push(id);
    const inside = category === 'you_are_here' || category === 'incident';
    const s = (inside ? nearestDoor(nodes[id]!) : null) ?? nearestSpine(nodes[id]!);
    if (s) {
      addEdge(id, s.id);
      checkSnap(label, s);
    }
  }

  const adjOut: Record<string, string[]> = {};
  for (const [id, set] of Object.entries(adj)) adjOut[id] = [...set];
  return {
    graph: { nodes, adj: adjOut },
    amenityNode,
    exitNodeIds,
    roomNodeIds,
    doorNodeIds,
    spineNodeIds,
    malformed,
    suspect,
  };
}

/** Stage-1 gate: every room must reach an exit. Returns the rooms that cannot. */
export function unreachableRooms(ex: Extracted): string[] {
  return ex.roomNodeIds.filter((r) => !ex.exitNodeIds.some((e) => aStar(ex.graph, r, e) !== null));
}

/**
 * Copy of the graph with a live origin at `xy`, attached to the nearest door and nearest spine
 * vertex so a position inside a room or in a corridor both route sensibly.
 */
export function withOrigin(ex: Extracted, xy: Pt, originId = 'origin:live'): NavGraph {
  const nodes = { ...ex.graph.nodes, [originId]: xy };
  const adj: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(ex.graph.adj)) adj[k] = [...v];
  adj[originId] = [];
  const link = (candidates: string[]): void => {
    let best: string | null = null;
    let bd = Infinity;
    for (const id of candidates) {
      const d = dist(xy, nodes[id]!);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    if (best) {
      adj[originId]!.push(best);
      adj[best]!.push(originId);
    }
  };
  link(ex.doorNodeIds);
  link(ex.spineNodeIds);
  return { nodes, adj };
}

const cache = new WeakMap<FeatureCollection, Extracted>();
/** Memoised per floor object. */
export function extractedFor(floor: FeatureCollection): Extracted {
  let ex = cache.get(floor);
  if (!ex) {
    ex = extractNavGraph(floor);
    cache.set(floor, ex);
  }
  return ex;
}
