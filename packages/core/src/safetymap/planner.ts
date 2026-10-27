import type { FeatureCollection } from 'geojson';
import {
  routeToNearest,
  type HazardZone,
  type NavGraph,
  type NearestRoute,
  type Pt,
} from './astar.js';
import { compartmentAt } from './compartments.js';
import { floorPois } from './floor.js';
import { extractedFor, withOrigin, type Extracted } from './graph.js';

export type RouteMode = 'occupant' | 'responder' | 'accessible' | 'horizontal';
export const ROUTE_MODES: readonly RouteMode[] = [
  'occupant',
  'responder',
  'accessible',
  'horizontal',
];

/** Hazard radius for a declared incident, metres. */
export const HAZARD_RADIUS_M = 16;
/** Walking pace used for every ETA, m/s (NFPA/SFPE unimpeded corridor pace, conservative). */
export const WALK_MPS = 1.4;
export const metersToFeet = (m: number): number => Math.round(m * 3.28084);
export const etaSeconds = (m: number): number => Math.max(1, Math.round(m / WALK_MPS));

export interface RouteSummary {
  id: string;
  mode: RouteMode;
  goalId: string;
  destination: string;
  distanceMeters: number;
  distanceFt: number;
  etaSeconds: number;
  /** "Best route BECAUSE …" */
  reason: string;
  throughHazard: boolean;
  hazardClearanceM: number | null;
  points: Pt[];
  path: string[];
}

export interface PlanInput {
  floor: FeatureCollection;
  mode: RouteMode;
  /** Live origin; null → the floor's you_are_here amenity (or first room). */
  originXY?: Pt | null;
  /** Declared incident centre; enables hazard avoidance + responder routing. */
  hazardXY?: Pt | null;
  /** Restrict to one destination node id. */
  destinationNodeId?: string | null;
}

export interface RoutePlan {
  primary: RouteSummary | null;
  alternate: RouteSummary | null;
  refugeFallback: boolean;
  goalKind: 'exit' | 'incident' | 'refuge';
  incidentCompartmentId: string | null;
  targetCompartmentId: string | null;
  /** Why no route exists, when primary is null. */
  unavailableReason?: string;
}

export function defaultStartNode(ex: Extracted): string {
  const ids = Object.keys(ex.graph.nodes);
  return ids.find((i) => i.startsWith('you_are_here:')) ?? ex.roomNodeIds[0] ?? ids[0] ?? '';
}

function withoutPrefix(graph: NavGraph, prefix: string): NavGraph {
  const nodes: Record<string, Pt> = {};
  for (const [id, p] of Object.entries(graph.nodes)) if (!id.startsWith(prefix)) nodes[id] = p;
  const adj: Record<string, string[]> = {};
  for (const [id, ns] of Object.entries(graph.adj))
    if (!id.startsWith(prefix)) adj[id] = ns.filter((n) => !n.startsWith(prefix));
  return { nodes, adj };
}

const idsWithPrefix = (graph: NavGraph, prefix: string): string[] =>
  Object.keys(graph.nodes).filter((id) => id.startsWith(prefix));

function inaccessibleExitIds(floor: FeatureCollection): Set<string> {
  return new Set(
    floorPois(floor)
      .filter((p) => p.category === 'exit' && !p.accessible)
      .map((p) => `exit:${p.id}`),
  );
}

function nodeLabel(floor: FeatureCollection, id: string): string {
  const [category, fid] = id.split(':');
  const f = floor.features.find((x) => {
    if (String(x.properties?.id) !== fid) return false;
    const type = String(x.properties?.feature_type);
    return category === 'unit' || category === 'door'
      ? type === (category === 'door' ? 'opening' : 'unit')
      : type === 'amenity' && String(x.properties?.category) === category;
  });
  return String(f?.properties?.name ?? fid ?? id);
}

