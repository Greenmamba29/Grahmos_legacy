import { describe, expect, it } from 'vitest';
import { CommsService } from './service.js';
import { EventLog, MemoryEventLogStore } from './log.js';
import {
  MemoryOutboxStore,
  Outbox,
  backoffMs,
  type Transport,
  type OutboxEnvelope,
} from './outbox.js';
import { projectIncidents } from './projection.js';
import { sealEntry, verifyChain } from './auditChain.js';
import type { IncidentEvent } from './types.js';

function makeService(deviceId = 'dev-A') {
  let t = Date.parse('2026-10-27T10:00:00.000Z');
  let n = 0;
  const logStore = new MemoryEventLogStore();
  const outStore = new MemoryOutboxStore();
  const svc = new CommsService({
    log: new EventLog(logStore),
    outbox: new Outbox(outStore, { now: () => new Date(t) }),
    actor: () => ({ deviceId, name: `Op-${deviceId}`, role: 'operator' }),
    now: () => new Date((t += 1000)),
    newId: () => `${deviceId}-${++n}`,
  });
  return { svc, logStore, outStore, tick: (ms: number) => (t += ms) };
}

describe('CommsService', () => {
  it('declare → update → alert → ack → resolve projects correctly and queues every event', async () => {
    const { svc } = makeService();
    await svc.init();
    const d = await svc.declareIncident({
      venueSlug: 'city-center',
      type: 'fire',
      title: 'Fire – Concourse 204',
      location: 'Concourse 204',
      level: 'Level 2',
      severity: 'high',
      hazardXY: [-2, 18],
    });
    await svc.logUpdate(d.incidentId, 'Smoke visible at 204.');
    const a = await svc.broadcastAlert(d.incidentId, {
      title: 'Evacuate Level 2',
      body: 'Use Exits A or C.',
      severity: 'critical',
    });
    const alertId = (a as Extract<IncidentEvent, { kind: 'alert.broadcast' }>).alertId;
    await svc.acknowledgeAlert(d.incidentId, alertId, 'Seen');
    await svc.acknowledgeAlert(d.incidentId, alertId); // same device acks once
    await svc.setStatus(d.incidentId, 'resolved', 'All clear');

    const inc = svc.incidents.get(d.incidentId)!;
    expect(inc.status).toBe('resolved');
    expect(inc.updates.map((u) => u.body)).toEqual(['Smoke visible at 204.', 'All clear']);
    expect(inc.alerts[0]!.acks).toHaveLength(1);
    expect(inc.hazardXY).toEqual([-2, 18]);
    expect(inc.eventCount).toBe(5); // the duplicate ack is logged but not folded
    expect(await svc.pendingCount()).toBe(6);
    expect((await svc.eventLog.verify()).ok).toBe(true);
  });

  it('survives restart: reprojects from the stored chain', async () => {
    const { svc, logStore, outStore } = makeService();
    await svc.init();
    const d = await svc.declareIncident({
      venueSlug: 'v',
      type: 'medical',
      title: 'Collapse',
      location: 'Gate B',
      level: 'Ground',
      severity: 'critical',
    });
    await svc.setStatus(d.incidentId, 'contained');

    const again = new CommsService({
      log: new EventLog(logStore),
      outbox: new Outbox(outStore),
      actor: () => ({ deviceId: 'dev-A', name: 'x' }),
    });
    const incidents = await again.init();
    expect(incidents.get(d.incidentId)?.status).toBe('contained');
    expect(await again.pendingCount()).toBe(2);
  });

  it('ingests remote events idempotently and converges across devices', async () => {
    const A = makeService('dev-A');
    const B = makeService('dev-B');
    await A.svc.init();
    await B.svc.init();
    const d = await A.svc.declareIncident({
      venueSlug: 'v',
      type: 'lockdown',
      title: 'Lockdown',
      location: 'Lobby',
      level: 'Ground',
      severity: 'high',
    });
    const evsA = await A.svc.eventLog.events();
    expect(await B.svc.ingestRemote(evsA)).toBe(1);
    expect(await B.svc.ingestRemote(evsA)).toBe(0);
    await B.svc.logUpdate(d.incidentId, 'Doors secured on B side');
    await A.svc.ingestRemote(await B.svc.eventLog.events());
    const pa = A.svc.incidents.get(d.incidentId)!;
    const pb = B.svc.incidents.get(d.incidentId)!;
    expect(pa.updates).toEqual(pb.updates);
    expect(await B.svc.pendingCount()).toBe(1); // only B's own update is in B's outbox
  });

  it('flushes in order, halts on retry with backoff, drops rejected', async () => {
    const { svc, tick } = makeService();
    await svc.init();
    const d = await svc.declareIncident({
      venueSlug: 'v',
      type: 'outage',
      title: 'Power',
      location: 'Plant',
      level: 'B1',
      severity: 'medium',
    });
    await svc.logUpdate(d.incidentId, 'u1');
    await svc.logUpdate(d.incidentId, 'u2');

    const sent: string[] = [];
    let fail = true;
    const transport: Transport = {
      name: 'test',
      async send(env: OutboxEnvelope) {
        sent.push(env.id);
        if (env.kind === 'incident.updated' && fail) return { status: 'retry', reason: 'timeout' };
        return { status: 'delivered' };
      },
    };
    const r1 = await svc.flush(transport);
    expect(r1.delivered).toEqual(['dev-A-2']); // dev-A-1 is the incident id
    expect(r1.retried).toHaveLength(1);
    expect(r1.haltedOnRetry).toBe(true);
    expect(sent).toEqual(['dev-A-2', 'dev-A-3']);

    // Still backing off: nothing attempted.
    const r2 = await svc.flush(transport);
    expect(r2.skipped).toBe(1);
    expect(r2.delivered).toEqual([]);

    tick(backoffMs(1) + 1);
    fail = false;
    const r3 = await svc.flush(transport);
    expect(r3.delivered).toEqual(['dev-A-3', 'dev-A-4']);
    expect(await svc.pendingCount()).toBe(0);

    await svc.logUpdate(d.incidentId, 'bad');
    const rejecting: Transport = {
      name: 'r',
      async send() {
        return { status: 'rejected', reason: 'schema' };
      },
    };
    const r4 = await svc.flush(rejecting);
    expect(r4.rejected[0]?.reason).toBe('schema');
    expect(await svc.pendingCount()).toBe(0);
  });
});

