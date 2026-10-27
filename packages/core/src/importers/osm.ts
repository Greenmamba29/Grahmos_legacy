/**
 * OSM Simple Indoor Tagging → floor contract. Dependency-free XML reader for <node>/<way>/<tag>.
 *
 *   indoor=room|area (closed way)         → room unit (name from name/ref)
 *   indoor=corridor (closed way)          → walkway unit
 *   indoor=area + emergency=refuge/area_of_refuge → refuge unit
 *   node door=* / entrance=*              → opening; entrance=emergency|exit|main also an EXIT
 *   node emergency=exit / exit=yes        → exit; wheelchair=no → accessible:false
 *   node emergency=defibrillator          → aed; emergency=assembly_point → assembly
 *   node amenity=first_aid / healthcare=* → first_aid; emergency=fire_extinguisher → fire_extinguisher
 *   node highway=steps / stairs=yes       → stairwell
 *   level=<n> filters to one storey (default: the rooms' most common level)
 *
 * WGS84 is projected to venue metres through the supplied anchor (or the data centroid), so an OSM
 * floor lands on the same grid as the pack's site map. OSM seldom has a corridor centreline, so
 * the spine is synthesised from the doors.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { AmenityCategory, XY } from '../safetymap/floor.js';
import { pointInRing } from '../safetymap/floor.js';
import { lngLatToMeters, type VenueAnchor } from '../geo/anchor.js';
import { synthesizeSpine } from './spine.js';

export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}
export interface OsmWay {
  id: string;
  refs: string[];
  tags: Record<string, string>;
}
export interface OsmData {
  nodes: Map<string, OsmNode>;
  ways: OsmWay[];
}

const unescape = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = unescape(m[2]!);
  return out;
}
function tagsIn(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/<tag\s+([^>]*?)\/?>/g)) {
    const a = attrs(m[1]!);
    if (a.k !== undefined) out[a.k] = a.v ?? '';
  }
  return out;
}

export function parseOsm(xml: string): OsmData {
  const nodes = new Map<string, OsmNode>();
  const ways: OsmWay[] = [];
  for (const m of xml.matchAll(/<node\s+([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(m[1]!);
    if (!a.id || a.lat === undefined || a.lon === undefined) continue;
    nodes.set(a.id, {
      id: a.id,
      lat: Number(a.lat),
      lon: Number(a.lon),
      tags: m[3] ? tagsIn(m[3]) : {},
    });
  }
  for (const m of xml.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(m[1]!);
    if (!a.id) continue;
    const refs = [...m[2]!.matchAll(/<nd\s+ref="([^"]+)"/g)].map((x) => x[1]!);
    ways.push({ id: a.id, refs, tags: tagsIn(m[2]!) });
  }
  return { nodes, ways };
}

export interface OsmConvertOptions {
  /** Project through this anchor; default = data centroid, which becomes grid (0,0). */
  anchor?: VenueAnchor;
  level?: string;
}
export interface OsmConvertReport {
  floor: FeatureCollection;
  anchor: VenueAnchor;
  level: string | null;
  counts: Record<string, number>;
}

const levelMatches = (tags: Record<string, string>, target: string | null): boolean => {
  if (target === null) return true;
  const lv = tags.level;
  if (!lv) return true;
  return lv
    .split(';')
    .map((s) => s.trim())
    .includes(target);
};
const isRoom = (t: Record<string, string>): boolean => t.indoor === 'room' || t.indoor === 'area';
const isCorridor = (t: Record<string, string>): boolean => t.indoor === 'corridor';
const isRefugeArea = (t: Record<string, string>): boolean =>
  t.emergency === 'refuge' || t.emergency === 'area_of_refuge' || t.indoor === 'refuge';
const isDoor = (t: Record<string, string>): boolean =>
  (t.door !== undefined && t.door !== 'no') || t.entrance !== undefined;
const EXIT_ENTRANCES = new Set(['emergency', 'exit', 'main']);

function amenityOf(t: Record<string, string>): AmenityCategory | null {
  if (t.emergency === 'exit' || t.exit === 'yes') return 'exit';
  if (t.entrance !== undefined && EXIT_ENTRANCES.has(t.entrance)) return 'exit';
  if (t.emergency === 'defibrillator' || t.defibrillator !== undefined) return 'aed';
  if (t.emergency === 'assembly_point') return 'assembly';
  if (t.emergency === 'fire_extinguisher') return 'fire_extinguisher';
  if (t.amenity === 'first_aid' || t.healthcare !== undefined || t.emergency === 'first_aid')
    return 'first_aid';
  if (t.highway === 'steps' || t.stairs === 'yes' || t.room === 'stairs') return 'stairwell';
  return null;
}
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

