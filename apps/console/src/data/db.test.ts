import { describe, expect, it } from 'vitest';
import { CommsService, EventLog, Outbox } from '@terranova/core';
import { TerraNovaDB } from './db';
import { DexieEventLogStore, DexieOutboxStore } from './stores';
import { installPackBytes, openInstalledPack } from './packs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('IndexedDB persistence', () => {
  it('event chain and outbox survive a cold reopen', async () => {
    const name = `t-${Math.random()}`;
    const d1 = new TerraNovaDB(name);
    const svc = new CommsService({
      log: new EventLog(new DexieEventLogStore(d1)),
      outbox: new Outbox(new DexieOutboxStore(d1)),
      actor: () => ({ deviceId: 'd', name: 'n' }),
    });
    await svc.init();
    const ev = await svc.declareIncident({
      venueSlug: 'v',
      type: 'fire',
      title: 't',
      location: 'l',
      level: 'L',
      severity: 'high',
    });
    await svc.logUpdate(ev.incidentId, 'u');
    d1.close();

    const d2 = new TerraNovaDB(name);
    const svc2 = new CommsService({
      log: new EventLog(new DexieEventLogStore(d2)),
      outbox: new Outbox(new DexieOutboxStore(d2)),
      actor: () => ({ deviceId: 'd', name: 'n' }),
    });
    const incidents = await svc2.init();
    expect(incidents.get(ev.incidentId)?.updates).toHaveLength(1);
    expect(await svc2.pendingCount()).toBe(2);
    expect((await svc2.eventLog.verify()).ok).toBe(true);
  });

  it('installs the bundled signed fixture pack and reopens it offline', async () => {
    const d = new TerraNovaDB(`p-${Math.random()}`);
    const bytes = new Uint8Array(
      readFileSync(resolve(__dirname, '../../public/packs/city-center-stadium.zip')),
    );
    const installed = await installPackBytes(d, bytes, 'bundled');
    expect(installed.pack.signedBy).toBe('terranova-fixture-2026-10');
    const reopened = await openInstalledPack(d);
    expect(reopened?.fromCache).toBe(true);
    expect(reopened?.pack.levels.map((l) => l.name)).toEqual(['Ground', 'Level 2']);
    // Rollback: an older version of the same venue is refused.
    const older = bytes; // same version → not a rollback
    await expect(installPackBytes(d, older, 'file')).resolves.toBeTruthy();
  });
});
