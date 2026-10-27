#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildPackFiles,
  packZip,
  signManifest,
  verifyPack,
  PackGateError,
  PackVerifyError,
  PINNED_PACK_SIGNING_KEYS,
  FIXTURE_SIGNING_KEY_ID,
  FIXTURE_SIGNING_SEED_HEX,
  gateFloors,
  fixtures,
  type PackManifest,
  type BuildInput,
} from '@terranova/core';
import { fromHex, toHex, publicKeyFromSeed, randomSeed } from '@terranova/core/crypto';

const HELP = `terranova — TerraNova venue-pack and resilience tooling

  terranova pack fixture <out.zip> [--venue city-center|harbor-general]
      Build and sign the engineering fixture pack (fixture key; never a real venue).
  terranova pack build <spec.json> <out.zip> [--seed-env PACK_SIGNING_SEED --key-id <id>]
      Build a pack from a spec {venueSlug, venueName, version, levels, floors:{name:path}, provenance}.
      Unsigned unless a seed is supplied via the named environment variable.
  terranova pack verify <pack.zip> [--installed <version>] [--allow-unsigned]
      Verify format, SHA-256 integrity, Ed25519 signature (pinned keys), anti-rollback, content.
  terranova pack inspect <pack.zip>
      Print the manifest without trusting it.
  terranova gate floors <floor.geojson>...
      Run the floor contract + routability gate on floor files. Exit 1 on failure.
  terranova keygen
      Print a fresh Ed25519 seed + public key (hex). The seed is a SECRET.
`;

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, 'utf8')) as T;
}