export function osmToFloor(xml: string, options: OsmConvertOptions = {}): OsmConvertReport {
  const data = parseOsm(xml);
  // Level: explicit, else the rooms' most common tag.
  let level: string | null = options.level ?? null;
  if (level === null) {
    const counts = new Map<string, number>();
    for (const w of data.ways)
      if (isRoom(w.tags) && w.tags.level)
        counts.set(w.tags.level, (counts.get(w.tags.level) ?? 0) + 1);
    level = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  // Anchor: supplied or the centroid of all referenced nodes.
  let anchor = options.anchor;
  if (!anchor) {
    const used: OsmNode[] = [];
    for (const w of data.ways)
      for (const r of w.refs) {
        const n = data.nodes.get(r);
        if (n) used.push(n);
      }
    for (const n of data.nodes.values()) if (Object.keys(n.tags).length) used.push(n);
    const lat = used.length ? used.reduce((s, n) => s + n.lat, 0) / used.length : 0;
    const lng = used.length ? used.reduce((s, n) => s + n.lon, 0) / used.length : 0;
    anchor = { lng: Math.round(lng * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 };
  }
  const A = anchor;
  const project = (n: OsmNode): XY => lngLatToMeters(A, [n.lon, n.lat]);
  const ringOf = (refs: string[]): XY[] | null => {
    const pts: XY[] = [];
    for (const r of refs) {
      const n = data.nodes.get(r);
      if (n) pts.push(project(n));
    }
    if (pts.length < 3) return null;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
    return pts;
  };

  const features: Feature[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string): void => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const ids = new Map<string, number>();
  const uid = (base: string): string => {
    const n = (ids.get(base) ?? 0) + 1;
    ids.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const rooms: Array<{ id: string; ring: XY[] }> = [];
  for (const w of data.ways) {
    if (!levelMatches(w.tags, level)) continue;
    const ring = ringOf(w.refs);
    if (!ring) continue;
    const name = w.tags.name ?? w.tags.ref ?? '';
    if (isCorridor(w.tags)) {
      features.push({
        type: 'Feature',
        properties: {
          feature_type: 'unit',
          category: 'walkway',
          id: uid('walkway'),
          name: name || 'Corridor',
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
      bump('walkway');
    } else if (isRoom(w.tags) || isRefugeArea(w.tags)) {
      const category = isRefugeArea(w.tags) ? 'refuge' : 'room';
      const id = uid(slug(name || `${category}-${w.id}`));
      features.push({
        type: 'Feature',
        properties: {
          feature_type: 'unit',
          category,
          id,
          name: name || `${category === 'refuge' ? 'Refuge' : 'Room'} ${w.id}`,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
      rooms.push({ id, ring });
      bump(category);
      // A room tagged as stairs is also a stairwell amenity at its centroid.
      if (amenityOf(w.tags) === 'stairwell') {
        const c = ring.slice(0, -1);
        const cx = c.reduce((s, p) => s + p[0], 0) / c.length;
        const cy = c.reduce((s, p) => s + p[1], 0) / c.length;
        features.push({
          type: 'Feature',
          properties: {
            feature_type: 'amenity',
            category: 'stairwell',
            id: uid(`stair-${w.id}`),
            name: name || 'Stairs',
          },
          geometry: { type: 'Point', coordinates: [cx, cy] },
        });
        bump('amenity:stairwell');
      }
    }
  }
  const doorXY: XY[] = [];
  const catN = new Map<string, number>();
  for (const n of data.nodes.values()) {
    if (!Object.keys(n.tags).length || !levelMatches(n.tags, level)) continue;
    const xy = project(n);
    if (isDoor(n.tags)) {
      let best: { id: string; d: number } | null = null;
      for (const r of rooms) {
        const d = pointInRing(xy, r.ring)
          ? 0
          : Math.min(...r.ring.map((v) => Math.hypot(v[0] - xy[0], v[1] - xy[1])));
        if (!best || d < best.d) best = { id: r.id, d };
      }
      features.push({
        type: 'Feature',
        properties: { feature_type: 'opening', id: uid(`d${n.id}`), unit: best?.id ?? '' },
        geometry: { type: 'Point', coordinates: xy },
      });
      doorXY.push(xy);
      bump('opening');
    }
    const cat = amenityOf(n.tags);
    if (cat) {
      const k = (catN.get(cat) ?? 0) + 1;
      catN.set(cat, k);
      const name = n.tags.name ?? n.tags.ref ?? `${cat.replace('_', ' ')} ${k}`;
      const props: Record<string, unknown> = {
        feature_type: 'amenity',
        category: cat,
        id: uid(slug(n.tags.name ?? `${cat}-${n.id}`)),
        name,
      };
      if (cat === 'exit') props.accessible = n.tags.wheelchair !== 'no';
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: xy },
      });
      bump(`amenity:${cat}`);
    }
  }
  // Spine: authored centreline (indoor=corridor open way / highway=corridor) wins; else synthesise.
  const authored = data.ways.filter(
    (w) =>
      levelMatches(w.tags, level) &&
      (w.tags.highway === 'corridor' || w.tags.highway === 'footway') &&
      w.refs.length >= 2,
  );
  if (authored.length) {
    authored.forEach((w, i) => {
      const pts = w.refs
        .map((r) => data.nodes.get(r))
        .filter((n): n is OsmNode => !!n)
        .map(project);
      features.push({
        type: 'Feature',
        properties: { feature_type: 'path', id: i === 0 ? 'spine' : `spine-${i + 1}` },
        geometry: { type: 'LineString', coordinates: pts },
      });
      bump('path');
    });
  } else {
    const lines = synthesizeSpine(doorXY);
    if (lines.length) {
      features.push({
        type: 'Feature',
        properties: { feature_type: 'path', id: 'spine', synthesized: true },
        geometry: { type: 'MultiLineString', coordinates: lines },
      });
      bump('path');
    }
  }
  return { floor: { type: 'FeatureCollection', features }, anchor: A, level, counts };
}
