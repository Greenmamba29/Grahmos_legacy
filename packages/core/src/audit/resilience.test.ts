import { describe, expect, it } from 'vitest';
import {
  auditFloor,
  findBridges,
  findSpofs,
  renderAuditMarkdown,
  scoreExitCoverage,
} from './resilience.js';
import { CITY_CENTER_L2 } from '../safetymap/fixtures/cityCenter.js';
import { HARBOR_GENERAL_W3 } from '../safetymap/fixtures/harborGeneral.js';
import { extractNavGraph, unreachableRooms } from '../safetymap/graph.js';
import { amenity, floor, opening, path, rect, unit } from '../safetymap/fixtures/builders.js';

describe('resilience audit', () => {
  it('agrees with the shipping gate about reachability', () => {
    const ex = extractNavGraph(CITY_CENTER_L2);
    const cov = scoreExitCoverage(ex, true);
    expect(cov.metrics.unreachable).toBe(unreachableRooms(ex).length);
    expect(cov.metrics.unreachable).toBe(0);
  });
  it('scores the fixtures and renders markdown', () => {
    const a = auditFloor('Level 2', CITY_CENTER_L2);
    expect(a.score).toBeGreaterThan(0);
    expect(a.categories.map((c) => c.key)).toEqual([
      'exitCoverage',
      'aedReach',
      'redundancy',
      'accessibility',
    ]);
    expect(a.hazardHotspots.length).toBeGreaterThan(0);
    const md = renderAuditMarkdown(a);
    expect(md).toMatch(/not a code-official measurement/);
    const h = auditFloor('W3', HARBOR_GENERAL_W3);
    expect(h.categories.find((c) => c.key === 'accessibility')!.metrics.refuges).toBe(3);
  });
  it('finds a corridor single point of failure', () => {
    // Two rooms behind one corridor stub that leads to the only exit.
    const f = floor([
      unit('a', 'A', rect(0, 10, 10, 10)),
      unit('b', 'B', rect(12, 10, 10, 10)),
      path('p', [
        [5, 5],
        [17, 5],
        [30, 5],
        [40, 5],
      ]),
      opening('da', 'a', [5, 10]),
      opening('db', 'b', [17, 10]),
      amenity('e', 'exit', 'E', [40, 6]),
    ]);
    const ex = extractNavGraph(f);
    expect(findBridges(ex.graph).length).toBeGreaterThan(0);
    const spofs = findSpofs(ex);
    expect(spofs[0]?.strandedRooms.sort()).toEqual(['unit:a', 'unit:b']);
    const a = auditFloor('x', f);
    expect(a.categories.find((c) => c.key === 'redundancy')!.score).toBe(0);
    expect(a.band).toBe('deficient');
  });
});
