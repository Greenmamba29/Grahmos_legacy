import type {
  Actor,
  IncidentEvent,
  IncidentSeverity,
  IncidentType,
  MeterXY,
  AlertSeverity,
  IncidentStatus,
  Incident,
} from './types.js';
import type { EventLog } from './log.js';
import type { Outbox } from './outbox.js';
import { type FlushReport, type Transport } from './outbox.js';
import { projectIncidents } from './projection.js';

export interface IdSource {
  (): string;
}

export interface CommsDeps {
  log: EventLog;
  outbox: Outbox;
  actor: () => Actor;
  now?: () => Date;
  newId?: IdSource;
  /** Starting per-device sequence (persisted by the host; defaults to 0). */
  seq?: number;
  onSeq?: (seq: number) => void;
}

export function defaultIdSource(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The console's one write path for emergency communications. Every command:
 *   1. builds an event, 2. seals it onto the local chain, 3. enqueues it to the outbox,
 *   4. notifies subscribers with the fresh projection.
 * Nothing here touches the network; `flush(transport)` is the only outbound call.
 */
export class CommsService {
  private readonly log: EventLog;
  private readonly outbox: Outbox;
  private readonly actor: () => Actor;
  private readonly now: () => Date;
  private readonly newId: IdSource;
  private seq: number;
  private readonly onSeq: ((n: number) => void) | undefined;
  private listeners = new Set<(incidents: Map<string, Incident>) => void>();
  private projection: Map<string, Incident> = new Map();

  constructor(deps: CommsDeps) {
    this.log = deps.log;
    this.outbox = deps.outbox;
    this.actor = deps.actor;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? defaultIdSource;
    this.seq = deps.seq ?? 0;
    this.onSeq = deps.onSeq;
  }

  async init(): Promise<Map<string, Incident>> {
    await this.log.load();
    await this.reproject();
    return this.projection;
  }

  subscribe(fn: (incidents: Map<string, Incident>) => void): () => void {
    this.listeners.add(fn);
    fn(this.projection);
    return () => this.listeners.delete(fn);
  }

  get incidents(): Map<string, Incident> {
    return this.projection;
  }

  private async reproject(): Promise<void> {
    this.projection = projectIncidents(await this.log.events());
    for (const l of this.listeners) l(this.projection);
  }

  private base(incidentId: string): {
    id: string;
    incidentId: string;
    at: string;
    actor: Actor;
    seq: number;
  } {
    this.seq += 1;
    this.onSeq?.(this.seq);
    return {
      id: this.newId(),
      incidentId,
      at: this.now().toISOString(),
      actor: this.actor(),
      seq: this.seq,
    };
  }

  private async commit(ev: IncidentEvent): Promise<IncidentEvent> {
    const link = await this.log.append(ev);
    if (link) await this.outbox.enqueue(ev.id, ev.kind, ev);
    await this.reproject();
    return ev;
  }

  declareIncident(input: {
    venueSlug: string;
    type: IncidentType;
    title: string;
    location: string;
    level: string;
    severity: IncidentSeverity;
    hazardXY?: MeterXY;
    incidentId?: string;
  }): Promise<IncidentEvent> {
    const incidentId = input.incidentId ?? this.newId();
    return this.commit({
      ...this.base(incidentId),
      kind: 'incident.declared',
      venueSlug: input.venueSlug,
      type: input.type,
      title: input.title,
      location: input.location,
      level: input.level,
      severity: input.severity,
      ...(input.hazardXY ? { hazardXY: input.hazardXY } : {}),
    });
  }

  logUpdate(incidentId: string, body: string): Promise<IncidentEvent> {
    return this.commit({ ...this.base(incidentId), kind: 'incident.updated', body });
  }

  setStatus(incidentId: string, status: IncidentStatus, note?: string): Promise<IncidentEvent> {
    return this.commit({
      ...this.base(incidentId),
      kind: 'incident.status',
      status,
      ...(note ? { note } : {}),
    });
  }

  relocate(
    incidentId: string,
    location: string,
    level: string,
    hazardXY?: MeterXY,
  ): Promise<IncidentEvent> {
    return this.commit({
      ...this.base(incidentId),
      kind: 'incident.relocated',
      location,
      level,
      ...(hazardXY ? { hazardXY } : {}),
    });
  }

  broadcastAlert(
    incidentId: string,
    alert: { title: string; body: string; severity: AlertSeverity; roles?: Actor['role'][] },
  ): Promise<IncidentEvent> {
    return this.commit({
      ...this.base(incidentId),
      kind: 'alert.broadcast',
      alertId: this.newId(),
      title: alert.title,
      body: alert.body,
      severity: alert.severity,
      ...(alert.roles ? { roles: alert.roles } : {}),
    });
  }

  acknowledgeAlert(incidentId: string, alertId: string, note?: string): Promise<IncidentEvent> {
    return this.commit({
      ...this.base(incidentId),
      kind: 'alert.acknowledged',
      alertId,
      ...(note ? { note } : {}),
    });
  }

  checkIn(
    incidentId: string,
    status: 'safe' | 'needs_help' | 'evacuated',
    location?: string,
  ): Promise<IncidentEvent> {
    return this.commit({
      ...this.base(incidentId),
      kind: 'checkin',
      status,
      ...(location ? { location } : {}),
    });
  }

  /** Ingest events that arrived from elsewhere (sync, relay, peer). Not re-enqueued. */
  async ingestRemote(events: IncidentEvent[]): Promise<number> {
    let added = 0;
    for (const ev of events) if (await this.log.append(ev)) added += 1;
    if (added) await this.reproject();
    return added;
  }

  flush(transport: Transport): Promise<FlushReport> {
    return this.outbox.flush(transport);
  }

  pendingCount(): Promise<number> {
    return this.outbox.pendingCount();
  }

  get eventLog(): EventLog {
    return this.log;
  }
  get queue(): Outbox {
    return this.outbox;
  }
}