function summarise(
  floor: FeatureCollection,
  mode: RouteMode,
  r: NearestRoute,
  reason: string,
  idPrefix: string,
): RouteSummary {
  return {
    id: `${idPrefix}-${mode}-${r.goalId}`,
    mode,
    goalId: r.goalId,
    destination: nodeLabel(floor, r.goalId),
    distanceMeters: Math.round(r.distanceMeters * 10) / 10,
    distanceFt: metersToFeet(r.distanceMeters),
    etaSeconds: etaSeconds(r.distanceMeters),
    reason,
    throughHazard: r.throughHazard,
    hazardClearanceM: Number.isFinite(r.hazardClearanceM)
      ? Math.round(r.hazardClearanceM * 10) / 10
      : null,
    points: r.points,
    path: r.path,
  };
}

/** Plan primary + alternate routes for a profile. Never invents a path: nulls when unreachable. */
export function planRoutes(input: PlanInput): RoutePlan {
  const { floor, mode, originXY = null, hazardXY = null, destinationNodeId = null } = input;
  const ex = extractedFor(floor);
  const startNode = originXY ? 'origin:live' : defaultStartNode(ex);
  const baseGraph = originXY ? withOrigin(ex, originXY) : ex.graph;
  const hazard: HazardZone | null = hazardXY
    ? { x: hazardXY.x, y: hazardXY.y, r: HAZARD_RADIUS_M }
    : null;
  // Responders travel toward the incident; their path is not penalised.
  const hazardPolicy = mode === 'responder' ? null : hazard;
  const fireComp = compartmentAt(floor, hazardXY);

  let graph = baseGraph;
  let goals: string[] = [];
  let goalKind: RoutePlan['goalKind'] = 'exit';
  let refugeFallback = false;
  const fail = (unavailableReason: string): RoutePlan => ({
    primary: null,
    alternate: null,
    refugeFallback,
    goalKind,
    incidentCompartmentId: fireComp?.id ?? null,
    targetCompartmentId: null,
    unavailableReason,
  });

  if (!startNode || !graph.nodes[startNode]) return fail('no origin on this floor');

  if (mode === 'horizontal') {
    goalKind = 'refuge';
    graph = withoutPrefix(baseGraph, 'stairwell:');
    goals = [...idsWithPrefix(graph, 'refuge:'), ...idsWithPrefix(graph, 'assembly:')].filter(
      (id) => {
        const c = compartmentAt(floor, graph.nodes[id]);
        return !fireComp || (c && c.id !== fireComp.id);
      },
    );
    if (!goals.length)
      return fail(
        fireComp ? 'no area of refuge outside the fire compartment' : 'floor has no area of refuge',
      );
  } else if (mode === 'responder') {
    goalKind = 'incident';
    const target =
      hazardXY ??
      (() => {
        const id = idsWithPrefix(graph, 'incident:')[0];
        return id ? graph.nodes[id]! : null;
      })();
    if (!target) return fail('no incident declared to respond to');
    let best: string | null = null;
    let bd = Infinity;
    for (const [id, p] of Object.entries(graph.nodes)) {
      if (id === startNode || id.startsWith('you_are_here:')) continue;
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    goals = best ? [best] : [];
  } else if (mode === 'accessible') {
    graph = withoutPrefix(baseGraph, 'stairwell:');
    const barred = inaccessibleExitIds(floor);
    goals = idsWithPrefix(graph, 'exit:').filter((id) => !barred.has(id));
    const reachable =
      goals.length > 0 && routeToNearest(graph, startNode, goals, hazardPolicy) !== null;
    if (!reachable) {
      const refuge = [...idsWithPrefix(graph, 'refuge:'), ...idsWithPrefix(graph, 'assembly:')];
      if (refuge.length) {
        goals = refuge;
        goalKind = 'refuge';
        refugeFallback = true;
      }
    }
  } else {
    goals = ex.exitNodeIds;
  }

  if (destinationNodeId) {
    const barred = mode === 'accessible' && inaccessibleExitIds(floor).has(destinationNodeId);
    goals = !barred && graph.nodes[destinationNodeId] ? [destinationNodeId] : [];
    if (
      goalKind === 'exit' &&
      (destinationNodeId.startsWith('assembly:') || destinationNodeId.startsWith('refuge:'))
    )
      goalKind = 'refuge';
    if (!goals.length)
      return fail(
        barred ? 'destination is not step-free' : 'destination is not routable for this profile',
      );
  }
  if (!goals.length) return fail('no destinations of this kind on the floor');

  const first = routeToNearest(graph, startNode, goals, hazardPolicy);
  if (!first) return fail('no path connects the origin to any destination');

  const reasonFor = (r: NearestRoute): string => {
    if (mode === 'horizontal')
      return fireComp
        ? `Horizontal evacuation: out of ${fireComp.name} through the smoke barrier into an adjacent compartment. Step-free; stairs excluded.`
        : 'Horizontal evacuation: step-free route to the nearest area of refuge.';
    if (mode === 'responder')
      return 'Fastest mapped approach to the scene (hazard not avoided — you are responding to it).';
    if (mode === 'accessible')
      return refugeFallback
        ? 'No step-free exit is reachable from here — routing to an area of refuge instead of stairs.'
        : 'Step-free route: stairwells are excluded from this path.';
    if (!hazardPolicy) return 'Shortest mapped path to the nearest exit. No active incident.';
    return r.throughHazard
      ? 'No clear path exists — this route still passes the hazard zone. Treat with caution.'
      : 'Shortest path to the nearest exit that stays clear of the hazard zone.';
  };

  const primary = summarise(floor, mode, first, reasonFor(first), 'route');
  const others = goals.filter((g) => g !== first.goalId);
  const second = others.length ? routeToNearest(graph, startNode, others, hazardPolicy) : null;
  const alternate = second
    ? summarise(
        floor,
        mode,
        second,
        `Alternate destination — ${second.distanceMeters > first.distanceMeters * 1.1 ? 'longer' : 'comparable'} but independent of the primary route's ${goalKind}.`,
        'route-alt',
      )
    : null;
  return {
    primary,
    alternate,
    refugeFallback,
    goalKind,
    incidentCompartmentId: fireComp?.id ?? null,
    targetCompartmentId: compartmentAt(floor, graph.nodes[first.goalId])?.id ?? null,
  };
}

export interface DestinationOption {
  id: string;
  label: string;
  kind: 'exit' | 'refuge' | 'aed' | 'first_aid' | 'fire_extinguisher';
  xy: Pt;
}

/** Selectable destinations for a profile — real graph nodes only. */
export function destinationOptions(floor: FeatureCollection, mode: RouteMode): DestinationOption[] {
  const ex = extractedFor(floor);
  const barred = inaccessibleExitIds(floor);
  const out: DestinationOption[] = [];
  for (const p of floorPois(floor)) {
    const id = `${p.category}:${p.id}`;
    if (!ex.graph.nodes[id]) continue;
    if (p.category === 'exit') {
      if (mode === 'accessible' && barred.has(id)) continue;
      if (mode === 'horizontal') continue;
      out.push({ id, label: p.name, kind: 'exit', xy: ex.graph.nodes[id]! });
    } else if (p.category === 'assembly' || p.category === 'refuge')
      out.push({ id, label: p.name, kind: 'refuge', xy: ex.graph.nodes[id]! });
    else if (
      p.category === 'aed' ||
      p.category === 'first_aid' ||
      p.category === 'fire_extinguisher'
    )
      out.push({ id, label: p.name, kind: p.category, xy: ex.graph.nodes[id]! });
  }
  return out;
}

/** Nearest routable asset of a category from an origin (e.g. "nearest AED"), hazard-aware. */
export function nearestAsset(
  floor: FeatureCollection,
  category:
    'aed' | 'first_aid' | 'fire_extinguisher' | 'exit' | 'refuge' | 'assembly' | 'stairwell',
  originXY: Pt | null,
  hazardXY: Pt | null,
): RouteSummary | null {
  const ex = extractedFor(floor);
  const graph = originXY ? withOrigin(ex, originXY) : ex.graph;
  const start = originXY ? 'origin:live' : defaultStartNode(ex);
  const goals = idsWithPrefix(graph, `${category}:`);
  const hazard = hazardXY ? { x: hazardXY.x, y: hazardXY.y, r: HAZARD_RADIUS_M } : null;
  const r = routeToNearest(graph, start, goals, hazard);
  return r
    ? summarise(
        floor,
        'occupant',
        r,
        `Nearest ${category.replace('_', ' ')} by walking distance${hazard ? ', avoiding the hazard zone' : ''}.`,
        'asset',
      )
    : null;
}
