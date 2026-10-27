/**
 * Emergency communications domain — event-sourced.
 *
 * Every state change on the console is an immutable EVENT appended to a local, hash-chained log.
 * Incident state is a PROJECTION of those events, so it survives restart, replays identically on
 * every device, and can be exported as evidence. The outbox carries the same events to whatever
 * transport is available (cloud when online, local relay/mesh in later tiers).
 */
export type IncidentType =
  'fire' | 'lockdown' | 'medical' | 'outage' | 'severe_weather' | 'hazmat' | 'other';
export type IncidentStatus = 'active' | 'contained' | 'resolved';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertSeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export interface Actor {
  /** Stable per-device id. */
  deviceId: string;
  /** Human label ("Operator-3f2a", or a signed-in name). */
  name: string;
  role?: 'operator' | 'responder' | 'occupant' | 'system';
}

/** Hazard centre in the venue metre grid [east, north]. */
export type MeterXY = [number, number];

interface Base {
  /** Globally unique event id. */
  id: string;
  incidentId: string;
  /** ISO 8601 wall clock on the originating device. */
  at: string;
  actor: Actor;
  /** Per-device monotonic sequence: orders events from one device even when clocks are wrong. */
  seq: number;
}

export type IncidentEvent =
  | (Base & {
      kind: 'incident.declared';
      type: IncidentType;
      title: string;
      location: string;
      level: string;
      severity: IncidentSeverity;
      hazardXY?: MeterXY;
      venueSlug: string;
    })
  | (Base & { kind: 'incident.updated'; body: string })
  | (Base & { kind: 'incident.status'; status: IncidentStatus; note?: string })
  | (Base & { kind: 'incident.relocated'; location: string; level: string; hazardXY?: MeterXY })
  | (Base & {
      kind: 'alert.broadcast';
      alertId: string;
      title: string;
      body: string;
      severity: AlertSeverity;
      /** Audience filter; empty = everyone in the venue. */
      roles?: Actor['role'][];
    })
  | (Base & { kind: 'alert.acknowledged'; alertId: string; note?: string })
  | (Base & { kind: 'checkin'; status: 'safe' | 'needs_help' | 'evacuated'; location?: string });

export type EventKind = IncidentEvent['kind'];

export interface IncidentUpdate {
  id: string;
  at: string;
  actor: Actor;
  body: string;
}

export interface Alert {
  id: string;
  incidentId: string;
  at: string;
  actor: Actor;
  title: string;
  body: string;
  severity: AlertSeverity;
  roles?: Actor['role'][];
  acks: Array<{ at: string; actor: Actor; note?: string }>;
}

export interface Incident {
  id: string;
  venueSlug: string;
  type: IncidentType;
  title: string;
  location: string;
  level: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: string;
  updatedAt: string;
  resolvedAt?: string;
  hazardXY?: MeterXY;
  declaredBy: Actor;
  updates: IncidentUpdate[];
  alerts: Alert[];
  checkins: Array<{
    at: string;
    actor: Actor;
    status: 'safe' | 'needs_help' | 'evacuated';
    location?: string;
  }>;
  /** Count of events folded into this projection; useful for "n updates" badges and sync diffs. */
  eventCount: number;
}
