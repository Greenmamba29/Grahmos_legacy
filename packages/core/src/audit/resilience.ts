/**
 * Resilience audit — pure functions over an extracted floor graph. Distances are measured along the
 * routable graph: a good PROXY for NFPA 101 travel distance, not a code-official measurement. The
 * report says so. This finds gaps for a safety officer; it does not certify a building.
 */
import type { FeatureCollection } from 'geojson';
import { distancesFromAny, type NavGraph } from '../safetymap/astar.js';
import { extractedFor, type Extracted } from '../safetymap/graph.js';
import { floorPois } from '../safetymap/floor.js';
import { HAZARD_RADIUS_M } from '../safetymap/planner.js';

export interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'info';
  message: string;
  nodes?: string[];
}
export interface CategoryScore {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  findings: Finding[];
  metrics: Record<string, number | string>;
}

export const NFPA_TRAVEL_SPRINKLERED_M = 60;
export const NFPA_TRAVEL_UNSPRINKLERED_M = 45;
export const AED_REACH_M = 100;

const roomLabel = (id: string): string => id.replace(/^unit:/, '');
const ids = (g: NavGraph, prefix: string): string[] =>
  Object.keys(g.nodes).filter((i) => i.startsWith(prefix));

export function scoreExitCoverage(ex: Extracted, sprinklered: boolean): CategoryScore {
  const limit = sprinklered ? NFPA_TRAVEL_SPRINKLERED_M : NFPA_TRAVEL_UNSPRINKLERED_M;
  const rooms = ex.roomNodeIds;
  const nearest = distancesFromAny(ex.graph, ex.exitNodeIds);
  const perExit = ex.exitNodeIds.map((e) => distancesFromAny(ex.graph, [e]));
  const unreachable: string[] = [];
  const over: string[] = [];
  const single: string[] = [];
  for (const r of rooms) {
    const d = nearest.get(r);
    if (d === undefined) {
      unreachable.push(r);
      continue;
    }
    if (d > limit) over.push(r);
    if (perExit.filter((m) => m.has(r)).length === 1) single.push(r);
  }
  const total = rooms.length || 1;
  const findings: Finding[] = [];
  if (!ex.exitNodeIds.length)
    findings.push({ severity: 'critical', message: 'Floor declares no exits at all.' });
  if (unreachable.length)
    findings.push({
      severity: 'critical',
      message: `${unreachable.length} room(s) cannot reach ANY exit: ${unreachable.map(roomLabel).join(', ')}`,
      nodes: unreachable,
    });
  if (over.length)
    findings.push({
      severity: 'high',
      message: `${over.length} room(s) exceed the ${limit} m travel-distance limit (${sprinklered ? 'sprinklered' : 'unsprinklered'}): ${over.map(roomLabel).join(', ')}`,
      nodes: over,
    });
  if (single.length)
    findings.push({
      severity: 'medium',
      message: `${single.length} room(s) can reach only ONE exit — no egress redundancy: ${single.map(roomLabel).join(', ')}`,
      nodes: single,
    });
  const furthest = rooms.reduce((m, r) => Math.max(m, nearest.get(r) ?? 0), 0);
  return {
    key: 'exitCoverage',
    label: 'Exit coverage',
    score:
      20 * (1 - unreachable.length / total) +
      12 * (1 - over.length / total) +
      8 * (1 - single.length / total),
    maxScore: 40,
    findings,
    metrics: {
      rooms: rooms.length,
      exits: ex.exitNodeIds.length,
      unreachable: unreachable.length,
      overTravelLimit: over.length,
      singleExitDependent: single.length,
      furthestRoomM: Math.round(furthest),
      travelLimitM: limit,
    },
  };
}

export function scoreAedReach(ex: Extracted): CategoryScore {
  const aeds = ids(ex.graph, 'aed:');
  const rooms = ex.roomNodeIds;
  if (!aeds.length)
    return {
      key: 'aedReach',
      label: 'AED reach',
      score: 0,
      maxScore: 20,
      findings: [
        {
          severity: 'critical',
          message: 'No AED is mapped on this floor. Scored 0 rather than passed.',
        },
      ],
      metrics: { aeds: 0, rooms: rooms.length, covered: 0, reachLimitM: AED_REACH_M },
    };
  const nearest = distancesFromAny(ex.graph, aeds);
  const uncovered = rooms.filter((r) => (nearest.get(r) ?? Infinity) > AED_REACH_M);
  const findings: Finding[] = uncovered.length
    ? [
        {
          severity: 'high',
          message: `${uncovered.length} room(s) are more than ${AED_REACH_M} m from the nearest AED: ${uncovered.map(roomLabel).join(', ')}`,
          nodes: uncovered,
        },
      ]
    : [];
  return {
    key: 'aedReach',
    label: 'AED reach',
    score: 20 * (1 - uncovered.length / (rooms.length || 1)),
    maxScore: 20,
    findings,
    metrics: {
      aeds: aeds.length,
      rooms: rooms.length,
      covered: rooms.length - uncovered.length,
      reachLimitM: AED_REACH_M,
    },
  };
}

