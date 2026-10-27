import { useState } from 'react';
import { localisedPlaybook, playbookFor, t, CATALOGUES, type Incident } from '@terranova/core';
import { useRuntime, useRuntimeState } from '../app/store';

export function CommsPane({ incident }: { incident: Incident | null }) {
  const rt = useRuntime();
  const s = useRuntimeState();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const me = s.identity?.deviceId;

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (!incident) {
    return (
      <div className="pane">
        <h2>Communications</h2>
        <p className="muted">
          Select or declare an incident to broadcast alerts, collect acknowledgements, and take
          check-ins.
        </p>
        <OutboxStatus />
      </div>
    );
  }
  const pb = playbookFor(incident.type);
  const lang = s.language;
  const lp = localisedPlaybook(lang, incident.type);
  const alertFor = { ...pb.defaultAlert, title: lp.defaultAlert.title, body: lp.defaultAlert.body };
  return (
    <div className="pane">
      <h2>Communications</h2>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      <section className="card">
        <h3>Broadcast alert</h3>
        <p className="muted small">
          Alerts persist on every device that receives them and are acknowledged per device.
          Offline, they queue in the outbox.
        </p>
        <button
          className="primary"
          onClick={() => void run(() => rt.service.broadcastAlert(incident.id, alertFor))}
        >
          Send playbook alert: “{lp.defaultAlert.title}”
        </button>
        <label>
          Custom title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Message
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <button
          disabled={!title.trim() || !body.trim()}
          onClick={() =>
            void run(async () => {
              await rt.service.broadcastAlert(incident.id, {
                title: title.trim(),
                body: body.trim(),
                severity: 'high',
              });
              setTitle('');
              setBody('');
            })
          }
        >
          Send custom alert
        </button>
      </section>

      <section className="card">
        <h3>Alerts &amp; acknowledgements</h3>
        {incident.alerts.length === 0 && <p className="muted">No alerts sent yet.</p>}
        <ul className="list">
          {[...incident.alerts].reverse().map((a) => {
            const acked = a.acks.some((k) => k.actor.deviceId === me);
            return (
              <li key={a.id} className={`alert sev-${a.severity}`}>
                <strong>{a.title}</strong>
                <div>{a.body}</div>
                <span className="muted small">
                  {new Date(a.at).toLocaleTimeString()} · {a.actor.name} · {a.acks.length} ack
                  {a.acks.length === 1 ? '' : 's'}
                </span>
                <div className="row">
                  <button
                    disabled={acked}
                    onClick={() => void run(() => rt.service.acknowledgeAlert(incident.id, a.id))}
                  >
                    {acked ? t(lang, 'ack.acknowledged') : t(lang, 'ack.acknowledge')}
                  </button>
                </div>
                {a.acks.length > 0 && (
                  <ul className="acks small">
                    {a.acks.map((k) => (
                      <li key={k.actor.deviceId}>
                        {k.actor.name} · {new Date(k.at).toLocaleTimeString()}
                        {k.note ? ` · ${k.note}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h3>Check-in</h3>
        <p className="muted small">
          Your last status is what the operator sees. Tap again any time it changes.
        </p>
        <div className="checkin-grid">
          {(
            [
              ['safe', '✓', t(lang, 'checkin.safe')],
              ['evacuated', '⇥', t(lang, 'checkin.evacuated')],
              ['needs_help', '!', t(lang, 'checkin.needs_help')],
            ] as const
          ).map(([status, icon, label]) => {
            const mine = [...incident.checkins].reverse().find((c) => c.actor.deviceId === me);
            const current = mine?.status === status;
            return (
              <button
                key={status}
                className={`checkin checkin-${status}${current ? ' on' : ''}`}
                aria-pressed={current}
                onClick={() => void run(() => rt.service.checkIn(incident.id, status))}
              >
                <span className="checkin-icon" aria-hidden>
                  {icon}
                </span>
                <span>{label}</span>
                {current && mine && (
                  <span className="small muted">{new Date(mine.at).toLocaleTimeString()}</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="small muted">
          {incident.checkins.filter((c) => c.status === 'needs_help').length} need help ·{' '}
          {incident.checkins.filter((c) => c.status === 'safe').length} safe ·{' '}
          {incident.checkins.filter((c) => c.status === 'evacuated').length} evacuated
        </p>
        {incident.checkins.length > 0 && (
          <ul className="small list">
            {[...incident.checkins].reverse().map((c, i) => (
              <li key={i} className={c.status === 'needs_help' ? 'error' : ''}>
                {c.actor.name}: {c.status.replace('_', ' ')} · {new Date(c.at).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Role instructions</h3>
        {CATALOGUES[lang].provenance !== 'source language' && (
          <p className="warn small">{CATALOGUES[lang].provenance}</p>
        )}
        {CATALOGUES[lang].dir === 'rtl' && <p className="muted small">{t(lang, 'rtl.notice')}</p>}
        {(['occupant', 'responder', 'operator'] as const).map((role) => (
          <details key={role} open={role === (s.identity?.role ?? 'operator')}>
            <summary>{role}</summary>
            <ol>
              {lp.instructions[role].map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </details>
        ))}
      </section>
      <OutboxStatus />
    </div>
  );
}

function OutboxStatus() {
  const rt = useRuntime();
  const s = useRuntimeState();
  return (
    <section className="card">
      <h3>Outbox</h3>
      <p>
        <strong>{s.pendingCount}</strong> write{s.pendingCount === 1 ? '' : 's'} pending on this
        device.
      </p>
      {!rt.uplinkConfigured && (
        <p className="muted small">
          No uplink configured (VITE_SYNC_URL). Writes stay durable here and flush when a relay or
          cloud endpoint is configured.
        </p>
      )}
      {rt.uplinkConfigured && (
        <div className="row">
          <button
            disabled={s.connectivity.band === 'local'}
            onClick={() => void rt.flush().then(() => rt.pullRelay())}
          >
            Sync now
          </button>
          <span className="muted small">
            {s.lastFlushAt
              ? `last flush ${new Date(s.lastFlushAt).toLocaleTimeString()} via ${s.lastFlush?.transport}`
              : 'never flushed'}
          </span>
        </div>
      )}
    </section>
  );
}
