/**
 * Cursor-on-Target (CoT) — the XML ATAK/WinTAK/iTAK already speak. String generation only: no
 * network, no library; a CoT file can be produced with the network down and carried out on a USB
 * stick. It does not talk to a TAK server; transport is a separate decision.
 *
 * ⚠️ Type atoms are a first draft that renders sensibly, documented per kind for review by someone
 * with real ATAK experience.
 */
import type { FeatureCollection } from 'geojson';
import { metersToLngLat, type VenueAnchor } from '../geo/anchor.js';
import { floorPois } from '../safetymap/floor.js';
import { HAZARD_RADIUS_M } from '../safetymap/planner.js';
import type { Incident } from '../comms/types.js';

export type CotKind =
  | 'incident'
  | 'exit'
  | 'assembly'
  | 'refuge'
  | 'aed'
  | 'first_aid'
  | 'fire_extinguisher'
  | 'stairwell'
  | 'hazard';

/**
 *  b-a-o-tbl  emergency/alert atom — an incident should light up, not sit as a marker
 *  b-m-p-s-m  generic spot marker — fixed points whose meaning is in the label
 *  u-d-f      user-drawn freeform shape — how a hazard polygon travels
 */
const TYPE_FOR: Record<CotKind, string> = {
  incident: 'b-a-o-tbl',
  exit: 'b-m-p-s-m',
  assembly: 'b-m-p-s-m',
  refuge: 'b-m-p-s-m',
  aed: 'b-m-p-s-m',
  first_aid: 'b-m-p-s-m',
  fire_extinguisher: 'b-m-p-s-m',
  stairwell: 'b-m-p-s-m',
  hazard: 'u-d-f',
};
/** Building fabric lives a day; an incident expires quickly so stale alerts do not litter the picture. */
const STALE_S: Record<CotKind, number> = {
  incident: 300,
  hazard: 900,
  exit: 86400,
  assembly: 86400,
  refuge: 86400,
  aed: 86400,
  first_aid: 86400,
  fire_extinguisher: 86400,
  stairwell: 86400,
};
/** CoT's sentinel for unknown numeric fields, exactly as written on the wire. */
const UNKNOWN = '9999999.0';

export interface CotEntity {
  kind: CotKind;
  id: string;
  label: string;
  xy: [number, number];
  remarks?: string;
  ring?: Array<[number, number]>;
}
export interface CotOptions {
  anchor: VenueAnchor;
  venueSlug: string;
  now?: Date;
}

export const escapeXml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function toCotEvent(e: CotEntity, o: CotOptions): string {
  const now = o.now ?? new Date();
  const stale = new Date(now.getTime() + STALE_S[e.kind] * 1000);
  const [lon, lat] = metersToLngLat(o.anchor, e.xy);
  const uid = `terranova.${o.venueSlug}.${e.kind}.${e.id}`;
  const detail = [`<contact callsign="${escapeXml(e.label)}"/>`];
  if (e.remarks) detail.push(`<remarks>${escapeXml(e.remarks)}</remarks>`);
  if (e.kind === 'hazard' && e.ring?.length) {
    const links = e.ring
      .map((p) => {
        const [plon, plat] = metersToLngLat(o.anchor, p);
        return `<link point="${plat.toFixed(7)},${plon.toFixed(7)},0"/>`;
      })
      .join('');
    detail.push(`<shape><polyline closed="1">${links}</polyline></shape>`);
  }
  return (
    `<event version="2.0" uid="${escapeXml(uid)}" type="${TYPE_FOR[e.kind]}" how="m-g" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">` +
    `<point lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}" hae="${UNKNOWN}" ce="${UNKNOWN}" le="${UNKNOWN}"/>` +
    `<detail>${detail.join('')}</detail></event>`
  );
}

export function toCotDocument(entities: CotEntity[], o: CotOptions): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<events>\n  ${entities.map((e) => toCotEvent(e, o)).join('\n  ')}\n</events>\n`;
}

/** Everything a crew needs from one floor: fixed assets plus the live incident and hazard disc. */
export function cotEntitiesForFloor(
  floor: FeatureCollection,
  level: string,
  incidents: Incident[] = [],
): CotEntity[] {
  const out: CotEntity[] = [];
  for (const p of floorPois(floor)) {
    const kind = (p.category === 'assembly' ? 'assembly' : p.category) as CotKind;
    if (!(kind in TYPE_FOR)) continue;
    out.push({
      kind,
      id: `${level}:${p.id}`,
      label: p.name,
      xy: p.xy,
      remarks: `${p.category.replace('_', ' ')} · ${level}${p.accessible ? '' : ' · not step-free'}`,
    });
  }
  for (const inc of incidents) {
    if (inc.status === 'resolved' || inc.level !== level || !inc.hazardXY) continue;
    out.push({
      kind: 'incident',
      id: inc.id,
      label: inc.title,
      xy: inc.hazardXY,
      remarks: `${inc.type} · ${inc.severity} · ${inc.status} · ${inc.location}`,
    });
    const ring: Array<[number, number]> = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push([
        inc.hazardXY[0] + HAZARD_RADIUS_M * Math.cos(a),
        inc.hazardXY[1] + HAZARD_RADIUS_M * Math.sin(a),
      ]);
    }
    out.push({
      kind: 'hazard',
      id: `${inc.id}-zone`,
      label: `Hazard zone — ${inc.title}`,
      xy: inc.hazardXY,
      ring,
      remarks: `${HAZARD_RADIUS_M} m hazard radius`,
    });
  }
  return out;
}
