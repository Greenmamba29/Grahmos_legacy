import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  hybridPosition,
  lngLatToMeters,
  type CheckpointScan,
  type GnssSample,
  type PositionFix,
  type VenueAnchor,
} from '@terranova/core';

export interface PositionController {
  fix: PositionFix;
  scan: CheckpointScan | null;
  gnss: GnssSample | null;
  gnssError: string | null;
  gnssWatching: boolean;
  scanCheckpoint: (scan: Omit<CheckpointScan, 'at'>) => void;
  clearScan: () => void;
  startGnss: () => void;
  stopGnss: () => void;
  /** Explicit operator override: "I am here" by clicking the map. Treated as a fresh checkpoint. */
  setManual: (xy: { x: number; y: number }) => void;
}

/**
 * Position = hybrid(checkpoint scan, GNSS) re-evaluated every few seconds so freshness decays
 * honestly. GNSS is only offered when the pack has an anchor (otherwise lat/lng cannot be placed
 * on the floor) and is projected through that anchor.
 */
export function usePosition(
  anchor: VenueAnchor | undefined,
  outdoors: boolean,
): PositionController {
  const [scan, setScan] = useState<CheckpointScan | null>(null);
  const [gnss, setGnss] = useState<GnssSample | null>(null);
  const [gnssError, setGnssError] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const startGnss = useCallback(() => {
    if (!anchor) {
      setGnssError('pack has no venue anchor; satellite fixes cannot be placed on this floor');
      return;
    }
    if (!('geolocation' in navigator)) {
      setGnssError('geolocation unavailable in this browser');
      return;
    }
    setGnssError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const xy = lngLatToMeters(anchor, [pos.coords.longitude, pos.coords.latitude]);
        setGnss({
          xy: { x: xy[0], y: xy[1] },
          accuracyM: pos.coords.accuracy,
          at: pos.timestamp || Date.now(),
          outdoors,
        });
        setNow(Date.now());
      },
      (err) => setGnssError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setWatchId(id);
  }, [anchor, outdoors]);

  const stopGnss = useCallback(() => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
    setGnss(null);
  }, [watchId]);

  useEffect(
    () => () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    },
    [watchId],
  );

  const fix = useMemo(() => hybridPosition({ checkpoint: scan, gnss, now }), [scan, gnss, now]);

  return {
    fix,
    scan,
    gnss,
    gnssError,
    gnssWatching: watchId !== null,
    scanCheckpoint: (s) => {
      setScan({ ...s, at: Date.now() });
      setNow(Date.now());
    },
    clearScan: () => setScan(null),
    startGnss,
    stopGnss,
    setManual: (xy) => {
      setScan({ id: 'manual', xy, at: Date.now() });
      setNow(Date.now());
    },
  };
}