/** Undirected bridges (Tarjan). An edge whose removal disconnects the graph is a single point of failure. */
export function findBridges(g: NavGraph): Array<[string, string]> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges: Array<[string, string]> = [];
  let time = 0;
  const dfs = (u: string, parent: string | null): void => {
    disc.set(u, ++time);
    low.set(u, time);
    for (const v of g.adj[u] ?? []) {
      if (v === parent) continue;
      if (!disc.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > disc.get(u)!) bridges.push([u, v]);
      } else low.set(u, Math.min(low.get(u)!, disc.get(v)!));
    }
  };
  for (const n of Object.keys(g.nodes)) if (!disc.has(n)) dfs(n, null);
  return bridges;
}

export interface Spof {
  edge: [string, string];
  /** Rooms that lose every exit when this edge is cut. */
  strandedRooms: string[];
}

export function findSpofs(ex: Extracted): Spof[] {
  const out: Spof[] = [];
  for (const [a, b] of findBridges(ex.graph)) {
    // Ignore leaf edges to a single room/amenity: cutting a room's own door strands only that room, which is expected.
    const cut: NavGraph = {
      nodes: ex.graph.nodes,
      adj: {
        ...ex.graph.adj,
        [a]: (ex.graph.adj[a] ?? []).filter((n) => n !== b),
        [b]: (ex.graph.adj[b] ?? []).filter((n) => n !== a),
      },
    };
    const nearest = distancesFromAny(cut, ex.exitNodeIds);
    const stranded = ex.roomNodeIds.filter((r) => !nearest.has(r));
    if (stranded.length >= 2) out.push({ edge: [a, b], strandedRooms: stranded });
  }
  return out.sort((x, y) => y.strandedRooms.length - x.strandedRooms.length);
}

export function scoreRedundancy(ex: Extracted): CategoryScore {
  const spofs = findSpofs(ex);
  const worst = spofs[0]?.strandedRooms.length ?? 0;
  const total = ex.roomNodeIds.length || 1;
  const findings: Finding[] = spofs
    .slice(0, 5)
    .map((s) => ({
      severity: s.strandedRooms.length / total > 0.5 ? 'critical' : 'high',
      message: `Cutting ${s.edge[0]} — ${s.edge[1]} strands ${s.strandedRooms.length} room(s): ${s.strandedRooms.map(roomLabel).join(', ')}`,
      nodes: s.strandedRooms,
    }));
  return {
    key: 'redundancy',
    label: 'Corridor redundancy',
    score: 20 * (1 - worst / total),
    maxScore: 20,
    findings,
    metrics: { singlePointsOfFailure: spofs.length, worstCaseStranded: worst },
  };
}

export function scoreAccessibility(ex: Extracted, floor: FeatureCollection): CategoryScore {
  const barred = new Set(
    floorPois(floor)
      .filter((p) => p.category === 'exit' && !p.accessible)
      .map((p) => `exit:${p.id}`),
  );
  const stepFreeExits = ex.exitNodeIds.filter((e) => !barred.has(e));
  const refuges = [...ids(ex.graph, 'refuge:'), ...ids(ex.graph, 'assembly:')];
  const stairs = new Set(ids(ex.graph, 'stairwell:'));
  const g: NavGraph = {
    nodes: ex.graph.nodes,
    adj: Object.fromEntries(
      Object.entries(ex.graph.adj)
        .filter(([k]) => !stairs.has(k))
        .map(([k, v]) => [k, v.filter((n) => !stairs.has(n))]),
    ),
  };
  const nearest = distancesFromAny(g, stepFreeExits);
  const nearestRefuge = distancesFromAny(g, refuges);
  const rooms = ex.roomNodeIds;
  const noExit = rooms.filter((r) => !nearest.has(r));
  const noRefugeEither = noExit.filter((r) => !nearestRefuge.has(r));
  const findings: Finding[] = [];
  if (!stepFreeExits.length)
    findings.push({ severity: 'critical', message: 'No step-free exit on this floor.' });
  if (noRefugeEither.length)
    findings.push({
      severity: 'critical',
      message: `${noRefugeEither.length} room(s) have neither a step-free exit nor an area of refuge: ${noRefugeEither.map(roomLabel).join(', ')}`,
      nodes: noRefugeEither,
    });
  else if (noExit.length)
    findings.push({
      severity: 'medium',
      message: `${noExit.length} room(s) rely on an area of refuge (no step-free exit reachable): ${noExit.map(roomLabel).join(', ')}`,
      nodes: noExit,
    });
  const total = rooms.length || 1;
  return {
    key: 'accessibility',
    label: 'Accessible egress',
    score: 12 * (1 - noExit.length / total) + 8 * (1 - noRefugeEither.length / total),
    maxScore: 20,
    findings,
    metrics: {
      stepFreeExits: stepFreeExits.length,
      refuges: refuges.length,
      roomsWithoutStepFreeExit: noExit.length,
      roomsWithoutAnyAccessibleEgress: noRefugeEither.length,
    },
  };
}

