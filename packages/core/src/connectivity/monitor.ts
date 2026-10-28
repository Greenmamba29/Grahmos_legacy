import {
  CONNECTIVITY,
  bandForScore,
  isImprovement,
  nextBand,
  scoreConnectivity,
  type ConnectivityBand,
} from './score.js';

export interface ConnectivityState {
  band: ConnectivityBand;
  score: number;
  browserOnline: boolean;
  forcedOffline: boolean;
  lastSuccessAt: number | null;
  lastRttMs: number | null;
  failureStreak: number;
  /** Band an improvement is pending toward, and since when. Null when nothing is pending. */
  pending: { band: ConnectivityBand; since: number } | null;
  /** Explains the current band in one line, for diagnostics. */
  reason: string;
}

export type ConnectivityEvent =
  | { type: 'probe_ok'; at: number; rttMs: number }
  | { type: 'probe_fail'; at: number }
  | { type: 'browser_online'; at: number; online: boolean }
  | { type: 'forced_offline'; at: number; forced: boolean }
  | { type: 'tick'; at: number };

export function initialConnectivityState(browserOnline: boolean, at: number): ConnectivityState {
  const score = scoreConnectivity({ browserOnline });
  const band = bandForScore(score);
  return {
    band,
    score,
    browserOnline,
    forcedOffline: false,
    lastSuccessAt: null,
    lastRttMs: null,
    failureStreak: 0,
    pending: null,
    reason: browserOnline ? 'cold start: no probe yet' : 'browser reports no network link',
  };
  void at;
}

function explain(s: Omit<ConnectivityState, 'reason'>, at: number): string {
  if (s.forcedOffline) return 'operator forced offline';
  if (!s.browserOnline) return 'browser reports no network link';
  if (s.failureStreak >= CONNECTIVITY.FAILURE_STREAK_FATAL)
    return `${s.failureStreak} consecutive probe failures`;
  if (s.lastSuccessAt === null) return 'no successful probe yet this session';
  const age = Math.round((at - s.lastSuccessAt) / 1000);
  const rtt = s.lastRttMs ?? 0;
  if (rtt >= CONNECTIVITY.RTT_SLOW_MS) return `link alive but slow (${rtt} ms rtt)`;
  return `last probe ok ${age}s ago (${rtt} ms rtt)`;
}

/**
 * Pure reducer. Degradation applies immediately; an improvement must hold for UPGRADE_DWELL_MS
 * before the band moves up. Believing "worse" early costs a cache read; believing "better" early
 * costs a hang at the moment someone needs a route.
 */
export function reduceConnectivity(
  state: ConnectivityState,
  event: ConnectivityEvent,
): ConnectivityState {
  let s = { ...state };
  switch (event.type) {
    case 'probe_ok':
      s.lastSuccessAt = event.at;
      s.lastRttMs = event.rttMs;
      s.failureStreak = 0;
      break;
    case 'probe_fail':
      s.failureStreak += 1;
      break;
    case 'browser_online':
      s.browserOnline = event.online;
      break;
    case 'forced_offline':
      s.forcedOffline = event.forced;
      break;
    case 'tick':
      break;
  }
  const at = event.at;
  s.score = scoreConnectivity({
    browserOnline: s.browserOnline,
    msSinceSuccess: s.lastSuccessAt === null ? undefined : at - s.lastSuccessAt,
    failureStreak: s.failureStreak,
    rttMs: s.lastRttMs ?? undefined,
    forcedOffline: s.forcedOffline,
  });
  const target = nextBand(s.band, s.score);
  if (target === s.band) {
    s.pending = null;
  } else if (!isImprovement(s.band, target)) {
    s.band = target;
    s.pending = null;
  } else {
    const since = s.pending && s.pending.band === target ? s.pending.since : at;
    if (at - since >= CONNECTIVITY.UPGRADE_DWELL_MS) {
      s.band = target;
      s.pending = null;
    } else {
      s.pending = { band: target, since };
    }
  }
  s = { ...s, reason: explain(s, at) };
  return s;
}

export const HEARTBEAT = {
  /** Captive portals hang rather than refuse; without a timeout no failure is ever recorded. */
  TIMEOUT_MS: 5000,
  INTERVAL_FULL_MS: 30_000,
  INTERVAL_IMPAIRED_MS: 10_000,
} as const;

export function heartbeatIntervalFor(band: ConnectivityBand): number {
  return band === 'full' ? HEARTBEAT.INTERVAL_FULL_MS : HEARTBEAT.INTERVAL_IMPAIRED_MS;
}
