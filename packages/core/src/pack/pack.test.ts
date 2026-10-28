import { describe, expect, it } from 'vitest';
import { buildPackFiles, packZip, PackGateError } from './build.js';
import { signManifest, isRollback, compareSemver } from './manifest.js';
import { verifyPack, PackVerifyError } from './verify.js';
import {
  FIXTURE_SIGNING_KEY_ID,
  FIXTURE_SIGNING_SEED_HEX,
  PINNED_PACK_SIGNING_KEYS,
} from './keys.js';
import { fromHex } from '../crypto/hex.js';
import { sha256Hex } from '../crypto/sha256.js';
import { readZip, writeZip, u8, str } from './zip.js';
import { CITY_CENTER_FLOORS, CITY_CENTER_LEVELS } from '../safetymap/fixtures/cityCenter.js';
import { amenity, floor, path, rect, unit } from '../safetymap/fixtures/builders.js';

const seed = fromHex(FIXTURE_SIGNING_SEED_HEX);
const input = {
  venueSlug: 'city-center-stadium',
  venueName: 'City Center Stadium (fixture)',
  version: '1.2.0',
  levels: [...CITY_CENTER_LEVELS],
  floors: CITY_CENTER_FLOORS,
  provenance: { sources: ['hand-digitised fixture'], validation: 'fixture' as const },
  createdAt: '2026-10-27T00:00:00.000Z',
};

function signedZip() {
  const { files, manifest } = buildPackFiles(input);
  return packZip(files, signManifest(manifest, seed, FIXTURE_SIGNING_KEY_ID));
}

describe('pack build + verify', () => {
  it('round-trips a signed pack', () => {
    const zip = signedZip();
    const v = verifyPack(zip, { pinnedKeys: PINNED_PACK_SIGNING_KEYS });
    expect(v.signedBy).toBe(FIXTURE_SIGNING_KEY_ID);
    expect(v.levels.map((l) => l.name)).toEqual(['Ground', 'Level 2']);
    expect(v.manifest.stats.exits).toBe(6);
    expect(v.checks).toContain('anti-rollback');
  });
  it('is deterministic', () => {
    expect(Buffer.from(signedZip()).equals(Buffer.from(signedZip()))).toBe(true);
  });
  it('rejects a tampered floor at the integrity stage', () => {
    const files = readZip(signedZip());
    const name = 'floors/Level 2.geojson';
    const fc = JSON.parse(str(files[name]!));
    fc.features = fc.features.filter(
      (f: { properties: { id: string } }) => f.properties.id !== 'exitA',
    );
    files[name] = u8(JSON.stringify(fc));
    expect(() => verifyPack(writeZip(files), { pinnedKeys: PINNED_PACK_SIGNING_KEYS })).toThrow(
      /hash mismatch/,
    );
  });
  it('rejects a re-hashed pack at the signature stage (forgery, not corruption)', () => {
    const { files, manifest } = buildPackFiles(input);
    const signed = signManifest(manifest, seed, FIXTURE_SIGNING_KEY_ID);
    const forged = { ...signed, hashes: { ...signed.hashes, 'procedures.json': 'ab'.repeat(32) } };
    files['procedures.json'] = u8('{}');
    let err: unknown;
    try {
      verifyPack(packZip(files, forged), { pinnedKeys: PINNED_PACK_SIGNING_KEYS });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PackVerifyError);
    // hash is wrong first, so integrity trips; recompute honestly and the signature trips instead
    forged.hashes['procedures.json'] = sha256Hex(u8('{}'));
    expect(() =>
      verifyPack(packZip(files, forged), { pinnedKeys: PINNED_PACK_SIGNING_KEYS }),
    ).toThrow(/does not match/);
  });
  it('rejects unsigned, unknown key, and extra files', () => {
    const { files, manifest } = buildPackFiles(input);
    expect(() =>
      verifyPack(packZip(files, manifest), { pinnedKeys: PINNED_PACK_SIGNING_KEYS }),
    ).toThrow(/no signature/);
    const unknown = signManifest(manifest, seed, 'someone-else');
    expect(() =>
      verifyPack(packZip(files, unknown), { pinnedKeys: PINNED_PACK_SIGNING_KEYS }),
    ).toThrow(/unknown key/);
    const v = verifyPack(packZip(files, manifest), { pinnedKeys: {}, allowUnsigned: true });
    expect(v.checks.some((c) => c.startsWith('UNSIGNED'))).toBe(true);
    const extra = readZip(signedZip());
    extra['evil.js'] = u8('x');
    expect(() => verifyPack(writeZip(extra), { pinnedKeys: PINNED_PACK_SIGNING_KEYS })).toThrow(
      /not covered/,
    );
  });
  it('refuses rollback', () => {
    expect(() =>
      verifyPack(signedZip(), { pinnedKeys: PINNED_PACK_SIGNING_KEYS, installedVersion: '1.3.0' }),
    ).toThrow(/older than installed/);
    expect(isRollback('1.2.0', '1.2.0')).toBe(false);
    expect(compareSemver('1.2.0-rc.1', '1.2.0')).toBe(-1);
  });
  it('gate refuses an unroutable floor', () => {
    const bad = floor([
      unit('island', 'Island', rect(500, 500, 10, 10)),
      path('p', [
        [0, 0],
        [10, 0],
      ]),
      amenity('e', 'exit', 'E', [10, 1]),
    ]);
    expect(() =>
      buildPackFiles({
        ...input,
        levels: [{ id: 'x', name: 'X', ordinal: 0 }],
        floors: { X: bad },
      }),
    ).toThrow(PackGateError);
  });
});

describe('anchor is part of the signed payload', () => {
  it('moving the venue invalidates the signature', () => {
    const { files, manifest } = buildPackFiles({
      ...input,
      anchor: { lng: -122.3313, lat: 47.5951 },
    });
    const signed = signManifest(manifest, seed, FIXTURE_SIGNING_KEY_ID);
    expect(
      verifyPack(packZip(files, signed), { pinnedKeys: PINNED_PACK_SIGNING_KEYS }).manifest.anchor
        ?.lat,
    ).toBe(47.5951);
    const moved = { ...signed, anchor: { lng: -122.3313, lat: 47.6 } };
    expect(() =>
      verifyPack(packZip(files, moved), { pinnedKeys: PINNED_PACK_SIGNING_KEYS }),
    ).toThrow(/does not match/);
  });
});