export interface HazardImpact {
  nodeId: string;
  /** Rooms whose nearest-exit distance grows by more than 25% with a hazard centred here. */
  roomsAffected: number;
  roomsStranded: number;
}

/** Where would a fire hurt most? Rank spine nodes by the damage a hazard disc there does to egress. */
export function rankHazardCorridors(ex: Extracted, limit = 5): HazardImpact[] {
  const base = distancesFromAny(ex.graph, ex.exitNodeIds);
  const out: HazardImpact[] = [];
  for (const n of ex.spineNodeIds) {
    const c = ex.graph.nodes[n]!;
    const blocked = new Set(
      Object.entries(ex.graph.nodes)
        .filter(([, p]) => Math.hypot(p.x - c.x, p.y - c.y) <= HAZARD_RADIUS_M)
        .map(([id]) => id),
    );
    const g: NavGraph = {
      nodes: ex.graph.nodes,
      adj: Object.fromEntries(
        Object.entries(ex.graph.adj)
          .filter(([k]) => !blocked.has(k))
          .map(([k, v]) => [k, v.filter((x) => !blocked.has(x))]),
      ),
    };
    const d = distancesFromAny(
      g,
      ex.exitNodeIds.filter((e) => !blocked.has(e)),
    );
    let affected = 0;
    let stranded = 0;
    for (const r of ex.roomNodeIds) {
      if (blocked.has(r)) continue;
      const nd = d.get(r);
      if (nd === undefined) stranded++;
      else if (nd > (base.get(r) ?? 0) * 1.25) affected++;
    }
    out.push({ nodeId: n, roomsAffected: affected, roomsStranded: stranded });
  }
  return out
    .sort((a, b) => b.roomsStranded - a.roomsStranded || b.roomsAffected - a.roomsAffected)
    .slice(0, limit);
}

export type ResilienceBand = 'resilient' | 'adequate' | 'deficient';
export interface ResilienceAudit {
  level: string;
  sprinklered: boolean;
  score: number;
  maxScore: number;
  band: ResilienceBand;
  categories: CategoryScore[];
  hazardHotspots: HazardImpact[];
  caveat: string;
}

export const bandFor = (pct: number): ResilienceBand =>
  pct >= 85 ? 'resilient' : pct >= 65 ? 'adequate' : 'deficient';

export function auditFloor(
  level: string,
  floor: FeatureCollection,
  sprinklered = true,
): ResilienceAudit {
  const ex = extractedFor(floor);
  const categories = [
    scoreExitCoverage(ex, sprinklered),
    scoreAedReach(ex),
    scoreRedundancy(ex),
    scoreAccessibility(ex, floor),
  ];
  const score = categories.reduce((s, c) => s + c.score, 0);
  const maxScore = categories.reduce((s, c) => s + c.maxScore, 0);
  return {
    level,
    sprinklered,
    score: Math.round(score * 10) / 10,
    maxScore,
    band: bandFor((score / maxScore) * 100),
    categories,
    hazardHotspots: rankHazardCorridors(ex),
    caveat:
      'Distances are graph travel distances along mapped corridors and doors — a proxy for NFPA 101 travel distance, not a code-official measurement. Findings are for a safety officer to review; this report does not certify a building.',
  };
}

export function renderAuditMarkdown(a: ResilienceAudit): string {
  const lines = [
    `# Resilience audit — ${a.level}`,
    '',
    `**Score:** ${a.score} / ${a.maxScore} (${a.band}) · ${a.sprinklered ? 'sprinklered' : 'unsprinklered'} limits`,
    '',
    `> ${a.caveat}`,
    '',
  ];
  for (const c of a.categories) {
    lines.push(`## ${c.label} — ${Math.round(c.score * 10) / 10} / ${c.maxScore}`, '');
    for (const [k, v] of Object.entries(c.metrics)) lines.push(`- ${k}: ${v}`);
    if (c.findings.length) {
      lines.push('');
      for (const f of c.findings) lines.push(`- **${f.severity.toUpperCase()}** ${f.message}`);
    }
    lines.push('');
  }
  if (a.hazardHotspots.length) {
    lines.push('## Hazard hotspots (worst corridor positions for a fire)', '');
    for (const h of a.hazardHotspots)
      lines.push(
        `- ${h.nodeId}: strands ${h.roomsStranded}, lengthens egress for ${h.roomsAffected}`,
      );
  }
  return lines.join('\n');
}