describe('projection', () => {
  const actor = { deviceId: 'd', name: 'n' };
  it('ignores events for undeclared incidents and orders by time then seq', () => {
    const evs: IncidentEvent[] = [
      {
        id: 'e2',
        incidentId: 'i',
        at: '2026-01-01T00:00:01Z',
        actor,
        seq: 2,
        kind: 'incident.updated',
        body: 'second',
      },
      {
        id: 'e1',
        incidentId: 'i',
        at: '2026-01-01T00:00:00Z',
        actor,
        seq: 1,
        kind: 'incident.declared',
        type: 'fire',
        title: 't',
        location: 'l',
        level: 'L',
        severity: 'low',
        venueSlug: 'v',
      },
      {
        id: 'e3',
        incidentId: 'ghost',
        at: '2026-01-01T00:00:02Z',
        actor,
        seq: 3,
        kind: 'incident.updated',
        body: 'nope',
      },
      {
        id: 'e2',
        incidentId: 'i',
        at: '2026-01-01T00:00:01Z',
        actor,
        seq: 2,
        kind: 'incident.updated',
        body: 'second',
      },
    ];
    const m = projectIncidents(evs);
    expect(m.size).toBe(1);
    expect(m.get('i')!.updates.map((u) => u.body)).toEqual(['second']);
  });
});

describe('audit chain', () => {
  it('detects edits and removals', () => {
    const a = sealEntry({ x: 1 }, '');
    const b = sealEntry({ x: 2 }, a.hash);
    const c = sealEntry({ x: 3 }, b.hash);
    expect(verifyChain([a, b, c]).ok).toBe(true);
    expect(verifyChain([a, { ...b, entry: { x: 99 } }, c])).toMatchObject({
      ok: false,
      brokenAt: 1,
    });
    expect(verifyChain([a, c])).toMatchObject({ ok: false, brokenAt: 1 });
  });
});
