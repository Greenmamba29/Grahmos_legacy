import { randomSeed, toHex, fromHex, publicKeyFromSeed } from '@terranova/core/crypto';
import { getSetting, setSetting, type TerraNovaDB } from './db';

/**
 * Per-device Ed25519 key for signing checkpoints. Generated on first boot and kept in IndexedDB.
 * It never leaves the device; only the public key is exported in evidence. Rotating it is a
 * deliberate operator action (Diagnostics), which starts a new checkpoint lineage.
 */
export interface DeviceKey {
  seedHex: string;
  publicKeyHex: string;
  createdAt: string;
}

export async function loadDeviceKey(d: TerraNovaDB): Promise<DeviceKey> {
  let k = await getSetting<DeviceKey | null>('deviceKey', null, d);
  if (!k) k = await rotateDeviceKey(d);
  return k;
}

export async function rotateDeviceKey(d: TerraNovaDB): Promise<DeviceKey> {
  const seed = randomSeed();
  const k: DeviceKey = {
    seedHex: toHex(seed),
    publicKeyHex: toHex(publicKeyFromSeed(seed)),
    createdAt: new Date().toISOString(),
  };
  await setSetting('deviceKey', k, d);
  return k;
}

export const seedBytes = (k: DeviceKey): Uint8Array => fromHex(k.seedHex);
