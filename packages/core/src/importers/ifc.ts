/**
 * IFC (STEP) → floor contract.
 *   IfcBuildingStorey → storey selection (index); IfcSpace → room polygon from a FootPrint/Body
 *   representation (IfcPolyline / IfcArbitraryClosedProfileDef / IfcExtrudedAreaSolid) placed via
 *   its IfcLocalPlacement chain; a space named Assembly/Refuge/First Aid/AED becomes that amenity;
 *   IfcDoor → opening (a door named Exit/Egress → EXIT); IfcStair → stairwell.
 * IFC rarely carries a corridor centreline, so the spine is synthesised from the doors. Door-less
 * spaces get an opening INFERRED at the centroid, marked `inferred: true`.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { AmenityCategory, XY } from '../safetymap/floor.js';
import { pointInRing, ringCentroid } from '../safetymap/floor.js';
import { parseStep, type StepModel, type StepRecord, type StepValue } from './step.js';
import { synthesizeSpine } from './spine.js';

export interface IfcTransform {
  scale: number;
  originX: number;
  originY: number;
  flipY?: boolean;
}
export interface IfcNameMap {
  exit: RegExp;
  inaccessibleExit: RegExp;
  amenity: Partial<Record<AmenityCategory, RegExp>>;
}
export const DEFAULT_IFC_NAME_MAP: IfcNameMap = {
  exit: /exit|egress|evac/i,
  inaccessibleExit: /stair|nostep|inaccessible/i,
  amenity: {
    assembly: /assembly|muster/i,
    refuge: /refuge|area of refuge/i,
    first_aid: /first.?aid|medical|infirmary|treatment/i,
    aed: /aed|defib/i,
  },
};
export interface IfcConvertOptions {
  transform?: Partial<IfcTransform>;
  nameMap?: IfcNameMap;
  storeyIndex?: number;
}
export interface IfcConvertReport {
  floor: FeatureCollection;
  storey: string | null;
  counts: Record<string, number>;
  inferredOpenings: number;
}

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 0, 1, 0];
const apply = (m: Mat, p: XY): XY => [
  m[0] * p[0] + m[1] * p[1] + m[2],
  m[3] * p[0] + m[4] * p[1] + m[5],
];
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[3],
  a[0] * b[1] + a[1] * b[4],
  a[0] * b[2] + a[1] * b[5] + a[2],
  a[3] * b[0] + a[4] * b[3],
  a[3] * b[1] + a[4] * b[4],
  a[3] * b[2] + a[4] * b[5] + a[5],
];
const trs = (tx: number, ty: number, ang: number): Mat => [
  Math.cos(ang),
  -Math.sin(ang),
  tx,
  Math.sin(ang),
  Math.cos(ang),
  ty,
];
const isRef = (v: StepValue | undefined): v is { ref: number } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'ref' in v;
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

class Ifc {
  constructor(readonly m: StepModel) {}
  rec(v: StepValue | undefined): StepRecord | undefined {
    return isRef(v) ? this.m.records.get(v.ref) : undefined;
  }
  xy(v: StepValue | undefined): XY | null {
    const r = this.rec(v);
    const list = r?.args[0];
    if (!Array.isArray(list)) return null;
    const [x, y] = list;
    return typeof x === 'number' && typeof y === 'number' ? [x, y] : null;
  }
  placement(v: StepValue | undefined): Mat {
    const lp = this.rec(v);
    if (!lp || lp.type !== 'IFCLOCALPLACEMENT') return IDENT;
    const parent = this.placement(lp.args[0]);
    const ax = this.rec(lp.args[1]);
    let local: Mat = IDENT;
    if (ax) {
      const loc = this.xy(ax.args[0]) ?? [0, 0];
      const dir = this.xy(ax.type === 'IFCAXIS2PLACEMENT2D' ? ax.args[1] : ax.args[2]);
      local = trs(loc[0], loc[1], dir ? Math.atan2(dir[1], dir[0]) : 0);
    }
    return mul(parent, local);
  }
  ring(v: StepValue | undefined, pre: Mat = IDENT): XY[] | null {
    const r = this.rec(v);
    if (!r) return null;
    switch (r.type) {
      case 'IFCPOLYLINE': {
        const pts = Array.isArray(r.args[0]) ? r.args[0] : [];
        const ring = pts
          .map((pt) => this.xy(pt))
          .filter((p): p is XY => !!p)
          .map((p) => apply(pre, p));
        return ring.length >= 3 ? ring : null;
      }
      case 'IFCARBITRARYCLOSEDPROFILEDEF':
      case 'IFCARBITRARYPROFILEDEFWITHVOIDS':
        return this.ring(r.args[2], pre);
      case 'IFCEXTRUDEDAREASOLID': {
        const pos = this.rec(r.args[1]);
        let m = pre;
        if (pos) {
          const loc = this.xy(pos.args[0]) ?? [0, 0];
          const dir = this.xy(pos.args[2]);
          m = mul(pre, trs(loc[0], loc[1], dir ? Math.atan2(dir[1], dir[0]) : 0));
        }
        return this.ring(r.args[0], m);
      }
      case 'IFCGEOMETRICCURVESET':
      case 'IFCGEOMETRICSET':
      case 'IFCFACEBASEDSURFACEMODEL': {
        const items = Array.isArray(r.args[0]) ? r.args[0] : [];
        for (const it of items) {
          const ring = this.ring(it, pre);
          if (ring) return ring;
        }
        return null;
      }
      default:
        return null;
    }
  }
  footprint(repRef: StepValue | undefined, world: Mat): XY[] | null {
    const pds = this.rec(repRef);
    if (!pds) return null;
    const reps = Array.isArray(pds.args[2]) ? pds.args[2] : [];
    const shapes = reps.map((x) => this.rec(x)).filter((s): s is StepRecord => !!s);
    const ordered = [
      ...shapes.filter((s) => /footprint|annotation|plan/i.test(String(s.args[1] ?? ''))),
      ...shapes,
    ];
    for (const shape of ordered) {
      const items = Array.isArray(shape.args[3]) ? shape.args[3] : [];
      for (const it of items) {
        const ring = this.ring(it, world);
        if (ring) return ring;
      }
    }
    return null;
  }
}

const closeRing = (ring: XY[]): XY[] => {
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

export function ifcModelToFloor(
  model: StepModel,
  options: IfcConvertOptions = {},
): IfcConvertReport {
  const t: IfcTransform = { scale: 1, originX: 0, originY: 0, flipY: false, ...options.transform };
  const nm = options.nameMap ?? DEFAULT_IFC_NAME_MAP;
  const ifc = new Ifc(model);
  const grid = (p: XY): XY => [
    Math.round((p[0] - t.originX) * t.scale * 1000) / 1000,
    Math.round((p[1] - t.originY) * t.scale * (t.flipY ? -1 : 1) * 1000) / 1000,
  ];
  const nameOf = (r: StepRecord, longIdx?: number): string => {
    const long = longIdx !== undefined ? r.args[longIdx] : undefined;
    const short = r.args[2];
    return (typeof long === 'string' && long) || (typeof short === 'string' && short) || '';
  };
  const classify = (name: string): AmenityCategory | null => {
    for (const [cat, re] of Object.entries(nm.amenity))
      if (re?.test(name)) return cat as AmenityCategory;
    return null;
  };
  const counts: Record<string, number> = {};
  const bump = (k: string): void => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const features: Feature[] = [];

  const storeys = model.byType('IFCBUILDINGSTOREY');
  const storey = storeys[options.storeyIndex ?? 0];
  const storeyPlacement = storey && isRef(storey.args[5]) ? storey.args[5].ref : null;
  const inStorey = (placementRef: StepValue | undefined): boolean => {
    if (storeyPlacement === null) return true;
    let cur = ifc.rec(placementRef);
    let guard = 0;
    while (cur && cur.type === 'IFCLOCALPLACEMENT' && guard++ < 64) {
      if (cur.id === storeyPlacement) return true;
      cur = ifc.rec(cur.args[0]);
    }
    return false;
  };

  const amenityN = new Map<string, number>();
  const pushAmenity = (
    category: AmenityCategory,
    name: string,
    at: XY,
    extra: Record<string, unknown> = {},
  ): void => {
    const n = (amenityN.get(category) ?? 0) + 1;
    amenityN.set(category, n);
    features.push({
      type: 'Feature',
      properties: {
        feature_type: 'amenity',
        category,
        id: `${category}${n}`,
        name: name || category,
        ...extra,
      },
      geometry: { type: 'Point', coordinates: at },
    });
    bump(`amenity:${category}`);
  };

  const rooms: Array<{ id: string; ring: XY[]; name: string }> = [];
  for (const sp of model.byType('IFCSPACE')) {
    if (!inStorey(sp.args[5])) continue;
    const local = ifc.footprint(sp.args[6], ifc.placement(sp.args[5]));
    if (!local) continue;
    const ring = closeRing(local.map(grid));
    if (ring.length < 4) continue;
    const name = nameOf(sp, 7);
    const amen = classify(name);
    if (amen) {
      pushAmenity(amen, name, ringCentroid(ring));
      continue;
    }
    rooms.push({ id: '', ring, name: name || `Room ${rooms.length + 1}` });
  }
  const seen = new Map<string, number>();
  for (const r of rooms) {
    const s = slug(r.name);
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    r.id = n === 1 ? s : `${s}-${n}`;
    features.push({
      type: 'Feature',
      properties: { feature_type: 'unit', category: 'room', id: r.id, name: r.name },
      geometry: { type: 'Polygon', coordinates: [r.ring] },
    });
    bump('room');
  }

  const doorPts: XY[] = [];
  let doorN = 0;
  const served = new Set<string>();
  for (const d of model.byType('IFCDOOR')) {
    if (!inStorey(d.args[5])) continue;
    const loc = grid(apply(ifc.placement(d.args[5]), [0, 0]));
    const name = nameOf(d);
    if (nm.exit.test(name)) {
      pushAmenity('exit', name, loc, { accessible: !nm.inaccessibleExit.test(name) });
      continue;
    }
    doorN += 1;
    let unit = rooms.find((r) => pointInRing(loc, r.ring))?.id;
    if (!unit && rooms.length) {
      let best = rooms[0]!;
      for (const r of rooms) {
        const c = ringCentroid(r.ring);
        const cb = ringCentroid(best.ring);
        if (Math.hypot(c[0] - loc[0], c[1] - loc[1]) < Math.hypot(cb[0] - loc[0], cb[1] - loc[1]))
          best = r;
      }
      unit = best.id;
    }
    if (unit) served.add(unit);
    doorPts.push(loc);
    features.push({
      type: 'Feature',
      properties: { feature_type: 'opening', id: `d${doorN}`, unit: unit ?? '' },
      geometry: { type: 'Point', coordinates: loc },
    });
    bump('opening');
  }
  for (const st of model.byType('IFCSTAIR')) {
    if (!inStorey(st.args[5])) continue;
    pushAmenity(
      'stairwell',
      nameOf(st) || 'Stairwell',
      grid(apply(ifc.placement(st.args[5]), [0, 0])),
    );
  }
  let inferred = 0;
  for (const r of rooms) {
    if (served.has(r.id)) continue;
    const c = ringCentroid(r.ring);
    inferred += 1;
    features.push({
      type: 'Feature',
      properties: {
        feature_type: 'opening',
        id: `inferred-door-${inferred}`,
        unit: r.id,
        inferred: true,
      },
      geometry: { type: 'Point', coordinates: c },
    });
    doorPts.push(c);
    bump('opening:inferred');
  }
  const lines = synthesizeSpine(doorPts);
  if (lines.length) {
    features.push({
      type: 'Feature',
      properties: { feature_type: 'path', id: 'spine', synthesized: true },
      geometry: { type: 'MultiLineString', coordinates: lines },
    });
    bump('path');
  }
  return {
    floor: { type: 'FeatureCollection', features },
    storey: storey ? nameOf(storey, 7) || nameOf(storey) : null,
    counts,
    inferredOpenings: inferred,
  };
}

export function ifcToFloor(text: string, options: IfcConvertOptions = {}): IfcConvertReport {
  return ifcModelToFloor(parseStep(text), options);
}
