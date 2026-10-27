import { describe, expect, it } from 'vitest';
import { MemoryPackRegistryStore, PackRegistry } from './registry.js';
import { buildPackFiles, packZip } from '../pack/build.js';
import { signManifest } from '../pack/manifest.js';
import { FIXTURE_SIGNING_KEY_ID, FIXTURE_SIGNING_SEED_HEX } from '../pack/keys.js';
import { fromHex } from '../crypto/hex.js';
import { CITY_CENTER_FLOORS, CITY_CENTER_LEVELS } from '../safetymap/fixtures/cityCenter.js';

const seed = fromHex(FIXTURE_SIGNING_SEED_HEX);
const pack = (version: string, signed = true): Uint8Array => {
  const { files, manifest } = buildPackFiles({
    venueSlug: 'city-center-stadium',
    venueName: 'City Center (fixture)',
    version,
    levels: [...CITY_CENTER_LEVELS],
    floors: CITY_CENTER_FLOORS,
    provenance: { sources: ['fixture'], validation: 'fixture' },
    createdAt: 't',
  });
  return packZip(files, signed ? signManifest(manifest, seed, FIXTURE_SIGNING_KEY_ID) : manifest);
};

describe('pack registry', () => {
  it('accepts signed packs, lists them, refuses unsigned, duplicate and rollback', async () => {
    const reg = new PackRegistry(
      new MemoryPackRegistryStore(),
      undefined,
      () => new Date('2026-10-27T00:00:00Z'),
    );
    expect((await reg.publish(pack('1.2.0'))).status).toBe('accepted');
    expect((await reg.publish(pack('1.2.0'))).status).toBe('duplicate');
    expect(await reg.publish(pack('1.1.0'))).toMatchObject({
      status: 'rejected',
      stage: 'rollback',
    });
    expect(await reg.publish(pack('1.3.0', false))).toMatchObject({
      status: 'rejected',
      stage: 'signature',
    });
    expect((await reg.publish(pack('1.3.0'))).status).toBe('accepted');
    const list = await reg.list();
    expect(list).toEqual([
      expect.objectContaining({
        slug: 'city-center-stadium',
        version: '1.3.0',
        validation: 'fixture',
        signedBy: FIXTURE_SIGNING_KEY_ID,
      }),
    ]);
    expect((await reg.get('city-center-stadium'))?.bytes.length).toBeGreaterThan(1000);
    expect(await reg.get('nope')).toBeNull();
  });
});
