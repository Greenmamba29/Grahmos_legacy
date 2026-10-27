import Dexie, { type Table } from 'dexie';
import type { IncidentEvent, OutboxEnvelope, Sealed } from '@terranova/core';

export interface EventRow {
  /** Monotonic insertion order — the chain order. */
  n?: number;
  eventId: string;
  link: Sealed<IncidentEvent>;
}
export interface SettingRow {
  key: string;
  value: unknown;
}
export interface PackRow {
  slug: string;
  version: string;
  bytes: Uint8Array;
  installedAt: string;
  source: 'bundled' | 'file' | 'url';
}

/**
 * Local truth. Three stores that matter for Tier 0:
 *   events   the sealed, hash-chained incident log (append-only)
 *   outbox   writes that have not yet been accepted elsewhere
 *   packs    verified venue-pack bytes, so a restart never needs the origin
 */
export class TerraNovaDB extends Dexie {
  events!: Table<EventRow, number>;
  outbox!: Table<OutboxEnvelope, string>;
  settings!: Table<SettingRow, string>;
  packs!: Table<PackRow, string>;

  constructor(name = 'terranova') {
    super(name);
    this.version(1).stores({
      events: '++n, &eventId',
      outbox: '&id, createdAt',
      settings: '&key',
      packs: '&slug',
    });
  }
}

let shared: TerraNovaDB | null = null;
export function db(): TerraNovaDB {
  if (!shared) shared = new TerraNovaDB();
  return shared;
}

export async function getSetting<T>(key: string, fallback: T, d: TerraNovaDB = db()): Promise<T> {
  const row = await d.settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting(
  key: string,
  value: unknown,
  d: TerraNovaDB = db(),
): Promise<void> {
  await d.settings.put({ key, value });
}
