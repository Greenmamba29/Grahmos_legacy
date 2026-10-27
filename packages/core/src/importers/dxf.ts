/**
 * DXF → floor contract. Dependency-free ASCII-DXF reader focused on what a flattened floor-plan
 * export contains: LWPOLYLINE/POLYLINE (rooms, walkways, centrelines), POINT/CIRCLE (doors,
 * amenities), TEXT/MTEXT (labels). Blocks, arcs and splines are not resolved; a pilot floor is
 * exported flat to the layer convention below.
 *
 * Layer convention (case-insensitive; override with `layerMap`):
 *   rooms       closed polylines on ROOM / UNIT / SPACE / CONCOURSE / HALL / SUITE / WARD
 *   walkway     closed polyline on WALKWAY / CORRIDOR
 *   refuge      closed polyline on REFUGE (an area of refuge unit)
 *   compartment closed polyline on COMPARTMENT / SMOKE
 *   path        open polyline on PATH / CENTERLINE / NAV / ROUTE
 *   openings    POINT/CIRCLE on DOOR / OPENING
 *   amenities   POINT/CIRCLE on EXIT / AED / STAIR / FIRST_AID / EXTINGUISHER / ASSEMBLY / REFUGE_PT / YOU_ARE_HERE
 *   labels      TEXT inside a room becomes its name; TEXT nearest an amenity (≤ 3 m) names it
 *   accessibility: an exit on a layer containing NOSTEP / INACCESSIBLE / STAIR_EXIT is `accessible: false`
 */
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { AmenityCategory, XY } from '../safetymap/floor.js';
import { pointInRing } from '../safetymap/floor.js';

export interface DxfEntity {
  type: string;
  layer: string;
  points: XY[];
  text?: string;
  closed?: boolean;
  radius?: number;
}

interface Pair {
  code: number;
  value: string;
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) {
      i -= 1;
      continue;
    }
    pairs.push({ code, value: lines[i + 1]! });
  }
  return pairs;
}

export function parseDxf(text: string): DxfEntity[] {
  const pairs = tokenize(text);
  let start = -1;
  let end = pairs.length;
  for (let i = 0; i < pairs.length - 1; i++) {
    const p = pairs[i]!;
    if (
      p.code === 0 &&
      p.value.trim() === 'SECTION' &&
      pairs[i + 1]?.code === 2 &&
      pairs[i + 1]!.value.trim() === 'ENTITIES'
    )
      start = i + 2;
    if (start >= 0 && i > start && p.code === 0 && p.value.trim() === 'ENDSEC') {
      end = i;
      break;
    }
  }
  if (start < 0) return [];
  const out: DxfEntity[] = [];
  let cur: DxfEntity | null = null;
  let pendingX: number | null = null;
  const flush = (): void => {
    if (cur) out.push(cur);
    cur = null;
    pendingX = null;
  };
  for (let i = start; i < end; i++) {
    const { code, value } = pairs[i]!;
    const v = value.trim();
    if (code === 0) {
      flush();
      if (v === 'SEQEND' || v === 'VERTEX') {
        // VERTEX records belong to the preceding POLYLINE; fold them in.
        if (v === 'VERTEX' && out.length && out[out.length - 1]!.type === 'POLYLINE') {
          cur = out.pop()!;
        }
        continue;
      }
      cur = { type: v, layer: '0', points: [] };
      continue;
    }
    if (!cur) continue;
    switch (code) {
      case 8:
        cur.layer = v;
        break;
      case 10:
        pendingX = Number(v);
        break;
      case 20:
        if (pendingX !== null) {
          cur.points.push([pendingX, Number(v)]);
          pendingX = null;
        }
        break;
      case 70:
        cur.closed = (Number(v) & 1) === 1;
        break;
      case 40:
        cur.radius = Number(v);
        break;
      case 1:
      case 3:
        cur.text =
          (cur.text ?? '') +
          v
            .replace(/\\P/g, ' ')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\[A-Za-z][^;]*;/g, '');
        break;
    }
  }
  flush();
  return out;
}

export interface DxfTransform {
  /** Multiply drawing units by this to get metres (mm → m is 0.001). */
  scale: number;
  originX: number;
  originY: number;
  flipY?: boolean;
}

export interface DxfLayerMap {
  room: RegExp;
  walkway: RegExp;
  refugeUnit: RegExp;
  compartment: RegExp;
  path: RegExp;
  opening: RegExp;
  label: RegExp;
  inaccessible: RegExp;
  amenity: Partial<Record<AmenityCategory, RegExp>>;
}

