import type { Incident, IncidentEvent } from './types.js';

/** Order: wall clock, then per-device seq, then id — deterministic on every device. */
export function compareEvents(a: IncidentEvent, b: IncidentEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.actor.deviceId === b.actor.deviceId && a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Fold one event into an incident projection. Returns the same object when the event cannot apply
 * (e.g. an update for an incident never declared) so a stray event never fabricates state.
 */
export function applyEvent(current: Incident | undefined, ev: IncidentEvent): Incident | undefined {
  if (ev.kind === 'incident.declared') {
    if (current) return current; // duplicate declaration: first one wins
    const inc: Incident = {
      id: ev.incidentId,
      venueSlug: ev.venueSlug,
      type: ev.type,
      title: ev.title,
      location: ev.location,
      level: ev.level,
      status: 'active',
      severity: ev.severity,
      startedAt: ev.at,
      updatedAt: ev.at,
      declaredBy: ev.actor,
      updates: [],
      alerts: [],
      checkins: [],
      eventCount: 1,
    };
    if (ev.hazardXY) inc.hazardXY = ev.hazardXY;
    return inc;
  }
  if (!current) return undefined;
  const next: Incident = { ...current, updatedAt: ev.at, eventCount: current.eventCount + 1 };
  switch (ev.kind) {
    case 'incident.updated':
      next.updates = [...current.updates, { id: ev.id, at: ev.at, actor: ev.actor, body: ev.body }];
      return next;
    case 'incident.status':
      next.status = ev.status;
      if (ev.status === 'resolved') next.resolvedAt = ev.at;
      else delete next.resolvedAt;
      if (ev.note)
        next.updates = [
          ...current.updates,
          { id: ev.id, at: ev.at, actor: ev.actor, body: ev.note },
        ];
      return next;
    case 'incident.relocated':
      next.location = ev.location;
      next.level = ev.level;
      if (ev.hazardXY) next.hazardXY = ev.hazardXY;
      else delete next.hazardXY;
      return next;
    case 'alert.broadcast':
      if (current.alerts.some((a) => a.id === ev.alertId)) return current;
      next.alerts = [
        ...current.alerts,
        {
          id: ev.alertId,
          incidentId: ev.incidentId,
          at: ev.at,
          actor: ev.actor,
          title: ev.title,
          body: ev.body,
          severity: ev.severity,
          ...(ev.roles ? { roles: ev.roles } : {}),
          acks: [],
        },
      ];
      return next;
    case 'alert.acknowledged': {
      const alert = current.alerts.find((a) => a.id === ev.alertId);
      if (!alert) return current;
      if (alert.acks.some((k) => k.actor.deviceId === ev.actor.deviceId)) return current;
      next.alerts = current.alerts.map((a) =>
        a.id === ev.alertId
          ? {
              ...a,
              acks: [
                ...a.acks,
                { at: ev.at, actor: ev.actor, ...(ev.note ? { note: ev.note } : {}) },
              ],
            }
          : a,
      );
      return next;
    }
    case 'checkin':
      next.checkins = [
        ...current.checkins,
        {
          at: ev.at,
          actor: ev.actor,
          status: ev.status,
          ...(ev.location ? { location: ev.location } : {}),
        },
      ];
      return next;
    default:
      return current;
  }
}

/** Project a full event log into incidents. Idempotent: duplicate event ids are folded once. */
export function projectIncidents(events: Iterable<IncidentEvent>): Map<string, Incident> {
  const seen = new Set<string>();
  const ordered = [...events]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort(compareEvents);
  const out = new Map<string, Incident>();
  for (const ev of ordered) {
    const next = applyEvent(out.get(ev.incidentId), ev);
    if (next) out.set(ev.incidentId, next);
  }
  return out;
}

export const activeIncidents = (m: Map<string, Incident>): Incident[] =>
  [...m.values()]
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
