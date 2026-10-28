/**
 * CMS emergency-preparedness evidence (42 CFR §482.15 elements), derived from the venue's REAL data
 * and the same engines the console routes with — not assertions in prose. An element is satisfied
 * only when at least one concrete artifact backs it; the report names what is missing.
 */
import type { FeatureCollection } from 'geojson';
import { compartmentsOf } from '../safetymap/compartments.js';
import { floorPois, floorRooms } from '../safetymap/floor.js';
import { extractedFor } from '../safetymap/graph.js';
import { planRoutes } from '../safetymap/planner.js';
import type { Incident } from '../comms/types.js';

export interface ComplianceElement {
  id: 'tracking' | 'evacuation' | 'shelter' | 'refuge' | 'communications';
  cite: string;
  title: string;
  requirement: string;
  artifacts: string[];
  satisfied: boolean;
  remediation?: string;
}
export interface ComplianceReport {
  venueName: string;
  level: string;
  generatedAt: string;
  elements: ComplianceElement[];
  coverage: number;
  caveat: string;
}
export interface ComplianceInput {
  floor: FeatureCollection;
  venueName: string;
  level: string;
  incidents?: Incident[];
  relayConfigured?: boolean;
  outboxDurable?: boolean;
  now?: Date;
}

export function buildComplianceReport(input: ComplianceInput): ComplianceReport {
  const { floor, venueName, level } = input;
  const rooms = floorRooms(floor);
  const pois = floorPois(
    floor,
    new Set(['exit', 'refuge', 'assembly', 'checkpoint', 'aed', 'first_aid']),
  );
  const exits = pois.filter((p) => p.category === 'exit');
  const refuges = pois.filter((p) => p.category === 'refuge' || p.category === 'assembly');
  const checkpoints = pois.filter((p) => p.category === 'checkpoint');
  const compartments = compartmentsOf(floor);
  const ex = extractedFor(floor);
  const reachable = ex.roomNodeIds.filter((id) => {
    const xy = ex.graph.nodes[id];
    return !!xy && planRoutes({ floor, mode: 'occupant', originXY: xy }).primary !== null;
  }).length;
  const accessible = planRoutes({ floor, mode: 'accessible' });
  const horizontal = compartments.length
    ? planRoutes({
        floor,
        mode: 'horizontal',
        hazardXY: ex.graph.nodes[ex.roomNodeIds[0] ?? ''] ?? null,
      })
    : null;
  const incidents = input.incidents ?? [];
  const acks = incidents.reduce((s, i) => s + i.alerts.reduce((a, al) => a + al.acks.length, 0), 0);
  const checkins = incidents.reduce((s, i) => s + i.checkins.length, 0);

  const elements: ComplianceElement[] = [
    {
      id: 'tracking',
      cite: '§482.15(b)(2)',
      title: 'Staff and patient location tracking',
      requirement:
        'A system to track the location of on-duty staff and sheltered patients during an emergency.',
      artifacts: [
        ...(checkpoints.length
          ? [
              `${checkpoints.length} surveyed positioning checkpoints on ${level}: ${checkpoints.map((c) => c.name).join(', ')}`,
            ]
          : []),
        ...(checkins
          ? [`${checkins} location check-ins recorded on this device's incident log`]
          : []),
      ],
      satisfied: false,
      remediation:
        'Survey QR/NFC checkpoints on this floor and use check-ins during drills so presence is evidenced.',
    },
    {
      id: 'evacuation',
      cite: '§482.15(b)(1)',
      title: 'Evacuation destinations and routes',
      requirement: 'Safe evacuation, including care-and-treatment needs and exit routes.',
      artifacts: [
        ...(exits.length
          ? [`${exits.length} mapped exits: ${exits.map((e) => e.name).join(', ')}`]
          : []),
        ...(rooms.length
          ? [
              `${reachable}/${rooms.length} occupiable rooms have a computed route to an exit (hazard-aware A*)`,
            ]
          : []),
      ],
      satisfied: false,
      remediation: 'Map at least one exit and ensure every occupiable room can reach it.',
    },
    {
      id: 'shelter',
      cite: '§482.15(b)(3)',
      title: 'Shelter-in-place / defend-in-place',
      requirement: 'Policies for sheltering patients and staff who are not evacuated.',
      artifacts: compartments.length
        ? [
            `${compartments.length} smoke compartments: ${compartments.map((c) => c.name).join(', ')}`,
            ...(horizontal?.primary
              ? [
                  `Horizontal evacuation verified: ${horizontal.primary.destination} in compartment ${horizontal.targetCompartmentId ?? '?'} (${horizontal.primary.distanceFt} ft)`,
                ]
              : []),
          ]
        : [],
      satisfied: false,
      remediation:
        'Digitise the floor’s smoke compartments so defend-in-place zones are mapped and routable.',
    },
    {
      id: 'refuge',
      cite: '§482.15(b)(1)',
      title: 'Areas of refuge and accessible egress',
      requirement:
        'Accessible means of egress for occupants who cannot use stairs, including areas of refuge.',
      artifacts: [
        ...(refuges.length
          ? [
              `${refuges.length} areas of refuge / assembly: ${refuges.map((r) => r.name).join(', ')}`,
            ]
          : []),
        ...(accessible.primary
          ? [
              `Step-free route verified: ${accessible.primary.destination} (${accessible.primary.distanceFt} ft)${accessible.refugeFallback ? ' — via area of refuge; no step-free exit exists' : ''}`,
            ]
          : []),
      ],
      satisfied: false,
      remediation: 'Map an area of refuge and confirm a step-free route reaches it.',
    },
    {
      id: 'communications',
      cite: '§482.15(c)',
      title: 'Communication continuity',
      requirement: 'A communication plan that functions during an interruption of normal systems.',
      artifacts: [
        ...(input.outboxDurable !== false
          ? [
              'Durable offline outbox: incident writes persist locally and flush when a link returns',
            ]
          : []),
        ...(input.relayConfigured
          ? ['Facility relay configured: signed envelopes exchange on the LAN with no WAN']
          : []),
        ...(acks
          ? [`${acks} alert acknowledgements recorded, naming which device saw each alert`]
          : []),
      ],
      satisfied: false,
      remediation:
        'Run a drill with alerts and acknowledgements so the communication path is evidenced, and configure a facility relay.',
    },
  ];
  for (const e of elements) e.satisfied = e.artifacts.length > 0;
  return {
    venueName,
    level,
    generatedAt: (input.now ?? new Date()).toISOString(),
    elements,
    coverage: Math.round((elements.filter((e) => e.satisfied).length / elements.length) * 100),
    caveat:
      'Artifacts are derived from installed venue data and this device’s records. This report supports a surveyor conversation; it is not a certification and the venue data’s own provenance applies.',
  };
}

export function renderComplianceMarkdown(r: ComplianceReport): string {
  const lines = [
    `# Emergency-preparedness evidence — ${r.venueName}, ${r.level}`,
    '',
    `Generated ${r.generatedAt} · coverage ${r.coverage}%`,
    '',
    `> ${r.caveat}`,
    '',
  ];
  for (const e of r.elements) {
    lines.push(
      `## ${e.satisfied ? '✓' : '✗'} ${e.title} (${e.cite})`,
      '',
      `_${e.requirement}_`,
      '',
    );
    if (e.artifacts.length) for (const a of e.artifacts) lines.push(`- ${a}`);
    else lines.push(`- **Not evidenced.** ${e.remediation ?? ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
