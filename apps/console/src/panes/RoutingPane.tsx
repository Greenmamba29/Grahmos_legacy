import {
  ROUTE_MODES,
  egressLegs,
  exitBoard,
  destinationOptions,
  type Floor,
  type Pt,
  type RouteMode,
  type RoutePlan,
} from '@terranova/core';
import { useMemo } from 'react';

export interface RoutingPaneProps {
  floor: Floor;
  mode: RouteMode;
  onMode: (m: RouteMode) => void;
  destination: string | null;
  onDestination: (id: string | null) => void;
  origin: Pt | null;
  hazard: Pt | null;
  plan: RoutePlan;
  clickMode: 'origin' | 'hazard' | 'none';
  onClickMode: (m: 'origin' | 'hazard' | 'none') => void;
  onClearOrigin: () => void;
}

const MODE_LABEL: Record<RouteMode, string> = {
  occupant: 'Occupant (avoid hazard)',
  responder: 'Responder (to incident)',
  accessible: 'Accessible (step-free)',
  horizontal: 'Horizontal evac (hospital)',
};

const fmtTime = (s: number): string => (s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

export function RoutingPane(p: RoutingPaneProps) {
  const options = useMemo(() => destinationOptions(p.floor, p.mode), [p.floor, p.mode]);
  const legs = useMemo(
    () => (p.plan.primary ? egressLegs(p.floor, p.plan.primary.points) : []),
    [p.floor, p.plan.primary],
  );
  const board = useMemo(
    () => exitBoard({ floor: p.floor, originXY: p.origin, hazardXY: p.hazard }),
    [p.floor, p.origin, p.hazard],
  );

  return (
    <div className="pane">
      <h2>Routing</h2>
      <section className="card">
        <h3>Profile</h3>
        <div className="seg">
          {ROUTE_MODES.map((m) => (
            <button key={m} className={m === p.mode ? 'on' : ''} onClick={() => p.onMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <label>
          Destination
          <select
            value={p.destination ?? ''}
            onChange={(e) => p.onDestination(e.target.value || null)}
          >
            <option value="">Nearest {p.plan.goalKind}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({o.kind.replace('_', ' ')})
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button
            className={p.clickMode === 'origin' ? 'on' : ''}
            onClick={() => p.onClickMode(p.clickMode === 'origin' ? 'none' : 'origin')}
          >
            {p.clickMode === 'origin' ? 'Click the map…' : 'Set my position'}
          </button>
          {p.origin && (
            <button className="ghost" onClick={p.onClearOrigin}>
              Use floor default
            </button>
          )}
        </div>
        <p className="muted small">
          {p.origin
            ? `Position: ${p.origin.x}, ${p.origin.y} m (operator-set checkpoint)`
            : 'Position: floor default "you are here". No GNSS is implied indoors.'}
        </p>
      </section>

      <section className="card route-card">
        <h3>Route</h3>
        {!p.plan.primary && (
          <p className="error" role="status">
            No route: {p.plan.unavailableReason ?? 'unreachable'}.
          </p>
        )}
        {p.plan.primary && (
          <>
            <div className="route-head">
              <strong>{p.plan.primary.destination}</strong>
              <span>
                {p.plan.primary.distanceFt} ft · {fmtTime(p.plan.primary.etaSeconds)}
              </span>
            </div>
            <p className={p.plan.primary.throughHazard ? 'error' : 'ok'}>{p.plan.primary.reason}</p>
            {p.plan.primary.hazardClearanceM !== null && (
              <p className="muted small">
                Closest approach to hazard: {p.plan.primary.hazardClearanceM} m
              </p>
            )}
            {p.plan.refugeFallback && <p className="warn small">Refuge fallback in effect.</p>}
            {p.plan.incidentCompartmentId && (
              <p className="muted small">
                Fire compartment {p.plan.incidentCompartmentId} → target compartment{' '}
                {p.plan.targetCompartmentId ?? '—'}
              </p>
            )}
            <ol className="legs">
              {legs.map((l, i) => (
                <li key={i} className={`leg leg-${l.kind}`}>
                  <span className="leg-kind">{l.kind}</span>
                  <span className="leg-label">{l.label}</span>
                  <span className="leg-dist">
                    {l.distanceFt} ft · {fmtTime(l.seconds)}
                  </span>
                  {l.handoff && <span className="leg-handoff">→ {l.handoff}</span>}
                </li>
              ))}
            </ol>
          </>
        )}
        {p.plan.alternate && (
          <p className="muted small">
            Alternate: {p.plan.alternate.destination}, {p.plan.alternate.distanceFt} ft ·{' '}
            {fmtTime(p.plan.alternate.etaSeconds)} — {p.plan.alternate.reason}
          </p>
        )}
      </section>

      <section className="card">
        <h3>Exit board</h3>
        <table className="board">
          <thead>
            <tr>
              <th>Exit</th>
              <th>Status</th>
              <th>Dist</th>
              <th>Time</th>
              <th>Hazard</th>
            </tr>
          </thead>
          <tbody>
            {board.map((e) => (
              <tr key={e.id} className={`cond-${e.condition}`}>
                <td>
                  {e.label}
                  {!e.accessible && <span className="muted small"> · stairs</span>}
                </td>
                <td>{e.condition}</td>
                <td>{e.distanceFt !== undefined ? `${e.distanceFt} ft` : '—'}</td>
                <td>{e.etaSeconds !== undefined ? fmtTime(e.etaSeconds) : '—'}</td>
                <td>{e.hazardClearanceM !== undefined ? `${e.hazardClearanceM} m` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Clear before hazard before unreachable, then nearest. The nearest exit is not the best
          exit when the fire is standing in it.
        </p>
      </section>
    </div>
  );
}
