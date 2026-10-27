import { useMemo } from 'react';
import { egressLegs, type Floor, type RouteSummary } from '@terranova/core';

const fmtTime = (s: number): string => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

/**
 * Persistent route card over the map. Pattern: ETA and distance as the headline, the NEXT
 * instruction as the second line, an explicit end control, details one tap away.
 */
export function RouteCard({
  floor,
  route,
  label,
  onDetails,
  onEnd,
}: {
  floor: Floor;
  route: RouteSummary;
  label?: string;
  onDetails: () => void;
  onEnd?: (() => void) | undefined;
}) {
  const legs = useMemo(() => egressLegs(floor, route.points), [floor, route]);
  const first = legs[0];
  const next = first?.handoff
    ? `${first.label} → ${first.handoff}`
    : (first?.label ?? route.destination);
  return (
    <div
      className={`route-card${route.throughHazard ? ' route-card-warn' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="route-card-head">
        <div>
          <div className="route-card-eta">{fmtTime(route.etaSeconds)}</div>
          <div className="route-card-sub">
            {route.distanceFt} ft · to {route.destination}
            {label ? ` · ${label}` : ''}
          </div>
        </div>
        <div className="route-card-actions">
          <button className="small" onClick={onDetails}>
            Details
          </button>
          {onEnd && (
            <button className="small danger" onClick={onEnd}>
              End
            </button>
          )}
        </div>
      </div>
      <div className="route-card-next">
        <span className="route-card-arrow" aria-hidden>
          ➜
        </span>
        <span>
          <strong>{first ? `${first.distanceFt} ft` : ''}</strong> {next}
        </span>
      </div>
      {route.throughHazard && (
        <div className="route-card-flag">No clear path: this route passes the hazard zone.</div>
      )}
      {legs.length > 1 && (
        <div className="route-card-progress" aria-hidden>
          {legs.map((l, i) => (
            <span
              key={i}
              className={`seg-${l.kind}`}
              style={{ flex: Math.max(1, l.distanceMeters) }}
              title={l.label}
            />
          ))}
        </div>
      )}
    </div>
  );
}
