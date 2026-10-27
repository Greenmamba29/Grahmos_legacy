import { describe, expect, it } from 'vitest';
import { MemoryDeviceKeyStore, sealEnvelope, verifyEnvelope } from './envelope.js';
import { MemoryRelayLogStore, RelayCore } from './store.js';
import { RelayClient } from './client.js';
import {
  CommsService,
  EventLog,
  MemoryEventLogStore,
  MemoryOutboxStore,
  Outbox,
} from '../comms/index.js';
import { randomSeed } from '../crypto/ed25519.js';
import { sha256Hex } from '../crypto/sha256.js';
import { canonicalize } from '../crypto/canonicalJson.js';
import type { IncidentEvent } from '../comms/types.js';

const actorA = { deviceId: 'dev-A', name: 'A' };
const seedA = randomSeed();
const seedB = randomSeed();

const declared = (): IncidentEvent => ({
  id: 'e1',
  incidentId: 'inc',
  at: '2026-10-27T10:00:00Z',
  actor: actorA,
  seq: 1,
  kind: 'incident.declared',
  venueSlug: 'v',
  type: 'fire',
  title: 't',
  location: 'l',
  level: 'L',
  severity: 'high',
});

describe('envelope', () => {
  it('seals, verifies, pins the device key on first sight, and refuses a key swap', async () => {
    const keys = new MemoryDeviceKeyStore();
    const env = sealEnvelope(declared(), 'v', 'dev-A', seedA);
    expect(await verifyEnvelope(env, keys)).toEqual({ ok: true, firstSight: true });
    expect(await verifyEnvelope(env, keys)).toEqual({ ok: true, firstSight: false });
    const swapped = sealEnvelope(declared(), 'v', 'dev-A', seedB);
    expect(await verifyEnvelope(swapped, keys)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/pinned to a different key/),
    });
  });
  it('rejects a tampered event and an actor/device mismatch', async () => {
    const keys = new MemoryDeviceKeyStore();
    const env = sealEnvelope(declared(), 'v', 'dev-A', seedA);
    const tampered = { ...env, event: { ...env.event, title: 'evil' } as IncidentEvent };
    expect((await verifyEnvelope(tampered, keys)).ok).toBe(false);
    const mismatch = sealEnvelope(declared(), 'v', 'dev-B', seedB);
    expect(await verifyEnvelope(mismatch, keys)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/actor does not match/),
    });
  });
});

/** In-process fetch bound to a RelayCore, so the client/transport path is exercised without sockets. */
function fetchFor(core: RelayCore): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://relay.local');
    if (init?.method === 'POST') {
      const r = await core.accept(JSON.parse(String(init.body)));
      if (r.status === 'rejected')
        return new Response(JSON.stringify({ reason: r.verdict.reason }), { status: 422 });
      return new Response(JSON.stringify(r.result), {
        status: r.status === 'duplicate' ? 409 : 202,
      });
    }
    const out = await core.pull(
      url.searchParams.get('venue'),
      Number(url.searchParams.get('since') ?? 0),
      Number(url.searchParams.get('limit') ?? 200),
    );
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
}

function device(
  id: string,
  seed: Uint8Array,
  core: RelayCore,
  stores?: { log: MemoryEventLogStore; out: MemoryOutboxStore },
) {
  const log = stores?.log ?? new MemoryEventLogStore();
  const out = stores?.out ?? new MemoryOutboxStore();
  const svc = new CommsService({
    log: new EventLog(log),
    outbox: new Outbox(out),
    actor: () => ({ deviceId: id, name: id, role: 'operator' }),
  });
  const client = new RelayClient({
    baseUrl: 'http://relay.local',
    venueSlug: 'v',
    deviceId: id,
    seed,
    fetch: fetchFor(core),
  });
  const keys = new MemoryDeviceKeyStore();
  let cursor = 0;
  const sync = async () => {
    await svc.flush(client);
    const p = await client.pull(cursor, keys);
    cursor = p.cursor;
    await svc.ingestRemote(p.events);
    return p;
  };
  return { svc, sync, stores: { log, out } };
}

describe('V2a acceptance: isolated relay incident exchange', () => {
  it('A declares → relay → B acknowledges → A receives the ack; restarts reconstruct the same state', async () => {
    const core = new RelayCore('relay-1', new MemoryRelayLogStore(), new MemoryDeviceKeyStore());
    const A = device('dev-A', seedA, core);
    const B = device('dev-B', seedB, core);
    await A.svc.init();
    await B.svc.init();

    const d = await A.svc.declareIncident({
      venueSlug: 'v',
      type: 'fire',
      title: 'Fire – 204',
      location: '204',
      level: 'L2',
      severity: 'high',
    });
    const alert = (await A.svc.broadcastAlert(d.incidentId, {
      title: 'Evacuate',
      body: 'Now',
      severity: 'critical',
    })) as Extract<IncidentEvent, { kind: 'alert.broadcast' }>;
    await A.sync();
    expect(await A.svc.pendingCount()).toBe(0);
    expect(core.count).toBe(2);

    await B.sync();
    const onB = B.svc.incidents.get(d.incidentId)!;
    expect(onB.title).toBe('Fire – 204');
    expect(onB.alerts[0]!.id).toBe(alert.alertId);

    await B.svc.acknowledgeAlert(d.incidentId, alert.alertId, 'B here');
    await B.sync();
    await A.sync();
    const onA = A.svc.incidents.get(d.incidentId)!;
    expect(onA.alerts[0]!.acks.map((k) => k.actor.deviceId)).toEqual(['dev-B']);

    // Restart both from their stores: identical projections, chains intact.
    const A2 = device('dev-A', seedA, core, A.stores);
    const B2 = device('dev-B', seedB, core, B.stores);
    await A2.svc.init();
    await B2.svc.init();
    const strip = (m: Map<string, unknown>) => JSON.stringify([...m.values()]);
    expect(strip(A2.svc.incidents)).toBe(strip(B2.svc.incidents));
    expect((await A2.svc.eventLog.verify()).ok).toBe(true);
    expect((await B2.svc.eventLog.verify()).ok).toBe(true);
  });

  it('relay deduplicates replays and refuses a forged envelope', async () => {
    const core = new RelayCore('relay-2', new MemoryRelayLogStore(), new MemoryDeviceKeyStore());
    const env = sealEnvelope(declared(), 'v', 'dev-A', seedA);
    expect((await core.accept(env)).status).toBe('accepted');
    expect((await core.accept(env)).status).toBe('duplicate');
    // Same id with a different body is caught as a duplicate (never stored); a forgery that
    // recomputes the id reaches signature verification and is rejected.
    const sameId = { ...env, event: { ...env.event, severity: 'low' } as IncidentEvent };
    expect((await core.accept(sameId)).status).toBe('duplicate');
    const forgedEvent = { ...env.event, severity: 'low' } as IncidentEvent;
    const forged = { ...env, event: forgedEvent, id: sha256Hex(canonicalize(forgedEvent)) };
    expect((await core.accept(forged)).status).toBe('rejected');
    expect(core.count).toBe(1);
    const pulled = await core.pull('v', 0);
    expect(pulled.envelopes).toHaveLength(1);
    expect(pulled.cursor).toBe(1);
    expect((await core.pull('other', 0)).envelopes).toHaveLength(0);
  });
});
