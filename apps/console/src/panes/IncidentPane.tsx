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
          <h3>{selected.title}</h3>
          <p className="muted small">
            Declared {new Date(selected.startedAt).toLocaleTimeString()} by{' '}
            {selected.declaredBy.name} · {selected.eventCount} events
          </p>
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
            {[...selected.updates].reverse().map((u) => (
              <li key={u.id}>
                <span className="muted small">
                  {new Date(u.at).toLocaleTimeString()} · {u.actor.name}
                </span>
                <div>{u.body}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
