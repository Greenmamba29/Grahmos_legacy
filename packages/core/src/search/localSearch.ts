/**
 * Local search — lexical retrieval over what is INSTALLED: pack procedures, floor POIs and rooms,
 * incident playbooks, and the device's own incident log. No remote call, no model. Results carry
 * their source so the UI can say "from the installed pack" rather than imply a wider answer.
 */
import MiniSearch from 'minisearch';
import type { FeatureCollection } from 'geojson';
import type { Incident } from '../comms/types.js';
import { PLAYBOOKS } from '../safetymap/playbooks.js';
import { floorPois, floorRooms } from '../safetymap/floor.js';

export type SearchSource = 'procedure' | 'poi' | 'room' | 'playbook' | 'incident';

export interface SearchDoc {
  id: string;
  source: SearchSource;
  title: string;
  body: string;
  /** Level name for floor-bound documents. */
  level?: string;
  /** Venue metre position for floor-bound documents, so a hit can focus the map. */
  xy?: [number, number];
  /** Graph node id for routable hits (POIs). */
  nodeId?: string;
}

export interface SearchHit extends SearchDoc {
  score: number;
  terms: string[];
}

export interface SearchCorpusInput {
  procedures?: { documents: Array<{ id: string; title: string; kind: string; body: string }> } | null;
  floors?: Record<string, FeatureCollection>;
  incidents?: Iterable<Incident>;
  includePlaybooks?: boolean;
}

export function buildCorpus(input: SearchCorpusInput): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const d of input.procedures?.documents ?? []) docs.push({ id: `procedure:${d.id}`, source: 'procedure', title: d.title, body: d.body });
  for (const [level, floor] of Object.entries(input.floors ?? {})) {
    for (const p of floorPois(floor))
      docs.push({ id: `poi:${level}:${p.category}:${p.id}`, source: 'poi', title: p.name, body: `${p.category.replace('_', ' ')} on ${level}${p.accessible ? '' : ' (not step-free)'}`, level, xy: p.xy, nodeId: `${p.category}:${p.id}` });
    for (const r of floorRooms(floor)) docs.push({ id: `room:${level}:${r.id}`, source: 'room', title: r.name, body: `room on ${level}`, level, xy: r.centroid });
  }
  if (input.includePlaybooks !== false) {
    for (const pb of Object.values(PLAYBOOKS)) {
      const body = [pb.banner, ...pb.instructions.occupant, ...pb.instructions.responder, ...pb.instructions.operator].join(' ');
      docs.push({ id: `playbook:${pb.type}`, source: 'playbook', title: `${pb.label} playbook`, body });
    }
  }
  for (const inc of input.incidents ?? []) {
    const body = [inc.location, inc.status, inc.severity, ...inc.updates.map((u) => u.body), ...inc.alerts.map((a) => `${a.title} ${a.body}`)].join(' ');
    const doc: SearchDoc = { id: `incident:${inc.id}`, source: 'incident', title: inc.title, body, level: inc.level };
    if (inc.hazardXY) doc.xy = inc.hazardXY;
    docs.push(doc);
  }
  return docs;
}

export class LocalSearch {
  private readonly index: MiniSearch<SearchDoc>;
  private readonly byId = new Map<string, SearchDoc>();

  constructor(docs: SearchDoc[]) {
    this.index = new MiniSearch<SearchDoc>({
      fields: ['title', 'body'],
      storeFields: ['id'],
      searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'OR' },
    });
    this.index.addAll(docs);
    for (const d of docs) this.byId.set(d.id, d);
  }

  get size(): number {
    return this.byId.size;
  }

  query(q: string, limit = 12, sources?: SearchSource[]): SearchHit[] {
    const text = q.trim();
    if (!text) return [];
    const allowed = sources ? new Set(sources) : null;
    const out: SearchHit[] = [];
    for (const r of this.index.search(text)) {
      const doc = this.byId.get(String(r.id));
      if (!doc || (allowed && !allowed.has(doc.source))) continue;
      out.push({ ...doc, score: r.score, terms: r.terms });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Short list of terms the index knows that start with the prefix — for type-ahead. */
  suggest(prefix: string, limit = 6): string[] {
    return this.index.autoSuggest(prefix, { prefix: true }).slice(0, limit).map((s) => s.suggestion);
  }
}
