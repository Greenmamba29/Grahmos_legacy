import { describe, expect, it } from 'vitest';
import { buildComplianceReport, renderComplianceMarkdown } from './compliance.js';
import { HARBOR_GENERAL_W3 } from '../safetymap/fixtures/harborGeneral.js';
import { CITY_CENTER_L2 } from '../safetymap/fixtures/cityCenter.js';

describe('compliance evidence', () => {
  it('hospital fixture evidences all five elements', () => {
    const r = buildComplianceReport({
      floor: HARBOR_GENERAL_W3,
      venueName: 'Harbor General (fixture)',
      level: 'Level 2',
      relayConfigured: true,
      now: new Date('2026-10-27T00:00:00Z'),
    });
    expect(r.coverage).toBe(100);
    expect(
      r.elements
        .find((e) => e.id === 'shelter')!
        .artifacts.some((a) => /Horizontal evacuation verified/.test(a)),
    ).toBe(true);
    expect(renderComplianceMarkdown(r)).toMatch(/not a certification/);
  });
  it('stadium fixture lacks compartments and says so', () => {
    const r = buildComplianceReport({
      floor: CITY_CENTER_L2,
      venueName: 'City Center (fixture)',
      level: 'Level 2',
    });
    const shelter = r.elements.find((e) => e.id === 'shelter')!;
    expect(shelter.satisfied).toBe(false);
    expect(r.coverage).toBe(80);
  });
});
