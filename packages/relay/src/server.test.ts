import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  CommsService,
  EventLog,
  MemoryDeviceKeyStore,
  MemoryEventLogStore,
  MemoryOutboxStore,
  Outbox,
  RelayClient,
} from '@terranova/core';
import { randomSeed } from '@terranova/core/crypto';
import { createRelay } from './server.js';
import { FileRelayLogStore } from './fileStore.js';
import { FilePackRegistryStore } from './packStore.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tn-relay-'));
const logPath = join(dir, 'log.jsonl');
let base = '';
let stop: () => Promise<void>;

beforeAll(async () => {
  const { server } = createRelay({
    relayId: 'test-relay',
    log: new FileRelayLogStore(logPath),
    packs: new FilePackRegistryStore(join(dir, 'packs')),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stop = () => new Promise((r) => server.close(() => r()));
});
afterAll(async () => stop());

function device(id: string) {
  const svc = new CommsService({
    log: new EventLog(new MemoryEventLogStore()),
    outbox: new Outbox(new MemoryOutboxStore()),
    actor: () => ({ deviceId: id, name: id, role: 'responder' }),
  });
  const client = new RelayClient({
    baseUrl: base,
    venueSlug: 'v',
    deviceId: id,
    seed: randomSeed(),
  });
  const keys = new MemoryDeviceKeyStore();
  let cursor = 0;
  return {
    svc,
    async sync() {
      await svc.flush(client);
      const p = await client.pull(cursor, keys);
      cursor = p.cursor;
      await svc.ingestRemote(p.events);
      return p;
    },
  };
}

describe('relay over real HTTP with a file log', () => {
  it('health, exchange, and restart from disk', async () => {
    const h = await (await fetch(`${base}/v1/health`)).json();
    expect(h).toMatchObject({ ok: true, relayId: 'test-relay', cursor: 0 });

    const A = device('dev-A');
    const B = device('dev-B');
    await A.svc.init();
    await B.svc.init();
    const d = await A.svc.declareIncident({
      venueSlug: 'v',
      type: 'lockdown',
      title: 'Lockdown',
      location: 'Lobby',
      level: 'G',
      severity: 'critical',
    });
    await A.sync();
    await B.sync();
    expect(B.svc.incidents.get(d.incidentId)?.type).toBe('lockdown');
    await B.svc.checkIn(d.incidentId, 'safe', 'Lobby');
    await B.sync();
    await A.sync();
    expect(A.svc.incidents.get(d.incidentId)?.checkins[0]?.actor.deviceId).toBe('dev-B');

    // A second relay process over the same log file resumes at the same cursor.
    const again = createRelay({ relayId: 'test-relay', log: new FileRelayLogStore(logPath) });
    await again.core.load();
    expect(again.core.head).toBe(2);
    expect(again.core.count).toBe(2);

    const bad = await fetch(`${base}/v1/envelopes`, {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.status).toBe(400);
  });

  it('pack registry: publish a signed fixture, list it, fetch bytes, refuse junk, survive restart', async () => {
    const zip = readFileSync(
      resolve(__dirname, '../../../apps/console/public/packs/harbor-general-hospital.zip'),
    );
    const pub = await fetch(`${base}/v1/packs`, {
      method: 'POST',
      body: zip,
      headers: { 'content-type': 'application/zip' },
    });
    expect(pub.status).toBe(201);
    expect(await pub.json()).toMatchObject({ slug: 'harbor-general-hospital', version: '1.0.0' });
    expect((await fetch(`${base}/v1/packs`, { method: 'POST', body: zip })).status).toBe(409);
    const junk = await fetch(`${base}/v1/packs`, { method: 'POST', body: 'not a zip' });
    expect(junk.status).toBe(422);
    const list = (await (await fetch(`${base}/v1/packs`)).json()) as Array<{ slug: string }>;
    expect(list.map((l) => l.slug)).toEqual(['harbor-general-hospital']);
    const got = await fetch(`${base}/v1/packs/harbor-general-hospital`);
    expect(got.headers.get('x-pack-version')).toBe('1.0.0');
    expect(Buffer.from(await got.arrayBuffer()).equals(zip)).toBe(true);
    const again = createRelay({
      relayId: 'test-relay',
      packs: new FilePackRegistryStore(join(dir, 'packs')),
    });
    expect((await again.registry.list()).length).toBe(1);
  });
});
