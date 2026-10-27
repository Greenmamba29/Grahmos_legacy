/**
 * Fuzzy connectivity — how much do we BELIEVE the network works right now?
 *
 * `navigator.onLine` is reliable in exactly one direction: when false, there is no link. When true
 * it says nothing (captive portals, associated-but-no-upstream APs, one-bar LTE). So connectivity is
 * graded, not boolean: weak signals each contribute a 0..1 membership and combine into a
 * confidence, which maps to a BAND that callers switch on:
 *
 *   full       sync, fetch, remote search freely.
 *   degraded   local-first; cheap/critical remote work only; never block a life-safety surface.
 *   local      device-only; queue writes; never wait on the network.
 */
export type ConnectivityBand = 'full' | 'degraded' | 'local';

export interface ConnectivitySample {
  /** `navigator.onLine`. Believed only when false. */
  browserOnline: boolean;
  /** Age in ms of the last CONFIRMED round-trip. Undefined = never tried, which is unknown, not offline. */
  msSinceSuccess?: number | undefined;
  /** Consecutive failed attempts since the last success. */
  failureStreak?: number | undefined;
  /** Round-trip time of the last success, ms. Distinguishes slow from dead. */
  rttMs?: number | undefined;
  /** Operator's "simulate offline" switch — an absolute override. */
  forcedOffline?: boolean | undefined;
}

export const CONNECTIVITY = {
  FULL_ENTER: 0.7,
  FULL_EXIT: 0.55,
  DEGRADED_ENTER: 0.35,
  DEGRADED_EXIT: 0.2,
  /** An IMPROVEMENT must hold this long before it is believed (ms). Degradation is immediate. */
  UPGRADE_DWELL_MS: 4000,
  SUCCESS_HALF_LIFE_MS: 30_000,
  FAILURE_STREAK_FATAL: 3,
  RTT_SLOW_MS: 1200,
} as const;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Pure: same sample → same score. */
export function scoreConnectivity(sample: ConnectivitySample): number {
  const { browserOnline, msSinceSuccess, failureStreak = 0, rttMs, forcedOffline = false } = sample;
  if (forcedOffline) return 0;
  if (!browserOnline) return 0;

  const failureFactor =
    failureStreak >= CONNECTIVITY.FAILURE_STREAK_FATAL
      ? 0
      : 1 - failureStreak / CONNECTIVITY.FAILURE_STREAK_FATAL;

  const recency =
    msSinceSuccess === undefined
      ? 0.5
      : Math.pow(0.5, msSinceSuccess / CONNECTIVITY.SUCCESS_HALF_LIFE_MS);

  const speed = rttMs === undefined ? 0.8 : clamp01(1 - (rttMs / CONNECTIVITY.RTT_SLOW_MS) * 0.6);

  const weighted = 0.1 + 0.55 * recency + 0.35 * speed;
  return clamp01(weighted * failureFactor);
}

/** Band for a confidence ignoring hysteresis — the cold-start answer. */
export function bandForScore(score: number): ConnectivityBand {
  if (score >= CONNECTIVITY.FULL_ENTER) return 'full';
  if (score >= CONNECTIVITY.DEGRADED_ENTER) return 'degraded';
  return 'local';
}

const RANK: Record<ConnectivityBand, number> = { local: 0, degraded: 1, full: 2 };

/**
 * Next band given the current one and a fresh score, with Schmitt-trigger hysteresis.
 * Pure; dwell time is handled by the monitor, which owns the clock.
 */
export function nextBand(current: ConnectivityBand, score: number): ConnectivityBand {
  switch (current) {
    case 'full':
      if (score < CONNECTIVITY.DEGRADED_EXIT) return 'local';
      if (score < CONNECTIVITY.FULL_EXIT) return 'degraded';
      return 'full';
    case 'degraded':
      if (score >= CONNECTIVITY.FULL_ENTER) return 'full';
      if (score < CONNECTIVITY.DEGRADED_EXIT) return 'local';
      return 'degraded';
    case 'local':
      if (score >= CONNECTIVITY.FULL_ENTER) return 'full';
      if (score >= CONNECTIVITY.DEGRADED_ENTER) return 'degraded';
      return 'local';
  }
}

export const isImprovement = (from: ConnectivityBand, to: ConnectivityBand): boolean =>
  RANK[to] > RANK[from];
