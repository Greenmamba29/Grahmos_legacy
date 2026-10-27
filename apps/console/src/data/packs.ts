import {
  PINNED_PACK_SIGNING_KEYS,
  PackVerifyError,
  readZip,
  str,
  verifyPack,
  type VerifiedPack,
} from '@terranova/core';
import { getSetting, setSetting, type TerraNovaDB } from './db';

export const BUNDLED_PACKS = [
  {
    slug: 'city-center-stadium',
    label: 'City Center Stadium (fixture)',
    url: 'packs/city-center-stadium.zip',
  },
  {
    slug: 'harbor-general-hospital',
    label: 'Harbor General — Wing 3 (fixture)',
    url: 'packs/harbor-general-hospital.zip',
  },
] as const;

export const ALLOW_UNSIGNED = import.meta.env.VITE_ALLOW_UNSIGNED_PACKS === 'true';

export interface InstalledPack {
  pack: VerifiedPack;
  source: 'bundled' | 'file' | 'url';
  installedAt: string;
  fromCache: boolean;
}

export type PackFailure = {
  stage: PackVerifyError['stage'] | 'fetch' | 'storage';
  message: string;
};

/** Verify bytes against pinned keys + anti-rollback, then persist them as the installed pack. */
export async function installPackBytes(
  d: TerraNovaDB,
  bytes: Uint8Array,
  source: InstalledPack['source'],
): Promise<InstalledPack> {
  const slugGuess = (() => {
    try {
      const m = JSON.parse(str(readZip(bytes)['manifest.json'] ?? new Uint8Array())) as {
        venue_slug?: string;
      };
      return m.venue_slug ?? null;
    } catch {
      return null;
    }
  })();
  const installedVersion = slugGuess ? ((await d.packs.get(slugGuess))?.version ?? null) : null;
  const pack = verifyPack(bytes, {
    pinnedKeys: PINNED_PACK_SIGNING_KEYS,
    installedVersion,
    allowUnsigned: ALLOW_UNSIGNED,
  });
  const installedAt = new Date().toISOString();
  await d.packs.put({
    slug: pack.manifest.venue_slug,
    version: pack.manifest.version,
    bytes,
    installedAt,
    source,
  });
  await setSetting('activePack', pack.manifest.venue_slug, d);
  return { pack, source, installedAt, fromCache: false };
}

/** Open the active pack from local storage without the network. */
export async function openInstalledPack(d: TerraNovaDB): Promise<InstalledPack | null> {
  const slug = await getSetting<string | null>('activePack', null, d);
  if (!slug) return null;
  const row = await d.packs.get(slug);
  if (!row) return null;
  // Re-verify on every open: bytes in IndexedDB are not more trustworthy than bytes on the wire.
  const pack = verifyPack(row.bytes, {
    pinnedKeys: PINNED_PACK_SIGNING_KEYS,
    installedVersion: null,
    allowUnsigned: ALLOW_UNSIGNED,
  });
  return { pack, source: row.source, installedAt: row.installedAt, fromCache: true };
}

export async function fetchAndInstall(
  d: TerraNovaDB,
  url: string,
  source: InstalledPack['source'] = 'bundled',
): Promise<InstalledPack> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new PackVerifyError('format', `fetch ${url} → HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return installPackBytes(d, bytes, source);
}

export function describeFailure(e: unknown): PackFailure {
  if (e instanceof PackVerifyError) return { stage: e.stage, message: e.message };
  if (e instanceof TypeError)
    return { stage: 'fetch', message: `network unavailable: ${e.message}` };
  return { stage: 'storage', message: e instanceof Error ? e.message : String(e) };
}
