import { getSetting, setSetting, type TerraNovaDB } from './db';
import type { Actor } from '@terranova/core';

const rand = (): string => Math.random().toString(36).slice(2, 10);

export interface DeviceIdentity {
  deviceId: string;
  name: string;
  role: NonNullable<Actor['role']>;
}

export async function loadIdentity(d: TerraNovaDB): Promise<DeviceIdentity> {
  let id = await getSetting<DeviceIdentity | null>('identity', null, d);
  if (!id) {
    const deviceId = `device-${rand()}`;
    id = { deviceId, name: `Operator-${deviceId.slice(-4)}`, role: 'operator' };
    await setSetting('identity', id, d);
  }
  return id;
}

export async function saveIdentity(d: TerraNovaDB, id: DeviceIdentity): Promise<void> {
  await setSetting('identity', id, d);
}