async function writeBytes(p: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(resolve(p)), { recursive: true });
  await writeFile(p, bytes);
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return 0;
  }
  if (cmd === 'keygen') {
    const seed = randomSeed();
    console.log(
      JSON.stringify(
        { seed_hex: toHex(seed), public_key_hex: toHex(publicKeyFromSeed(seed)) },
        null,
        2,
      ),
    );
    return 0;
  }
  if (cmd === 'gate' && sub === 'floors') {
    let failed = false;
    for (const file of rest.filter((r) => !r.startsWith('--'))) {
      const floor = await readJson<Parameters<typeof gateFloors>[1][string]>(file);
      const failures = gateFloors([{ id: file, name: file, ordinal: 0 }], { [file]: floor });
      if (failures.length) {
        failed = true;
        console.error(`FAIL ${file}`);
        for (const f of failures) {
          for (const i of f.issues) console.error(`  ${i.severity}: ${i.feature}: ${i.message}`);
          for (const r of f.unreachableRooms) console.error(`  error: ${r} cannot reach any exit`);
          for (const s of f.suspect) console.error(`  error: suspect snap ${s}`);
          for (const m of f.malformed) console.error(`  error: malformed ${m}`);
        }
      } else console.log(`ok   ${file}`);
    }
    return failed ? 1 : 0;
  }
  if (cmd === 'pack') {
    if (sub === 'fixture') {
      const out = rest[0];
      if (!out) throw new Error('missing <out.zip>');
      const venue = arg('--venue', rest) ?? 'city-center';
      const input =
        venue === 'harbor-general'
          ? {
              venueSlug: 'harbor-general-hospital',
              venueName: 'Harbor General Hospital — Wing 3 (fixture)',
              version: '1.0.0',
              levels: [{ id: 'w3-l2', name: 'Level 2', ordinal: 0 }],
              floors: { 'Level 2': fixtures.HARBOR_GENERAL_W3 },
              provenance: {
                sources: ['hand-digitised engineering fixture'],
                validation: 'fixture' as const,
                limitations: ['Not a real facility. Never deploy for operations.'],
              },
              procedures: HOSPITAL_PROCEDURES,
            }
          : {
              venueSlug: 'city-center-stadium',
              venueName: 'City Center Stadium (fixture)',
              version: '1.2.0',
              levels: [...fixtures.CITY_CENTER_LEVELS],
              floors: fixtures.CITY_CENTER_FLOORS,
              provenance: {
                sources: ['hand-digitised engineering fixture'],
                validation: 'fixture' as const,
                limitations: ['Not a real venue. Never deploy for operations.'],
              },
              procedures: STADIUM_PROCEDURES,
            };
      const { files, manifest } = buildPackFiles({
        ...input,
        createdAt: '2026-10-27T00:00:00.000Z',
      });
      const signed = signManifest(
        manifest,
        fromHex(FIXTURE_SIGNING_SEED_HEX),
        FIXTURE_SIGNING_KEY_ID,
      );
      await writeBytes(out, packZip(files, signed));
      console.log(
        `wrote ${out} (${manifest.venue_slug}@${manifest.version}, ${Object.keys(files).length} files, signed by ${FIXTURE_SIGNING_KEY_ID})`,
      );
      return 0;
    }
    if (sub === 'build') {
      const [specPath, out] = rest;
      if (!specPath || !out) throw new Error('usage: pack build <spec.json> <out.zip>');
      const spec = await readJson<{
        venueSlug: string;
        venueName: string;
        version: string;
        levels: Array<{ id: string; name: string; ordinal: number }>;
        floors: Record<string, string>;
        provenance: PackManifest['provenance'];
        procedures?: string;
      }>(specPath);
      const base = dirname(resolve(specPath));
      const floors: Record<string, Parameters<typeof gateFloors>[1][string]> = {};
      for (const [name, rel] of Object.entries(spec.floors))
        floors[name] = await readJson(resolve(base, rel));
      const procedures = spec.procedures
        ? await readJson<NonNullable<BuildInput['procedures']>>(resolve(base, spec.procedures))
        : undefined;
      try {
        const { procedures: _p, ...specRest } = spec;
        const { files, manifest } = buildPackFiles({
          ...specRest,
          floors,
          ...(procedures ? { procedures } : {}),
        });
        const seedEnv = arg('--seed-env', rest);
        const seedHex = seedEnv ? process.env[seedEnv] : undefined;
        let final = manifest;
        if (seedHex) {
          const keyId = arg('--key-id', rest);
          if (!keyId) throw new Error('--key-id is required when signing');
          final = signManifest(manifest, fromHex(seedHex), keyId);
        } else
          console.warn(
            'WARNING: pack is UNSIGNED; devices reject unsigned packs unless an engineering override is set.',
          );
        await writeBytes(out, packZip(files, final));
        console.log(
          `wrote ${out} (${manifest.venue_slug}@${manifest.version}${final.signature ? `, signed by ${final.signature.key_id}` : ''})`,
        );
        return 0;
      } catch (e) {
        if (e instanceof PackGateError) {
          console.error(e.message);
          for (const f of e.failures) console.error(JSON.stringify(f, null, 2));
          return 1;
        }
        throw e;
      }
    }
    if (sub === 'verify') {
      const file = rest[0];
      if (!file) throw new Error('missing <pack.zip>');
      const bytes = new Uint8Array(await readFile(file));
      try {
        const v = verifyPack(bytes, {
          pinnedKeys: PINNED_PACK_SIGNING_KEYS,
          installedVersion: arg('--installed', rest) ?? null,
          allowUnsigned: rest.includes('--allow-unsigned'),
        });
        console.log(
          `OK ${v.manifest.venue_slug}@${v.manifest.version} — ${v.manifest.provenance.validation}`,
        );
        for (const c of v.checks) console.log(`  ✓ ${c}`);
        return 0;
      } catch (e) {
        if (e instanceof PackVerifyError) {
          console.error(`REJECTED at ${e.stage}: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }
    if (sub === 'inspect') {
      const file = rest[0];
      if (!file) throw new Error('missing <pack.zip>');
      const { readZip, str } = await import('@terranova/core/pack');
      const files = readZip(new Uint8Array(await readFile(file)));
      console.log(str(files['manifest.json'] ?? new Uint8Array()));
      console.log(`files: ${Object.keys(files).sort().join(', ')}`);
      return 0;
    }
  }
  console.error(`unknown command: ${argv.join(' ')}\n`);
  console.log(HELP);
  return 2;
}

const STADIUM_PROCEDURES = {
  documents: [
    {
      id: 'proc-evac',
      title: 'Concourse evacuation',
      kind: 'procedure',
      body: 'Open all gates. Direct crowds along the concourse to the nearest clear exit shown on the console. Hold stairwells for responders when an incident is on an upper level. Report counts at the assembly point.',
    },
    {
      id: 'proc-medical',
      title: 'Medical response',
      kind: 'procedure',
      body: 'Dispatch the nearest responder with the AED highlighted on the map. Keep the route clear. Hand off to EMS at the nearest gate.',
    },
    {
      id: 'proc-lockdown',
      title: 'Lockdown',
      kind: 'procedure',
      body: 'Secure doors to concourse rooms. Occupants shelter in the nearest lockable room. Operators track check-ins by location and issue the all-clear only on law-enforcement confirmation.',
    },
    {
      id: 'proc-comms',
      title: 'Communications loss',
      kind: 'procedure',
      body: 'When network and telephony are unavailable the console keeps routing and logging from installed data. Alerts and acknowledgements queue on each device and flush when a link returns. Runners report to the command post on the half hour.',
    },
  ],
};
const HOSPITAL_PROCEDURES = {
  documents: [
    {
      id: 'proc-horizontal',
      title: 'Horizontal evacuation',
      kind: 'procedure',
      body: 'On alarm, move patients nearest the fire through the smoke barrier into the adjacent compartment. Non-ambulatory patients first. Close barrier doors. Defend in place; vertical evacuation only on incident-commander order.',
    },
    {
      id: 'proc-power',
      title: 'Utility and power loss',
      kind: 'procedure',
      body: 'Confirm generator transfer within ten seconds. Verify red outlets in critical care. Move ventilated patients to circuits on emergency power.',
    },
    {
      id: 'proc-comms',
      title: 'Communications loss',
      kind: 'procedure',
      body: 'Revert to runner-based reporting on the half hour. The console continues to route and log from installed data; queued alerts flush when a link returns.',
    },
  ],
};

const isMain = process.argv[1] && /main\.(js|ts)$/.test(process.argv[1]);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
