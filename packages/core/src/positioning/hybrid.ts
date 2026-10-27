/**
 * Hybrid positioning — surveyed checkpoints + GNSS, with honest provenance.
 *
 * On a life-safety console a confident dot derived from a 60 m fix is worse than no dot. Every
 * rule is explicit, ordered and tested, and the chosen SOURCE is reported so the operator can see
 * whether the position is surveyed (checkpoint scan), measured (satellite), inferred (stale
 * checkpoint) or absent. GNSS needs no network, so using it costs nothing against the offline claim.
 */
import type { Pt } from '../safetymap/astar.js';

export type PositionSource = 'checkpoint' | 'gnss' | 'checkpoint-stale' | 'none';

export interface PositionFix {
  xy: Pt | null;
  source: PositionSource;
  /** 1-sigma metres; 0 for a fresh surveyed checkpoint. */
  accuracyM: number;
  /** True when the fix may be drawn as a confident position and used as a routing origin. */
  confident: boolean;
  reason: string;
}

export interface CheckpointScan {
  id: string;
  xy: Pt;
  /** epoch ms of the scan */
  at: number;
}

export interface GnssSample {
  xy: Pt;
  accuracyM: number;
  /** epoch ms of the fix */
  at: number;
  /** True when the device believes it is outdoors / the floor is outdoor. GNSS indoors is distrusted harder. */
  outdoors?: boolean;
}

export const POSITIONING = {
  /** Worst GNSS accuracy still worth trusting outdoors, metres. */
  GNSS_MAX_ACCURACY_OUTDOOR_M: 15,
  /** Indoors a phone trilaterates off almost nothing; only a very tight fix is believed. */
  GNSS_MAX_ACCURACY_INDOOR_M: 8,
  /** A GNSS fix older than this is history, not position. */
  GNSS_MAX_AGE_MS: 20_000,
  /** A checkpoint scan this old is still "here". */
  CHECKPOINT_FRESH_MS: 90_000,
  /** Beyond this the scan is shown as a stale, low-confidence last-known position. */
  CHECKPOINT_STALE_MS: 15 * 60_000,
} as const;

/**
 * Choose the position. Pure: same inputs → same fix.
 *   1. a fresh checkpoint beats everything (surveyed truth at the moment of scan);
 *   2. a recent, tight GNSS fix beats a stale checkpoint;
 *   3. a stale checkpoint is shown but NOT confident;
 *   4. otherwise nothing — the UI must not draw a dot.
 */
export function hybridPosition(input: { checkpoint?: CheckpointScan | null; gnss?: GnssSample | null; now: number }): PositionFix {
  const { checkpoint, gnss, now } = input;
  const cpAge = checkpoint ? now - checkpoint.at : Infinity;
  if (checkpoint && cpAge <= POSITIONING.CHECKPOINT_FRESH_MS) {
    return { xy: checkpoint.xy, source: 'checkpoint', accuracyM: 0, confident: true, reason: `checkpoint ${checkpoint.id} scanned ${Math.round(cpAge / 1000)}s ago` };
  }
  if (gnss) {
    const age = now - gnss.at;
    const limit = gnss.outdoors ? POSITIONING.GNSS_MAX_ACCURACY_OUTDOOR_M : POSITIONING.GNSS_MAX_ACCURACY_INDOOR_M;
    if (age <= POSITIONING.GNSS_MAX_AGE_MS && gnss.accuracyM <= limit) {
      return { xy: gnss.xy, source: 'gnss', accuracyM: gnss.accuracyM, confident: true, reason: `GNSS ±${Math.round(gnss.accuracyM)} m, ${Math.round(age / 1000)}s old` };
    }
  }
  if (checkpoint && cpAge <= POSITIONING.CHECKPOINT_STALE_MS) {
    return { xy: checkpoint.xy, source: 'checkpoint-stale', accuracyM: 25, confident: false, reason: `last checkpoint ${checkpoint.id} was ${Math.round(cpAge / 60_000)} min ago — you have probably moved` };
  }
  const why = gnss ? `GNSS too coarse (±${Math.round(gnss.accuracyM)} m) or too old` : 'no checkpoint scan and no satellite fix';
  return { xy: null, source: 'none', accuracyM: Infinity, confident: false, reason: why };
}
