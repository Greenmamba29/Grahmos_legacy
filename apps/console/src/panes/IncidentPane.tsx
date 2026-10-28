import { useState } from 'react';
import {
  floorRooms,
  PLAYBOOKS,
  type Floor,
  type Incident,
  type IncidentSeverity,
  type IncidentType,
  type Pt,
} from '@terranova/core';
import { useRuntime } from '../app/store';

export interface IncidentPaneProps {
  venueSlug: string;
  levelName: string;
  floor: Floor;
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  pendingHazard: Pt | null;
  onRequestHazardPlacement: () => void;
  onClearPendingHazard: () => void;
}

const TYPES = Object.keys(PLAYBOOKS) as IncidentType[];
const SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];

export function IncidentPane(p: IncidentPaneProps) {
  const rt = useRuntime();
  const rooms = floorRooms(p.floor);
  const [type, setType] = useState<IncidentType>('fire');
  const [room, setRoom] = useState<string>(rooms[0]?.id ?? '');
  const [severity, setSeverity] = useState<IncidentSeverity>('high');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = p.incidents.find((i) => i.id === p.selectedId) ?? null;

  const declare = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = rooms.find((x) => x.id === room);
      const hazardXY: [number, number] | undefined = p.pendingHazard
        ? [p.pendingHazard.x, p.pendingHazard.y]
        : r
          ? r.centroid
          : undefined;
      const ev = await rt.service.declareIncident({
        venueSlug: p.venueSlug,
        type,
        title: title.trim() || `${PLAYBOOKS[type].label} – ${r?.name ?? p.levelName}`,
        location: r?.name ?? 'Unspecified',
        level: p.levelName,
        severity,
        ...(hazardXY ? { hazardXY } : {}),
      });
      p.onClearPendingHazard();
      p.onSelect(ev.incidentId);
      setTitle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pane">
      <h2>Incidents</h2>
      {error && (
        <p className="error" role="alert">
          Write failed: {error}
        </p>
      )}
      <section className="card">
        <h3>Declare</h3>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {PLAYBOOKS[t].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location ({p.levelName})
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Fire – Concourse 204"
          />
        </label>
        <div className="row">
          <button type="button" className="ghost" onClick={p.onRequestHazardPlacement}>
            {p.pendingHazard
              ? `Hazard at ${p.pendingHazard.x}, ${p.pendingHazard.y} m (click map to move)`
              : 'Place hazard on map'}
          </button>
          {p.pendingHazard && (
            <button type="button" className="ghost" onClick={p.onClearPendingHazard}>
              Use room centre
            </button>
          )}
        </div>
        <button className="primary" disabled={busy || !rooms.length} onClick={() => void declare()}>
          Declare {PLAYBOOKS[type].label.toLowerCase()}
        </button>
        <p className="muted small">
          Writes land on this device first and queue for sync. Nothing here waits on the network.
        </p>
      </section>

      <section className="card">
        <h3>Active ({p.incidents.filter((i) => i.status !== 'resolved').length})</h3>
        {p.incidents.length === 0 && <p className="muted">No incidents on record.</p>}
        <ul className="list">
          {p.incidents.map((i) => (
            <li
              key={i.id}
              className={`incident sev-${i.severity} ${i.id === p.selectedId ? 'selected' : ''} ${i.status}`}
            >
              <button
                className="linkish"
                onClick={() => p.onSelect(i.id === p.selectedId ? null : i.id)}
              >
                <strong>{i.title}</strong>
                <span className="muted small">
                  {i.level} · {i.location} · {i.status} · {i.severity}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{selected.title}</h3>
            <span className={`pill sev-pill-${selected.severity}`}>{selected.severity}</span>
          </div>
          <p className="muted small">
            Declared {new Date(selected.startedAt).toLocaleTimeString()} by{' '}
            {selected.declaredBy.name} · {selected.eventCount} events
          </p>
          <ol className="stepper" aria-label="Incident status">
            {(['active', 'contained', 'resolved'] as const).map((st, i) => {
              const order = { active: 0, contained: 1, resolved: 2 } as const;
              const reached = order[selected.status] >= i;
              return (
                <li
                  key={st}
                  className={`${reached ? 'reached' : ''} ${selected.status === st ? 'current' : ''}`}
                >
                  <span className="step-dot" aria-hidden />
                  <span>{st}</span>
                </li>
              );
            })}
          </ol>
          <div className="row">
            {selected.status !== 'contained' && selected.status !== 'resolved' && (
              <button
                disabled={busy}
                onClick={() => void act(() => rt.service.setStatus(selected.id, 'contained'))}
              >
                Mark contained
              </button>
            )}
            {selected.status !== 'resolved' && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(() => rt.service.setStatus(selected.id, 'resolved', 'All clear'))
                }
              >
                Resolve (all clear)
              </button>
            )}
            {selected.status === 'resolved' && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(() => rt.service.setStatus(selected.id, 'active', 'Re-opened'))
                }
              >
                Re-open
              </button>
            )}
          </div>
          <label>
            Log an update
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Smoke visible at 204; doors closed."
            />
          </label>
          <button
            disabled={busy || !note.trim()}
            onClick={() =>
              void act(async () => {
                await rt.service.logUpdate(selected.id, note.trim());
                setNote('');
              })
            }
          >
            Add to log
          </button>
          <ol className="timeline">
            {[
              ...selected.updates.map((u) => ({
                at: u.at,
                who: u.actor.name,
                kind: 'update',
                text: u.body,
              })),
              ...selected.alerts.map((a) => ({
                at: a.at,
                who: a.actor.name,
                kind: 'alert',
                text: `Alert: ${a.title} (${a.acks.length} ack${a.acks.length === 1 ? '' : 's'})`,
              })),
              ...selected.alerts.flatMap((a) =>
                a.acks.map((k) => ({
                  at: k.at,
                  who: k.actor.name,
                  kind: 'ack',
                  text: `Acknowledged “${a.title}”${k.note ? ` — ${k.note}` : ''}`,
                })),
              ),
              ...selected.checkins.map((c) => ({
                at: c.at,
                who: c.actor.name,
                kind: c.status === 'needs_help' ? 'help' : 'checkin',
                text: `Check-in: ${c.status.replace('_', ' ')}${c.location ? ` at ${c.location}` : ''}`,
              })),
              {
                at: selected.startedAt,
                who: selected.declaredBy.name,
                kind: 'declared',
                text: `Declared ${selected.type} at ${selected.location}, ${selected.level}`,
              },
            ]
              .sort((x, y) => (x.at < y.at ? 1 : -1))
              .map((e, idx) => (
                <li key={idx} className={`tl-${e.kind}`}>
                  <span className="tl-time">{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="tl-dot" aria-hidden />
                  <span className="tl-body">
                    <span className="muted small">{e.who}</span>
                    <div>{e.text}</div>
                  </span>
                </li>
              ))}
          </ol>
        </section>
      )}
    </div>
  );
}
