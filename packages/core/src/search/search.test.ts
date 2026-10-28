import { describe, expect, it } from 'vitest';
import { LocalSearch, buildCorpus } from './localSearch.js';
import { CITY_CENTER_FLOORS } from '../safetymap/fixtures/cityCenter.js';

const procedures = {
  documents: [
    {
      id: 'p1',
      title: 'Communications loss',
      kind: 'procedure',
      body: 'When network and telephony are unavailable revert to runner-based reporting on the half hour.',
    },
    {
      id: 'p2',
      title: 'Medical response',
      kind: 'procedure',
      body: 'Dispatch the nearest responder with the AED highlighted on the map.',
    },
  ],
};

describe('LocalSearch', () => {
  const idx = new LocalSearch(buildCorpus({ procedures, floors: CITY_CENTER_FLOORS }));
  it('indexes procedures, POIs, rooms and playbooks', () => {
    expect(idx.size).toBeGreaterThan(20);
    const hits = idx.query('aed');
    expect(hits[0]!.source === 'poi' || hits[0]!.source === 'procedure').toBe(true);
    expect(hits.some((h) => h.source === 'poi' && h.nodeId?.startsWith('aed:'))).toBe(true);
  });
  it('finds a procedure by a partial, misspelled word and keeps its source', () => {
    const hits = idx.query('telephny unavail');
    expect(hits[0]).toMatchObject({ source: 'procedure', title: 'Communications loss' });
  });
  it('filters by source and returns nothing for an empty query', () => {
    expect(idx.query('exit', 5, ['room'])).toEqual([]);
    expect(idx.query('  ')).toEqual([]);
    expect(idx.query('concourse', 10, ['room']).every((h) => h.source === 'room')).toBe(true);
  });
  it('suggests terms', () => {
    expect(idx.suggest('evac')).toEqual(expect.arrayContaining([expect.stringMatching(/^evac/)]));
  });
});