export const DEFAULT_LAYER_MAP: DxfLayerMap = {
  room: /room|unit|space|a-area|concourse|hall|suite|ward|icu|office/i,
  walkway: /walkway|corridor(?!.*line)/i,
  refugeUnit: /^refuge(?!.?pt)/i,
  compartment: /compartment|smoke/i,
  path: /path|centerline|centreline|nav|circulation.?line|route/i,
  opening: /door|opening|egress.?door/i,
  label: /label|text|name|annot/i,
  inaccessible: /nostep|inaccessible|stair.?exit/i,
  amenity: {
    exit: /exit|egress(?!.*door)/i,
    aed: /aed|defib/i,
    stairwell: /^stair(?!.?exit)/i,
    first_aid: /first.?aid|medical/i,
    fire_extinguisher: /extinguisher|fire.?ext/i,
    assembly: /assembly|muster/i,
    refuge: /refuge.?pt|area.?of.?refuge/i,
    you_are_here: /you.?are.?here|position|origin/i,
  },
};

export interface DxfConvertOptions {
  transform?: Partial<DxfTransform>;
  layerMap?: DxfLayerMap;
  /** Max distance (m) between a TEXT insertion point and an amenity for the text to name it. */
  labelSnapM?: number;
}

export interface DxfConvertReport {
  floor: FeatureCollection;
  counts: Record<string, number>;
  /** Entities on layers no rule matched, as "<type>@<layer>". */
  ignored: string[];
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

export function dxfToFloor(text: string, options: DxfConvertOptions = {}): DxfConvertReport {
  const t: DxfTransform = { scale: 1, originX: 0, originY: 0, flipY: false, ...options.transform };
  const lm = options.layerMap ?? DEFAULT_LAYER_MAP;
  const labelSnap = options.labelSnapM ?? 3;
  const xf = (p: XY): XY => [
    Math.round((p[0] - t.originX) * t.scale * 1000) / 1000,
    Math.round((t.flipY ? -1 : 1) * (p[1] - t.originY) * t.scale * 1000) / 1000,
  ];
  const entities = parseDxf(text);
  const features: Feature[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string): void => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const ignored: string[] = [];
  const labels: Array<{ at: XY; text: string }> = [];
  const polys: Array<{
    ring: XY[];
    layer: string;
    kind: 'room' | 'walkway' | 'refuge' | 'compartment';
  }> = [];
  const amenities: Array<{
    at: XY;
    category: AmenityCategory;
    layer: string;
    accessible: boolean;
  }> = [];
  const openings: XY[] = [];
  const paths: XY[][] = [];

  for (const e of entities) {
    const L = e.layer;
    const pts = e.points.map(xf);
    if (e.type === 'TEXT' || e.type === 'MTEXT') {
      if (pts[0] && e.text?.trim()) labels.push({ at: pts[0], text: e.text.trim() });
      continue;
    }
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      if (pts.length < 2) continue;
      const closedRing = (): XY[] =>
        pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]
          ? pts
          : [...pts, pts[0]!];
      if (lm.compartment.test(L)) polys.push({ ring: closedRing(), layer: L, kind: 'compartment' });
      else if (lm.walkway.test(L)) polys.push({ ring: closedRing(), layer: L, kind: 'walkway' });
      else if (lm.refugeUnit.test(L)) polys.push({ ring: closedRing(), layer: L, kind: 'refuge' });
      else if (lm.path.test(L)) paths.push(pts);
      else if (lm.room.test(L) || e.closed)
        polys.push({ ring: closedRing(), layer: L, kind: 'room' });
      else ignored.push(`${e.type}@${L}`);
      continue;
    }
    if (e.type === 'POINT' || e.type === 'CIRCLE' || e.type === 'INSERT') {
      const at = pts[0];
      if (!at) continue;
      if (lm.opening.test(L)) {
        openings.push(at);
        continue;
      }
      const cat = (Object.keys(lm.amenity) as AmenityCategory[]).find((c) =>
        lm.amenity[c]!.test(L),
      );
      if (cat) {
        amenities.push({
          at,
          category: cat,
          layer: L,
          accessible: !(cat === 'exit' && lm.inaccessible.test(L)),
        });
        continue;
      }
      ignored.push(`${e.type}@${L}`);
      continue;
    }
    ignored.push(`${e.type}@${L}`);
  }

  // Labels: amenities claim the nearest TEXT within labelSnap FIRST (a door label sits beside its
  // point; a room label sits at the centroid), then units take the TEXT inside their ring.
  const used = new Set<number>();
  const amenityName = new Map<number, string>();
  amenities.forEach((am, ai) => {
    let bestD = labelSnap;
    let bestI = -1;
    for (let i = 0; i < labels.length; i++) {
      if (used.has(i)) continue;
      const d = Math.hypot(labels[i]!.at[0] - am.at[0], labels[i]!.at[1] - am.at[1]);
      if (d <= bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI >= 0) {
      used.add(bestI);
      amenityName.set(ai, labels[bestI]!.text);
    }
  });
  const nameFor = (ring: XY[], fallback: string): string => {
    for (let i = 0; i < labels.length; i++) {
      if (used.has(i)) continue;
      if (pointInRing(labels[i]!.at, ring)) {
        used.add(i);
        return labels[i]!.text;
      }
    }
    return fallback;
  };
  const idCounts = new Map<string, number>();
  const uniqueId = (base: string): string => {
    const n = (idCounts.get(base) ?? 0) + 1;
    idCounts.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  let roomN = 0;
  let compN = 0;
  for (const p of polys) {
    if (p.kind === 'compartment') {
      compN++;
      const name = nameFor(p.ring, `Compartment ${compN}`);
      features.push({
        type: 'Feature',
        properties: { feature_type: 'compartment', id: uniqueId(slug(name)), name },
        geometry: { type: 'Polygon', coordinates: [p.ring] },
      });
      bump('compartment');
    }
  }
  for (const p of polys) {
    if (p.kind === 'compartment') continue;
    if (p.kind === 'walkway') {
      features.push({
        type: 'Feature',
        properties: {
          feature_type: 'unit',
          category: 'walkway',
          id: uniqueId('walkway'),
          name: nameFor(p.ring, 'Corridor'),
        },
        geometry: { type: 'Polygon', coordinates: [p.ring] },
      });
      bump('walkway');
      continue;
    }
    roomN++;
    const name = nameFor(p.ring, `${p.kind === 'refuge' ? 'Refuge' : 'Room'} ${roomN}`);
    features.push({
      type: 'Feature',
      properties: { feature_type: 'unit', category: p.kind, id: uniqueId(slug(name)), name },
      geometry: { type: 'Polygon', coordinates: [p.ring] },
    });
    bump(p.kind);
  }
  // Paths.
  paths.forEach((line, i) => {
    features.push({
      type: 'Feature',
      properties: { feature_type: 'path', id: i === 0 ? 'spine' : `spine-${i + 1}` },
      geometry: { type: 'LineString', coordinates: line },
    });
    bump('path');
  });
  // Openings: attach to the room whose ring contains or is nearest to the door.
  const rooms = features.filter(
    (f) => f.properties?.feature_type === 'unit' && f.properties?.category !== 'walkway',
  );
  openings.forEach((at, i) => {
    let best: { id: string; d: number } | null = null;
    for (const r of rooms) {
      const ring = (r.geometry as Polygon).coordinates[0] as XY[];
      const d = pointInRing(at, ring)
        ? 0
        : Math.min(...ring.map((v) => Math.hypot(v[0] - at[0], v[1] - at[1])));
      if (!best || d < best.d) best = { id: String(r.properties?.id), d };
    }
    features.push({
      type: 'Feature',
      properties: { feature_type: 'opening', id: `d${i + 1}`, unit: best?.id ?? '' },
      geometry: { type: 'Point', coordinates: at },
    });
    bump('opening');
  });
  // Amenities, named by the nearest free TEXT within labelSnap.
  const catN = new Map<string, number>();
  amenities.forEach((a, ai) => {
    const name = amenityName.get(ai) ?? null;
    const n = (catN.get(a.category) ?? 0) + 1;
    catN.set(a.category, n);
    const label = name ?? `${a.category.replace('_', ' ')} ${n}`;
    const props: Record<string, unknown> = {
      feature_type: 'amenity',
      category: a.category,
      id: uniqueId(slug(name ?? `${a.category}-${n}`)),
      name: label,
    };
    if (a.category === 'exit') props.accessible = a.accessible;
    features.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'Point', coordinates: a.at },
    });
    bump(`amenity:${a.category}`);
  });
  return { floor: { type: 'FeatureCollection', features }, counts, ignored };
}
