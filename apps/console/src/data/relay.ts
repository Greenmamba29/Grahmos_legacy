import { RelayClient, type DeviceKeyStore } from '@terranova/core';
import { getSetting, setSetting, type TerraNovaDB } from './db';

/** Device-key pins persisted in IndexedDB so first-sight trust survives restarts. */
export class DexieDeviceKeyStore implements DeviceKeyStore {
  constructor(private readonly d: TerraNovaDB) {}
  async get(deviceId: string): Promise<string | null> {
    return getSetting<string | null>(`devkey:${deviceId}`, null, this.d);
  }
  async put(deviceId: string, publicKey: string): Promise<void> {
    await setSetting(`devkey:${deviceId}`, publicKey, this.d);
  }
}

export const RELAY_URL_BUILD: string | null = import.meta.env.VITE_RELAY_URL || null;

export async function loadRelayUrl(d: TerraNovaDB): Promise<string | null> {
  return getSetting<string | null>('relayUrl', RELAY_URL_BUILD, d);
}
export async function saveRelayUrl(d: TerraNovaDB, url: string | null): Promise<void> {
  await setSetting('relayUrl', url, d);
}

export function makeRelayClient(
  baseUrl: string,
  venueSlug: string,
  deviceId: string,
  seed: Uint8Array,
): RelayClient {
  return new RelayClient({ baseUrl: baseUrl.replace(/\/$/, ''), venueSlug, deviceId, seed });
}
