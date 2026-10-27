import { describe, expect, it } from 'vitest';
import { READINESS_COMPONENTS, evaluateReadiness, type ComponentReport } from './readiness.js';

const ok = (): ComponentReport[] =>
  READINESS_COMPONENTS.map((component) => ({ component, state: 'ok', checkedAt: 't' }));

describe('evaluateReadiness', () => {
  it('READY when everything is ok', () => {
    expect(evaluateReadiness(ok()).level).toBe('READY');
  });
  it('DEGRADED when a non-critical component is missing', () => {
    const c = ok().map((r) =>
      r.component === 'storage_persisted'
        ? { ...r, state: 'missing' as const, reason: 'denied' }
        : r,
    );
    const rep = evaluateReadiness(c);
    expect(rep.level).toBe('DEGRADED');
    expect(rep.reasons).toEqual(['storage_persisted: missing — denied']);
  });
  it('unreported critical components are unknown → DEGRADED (not proven), missing → ERROR', () => {
    const rep = evaluateReadiness(ok().filter((r) => r.component !== 'venue_pack_verified'));
    expect(rep.level).toBe('DEGRADED');
    expect(rep.reasons[0]).toMatch(/venue_pack_verified: unknown/);
    const bad = ok().map((r) =>
      r.component === 'venue_pack_verified'
        ? { ...r, state: 'missing' as const, reason: 'rejected' }
        : r,
    );
    expect(evaluateReadiness(bad).level).toBe('ERROR');
  });
});
