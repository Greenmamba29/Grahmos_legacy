import { describe, expect, it } from 'vitest';
import { cotEntitiesForFloor, toCotDocument, toCotEvent } from './cot.js';
import { CITY_CENTER_L2 } from '../safetymap/fixtures/cityCenter.js';
import type { Incident } from '../comms/types.js';

const o = {
  anchor: { lng: -122.3313, lat: 47.5951 },
  venueSlug: 'city-center-stadium',
  now: new Date('2026-10-27T12:00:00Z'),
};

describe('CoT export', () => {
  it('renders a well-formed, escaped event with the unknown sentinel and stable uid', () => {
    const xml = toCotEvent(
      { kind: 'exit', id: 'L2:exitA', label: 'Exit A & B <north>', xy: [-64, 24] },
      o,
    );
    expect(xml).toContain('uid="terranova.city-center-stadium.exit.L2:exitA"');
    expect(xml).toContain('callsign="Exit A &amp; B &lt;north&gt;"');
    expect(xml).toContain('hae="9999999.0"');
    expect(xml).toMatch(/stale="2026-10-28T12:00:00.000Z"/);
  });
  it('exports a floor with incident alert and hazard polygon', () => {
    const inc: Incident = {
      id: 'i1',
      venueSlug: 'v',
      type: 'fire',
      title: 'Fire – 204',
      location: '204',
      level: 'Level 2',
      status: 'active',
      severity: 'high',
      startedAt: 't',
      updatedAt: 't',
      hazardXY: [0, 19],
      declaredBy: { deviceId: 'd', name: 'n' },
      updates: [],
      alerts: [],
      checkins: [],
      eventCount: 1,
    };
    const ents = cotEntitiesForFloor(CITY_CENTER_L2, 'Level 2', [inc]);
    expect(ents.filter((e) => e.kind === 'exit')).toHaveLength(3);
    expect(ents.some((e) => e.kind === 'incident')).toBe(true);
    const doc = toCotDocument(ents, o);
    expect((doc.match(/<event /g) ?? []).length).toBe(ents.length);
    expect(doc).toContain('<polyline closed="1">');
    expect(doc.startsWith('<?xml')).toBe(true);
  });
});
