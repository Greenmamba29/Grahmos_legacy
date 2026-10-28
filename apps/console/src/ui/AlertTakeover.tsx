import { useEffect, useMemo, useState } from 'react';
import { t, type Incident, type Alert } from '@terranova/core';
import { useRuntime, useRuntimeState } from '../app/store';

/**
 * Full-attention alert sheet. Pattern: a single, unmistakable primary action over everything
 * else (Rivian's "Alarm triggered", Delta's "Acknowledge" modal). Shown for alerts that arrived
 * from ANOTHER device on an unresolved incident and that this device has not acknowledged.
 * "Later" hides it for this session only; the alert stays in the Comms list.
 */
export function AlertTakeover({
  incidents,
  onShowRoute,
}: {
  incidents: Incident[];
  onShowRoute: (incident: Incident) => void;
}) {
  const rt = useRuntime();
  const s = useRuntimeState();
  const me = s.identity?.deviceId;
  const [deferred, setDeferred] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => {
    const out: Array<{ incident: Incident; alert: Alert }> = [];
    for (const inc of incidents) {
      if (inc.status === 'resolved') continue;
      for (const a of inc.alerts) {
        if (a.actor.deviceId === me) continue;
        if (a.acks.some((k) => k.actor.deviceId === me)) continue;
        if (deferred.has(a.id)) continue;
        out.push({ incident: inc, alert: a });
      }
    }
    return out.sort((x, y) => (x.alert.at < y.alert.at ? 1 : -1));
  }, [incidents, me, deferred]);

  const top = pending[0];
  useEffect(() => {
    if (!top) return;
    // Out-of-app channel when the operator granted it; the sheet is the in-app channel.
    try {
      if ('Notification' in window && Notification.permission === 'granted')
        new Notification(top.alert.title, { body: top.alert.body, tag: top.alert.id });
    } catch {
      /* notifications unavailable */
    }
  }, [top?.alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!top) return null;
  const { incident, alert } = top;
  const ack = async (): Promise<void> => {
    setBusy(true);
    try {
      await rt.service.acknowledgeAlert(incident.id, alert.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="takeover-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="takeover-title"
    >
      <div className={`takeover sev-${alert.severity}`}>
        <div className="takeover-kicker">
          {alert.severity.toUpperCase()} · {incident.level} · {incident.location}
          {pending.length > 1 && <span className="pill"> +{pending.length - 1} more</span>}
        </div>
        <h2 id="takeover-title">{alert.title}</h2>
        <p className="takeover-body">{alert.body}</p>
        <p className="takeover-meta">
          From {alert.actor.name} · {new Date(alert.at).toLocaleTimeString()} · {alert.acks.length}{' '}
          acknowledged
        </p>
        <button className="takeover-primary" disabled={busy} onClick={() => void ack()}>
          {t(s.language, 'ack.acknowledge')} alert
        </button>
        <div className="row takeover-secondary">
          <button onClick={() => onShowRoute(incident)}>Show my route</button>
          <button className="ghost" onClick={() => setDeferred(new Set([...deferred, alert.id]))}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
