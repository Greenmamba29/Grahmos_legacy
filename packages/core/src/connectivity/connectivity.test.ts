import { describe, expect, it } from 'vitest';
import { CONNECTIVITY, bandForScore, nextBand, scoreConnectivity } from './score.js';
import { initialConnectivityState, reduceConnectivity, type ConnectivityState } from './monitor.js';

describe('scoreConnectivity', () => {
  it('hard vetoes', () => {
    expect(scoreConnectivity({ browserOnline: false, msSinceSuccess: 0, rttMs: 10 })).toBe(0);
    expect(scoreConnectivity({ browserOnline: true, forcedOffline: true, msSinceSuccess: 0 })).toBe(
      0,
    );
  });
  it('navigator.onLine alone is not enough for full', () => {
    expect(bandForScore(scoreConnectivity({ browserOnline: true }))).toBe('degraded');
  });
  it('a fresh fast success is full', () => {
    expect(
      bandForScore(scoreConnectivity({ browserOnline: true, msSinceSuccess: 500, rttMs: 80 })),
    ).toBe('full');
  });
  it('three failures collapse the score regardless of a recent success', () => {
    expect(
      scoreConnectivity({ browserOnline: true, msSinceSuccess: 1000, rttMs: 50, failureStreak: 3 }),
    ).toBe(0);
  });
  it('slow-but-alive is degraded', () => {
    expect(
      bandForScore(scoreConnectivity({ browserOnline: true, msSinceSuccess: 1000, rttMs: 3000 })),
    ).toBe('degraded');
  });
  it('hysteresis: full is kept between FULL_EXIT and FULL_ENTER', () => {
    const mid = (CONNECTIVITY.FULL_EXIT + CONNECTIVITY.FULL_ENTER) / 2;
    expect(nextBand('full', mid)).toBe('full');
    expect(nextBand('degraded', mid)).toBe('degraded');
  });
});

describe('reduceConnectivity', () => {
  const t0 = 1_000_000;
  const run = (events: Parameters<typeof reduceConnectivity>[1][], start?: ConnectivityState) =>
    events.reduce(reduceConnectivity, start ?? initialConnectivityState(true, t0));

  it('degrades immediately on failures', () => {
    const s = run([
      { type: 'probe_ok', at: t0, rttMs: 50 },
      { type: 'tick', at: t0 + CONNECTIVITY.UPGRADE_DWELL_MS },
    ]);
    expect(s.band).toBe('full');
    const failed = run(
      [
        { type: 'probe_fail', at: t0 + 5000 },
        { type: 'probe_fail', at: t0 + 6000 },
        { type: 'probe_fail', at: t0 + 7000 },
      ],
      s,
    );
    expect(failed.band).toBe('local');
    expect(failed.reason).toMatch(/3 consecutive/);
  });

  it('requires dwell before upgrading', () => {
    const s1 = run([{ type: 'probe_ok', at: t0, rttMs: 50 }]);
    expect(s1.band).toBe('degraded');
    expect(s1.pending?.band).toBe('full');
    const s2 = reduceConnectivity(s1, { type: 'tick', at: t0 + CONNECTIVITY.UPGRADE_DWELL_MS - 1 });
    expect(s2.band).toBe('degraded');
    const s3 = reduceConnectivity(s2, { type: 'tick', at: t0 + CONNECTIVITY.UPGRADE_DWELL_MS });
    expect(s3.band).toBe('full');
  });

  it('operator override wins', () => {
    const s = run([
      { type: 'probe_ok', at: t0, rttMs: 20 },
      { type: 'forced_offline', at: t0 + 1, forced: true },
    ]);
    expect(s.band).toBe('local');
    expect(s.reason).toBe('operator forced offline');
  });
});
