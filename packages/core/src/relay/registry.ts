/**
 * Tier-2 pack registry — the facility edge's second job after store-and-forward: hold the venue's
 * signed packs so a device can (re)install with no WAN.
 *
 * The registry VERIFIES on publish exactly as a device verifies on install (pinned keys, hashes,
 * anti-rollback per venue), so it can never hand out a pack a device would refuse. Devices still
 * re-verify on install: the registry is a convenience, not a trust root.
 */
import { verifyPack, type VerifiedPack } from '../pack/verify.js';
import type { PackManifest } from '../pack/manifest.js';
import { PINNED_PACK_SIGNING_KEYS } from '../pack/keys.js';
import { isRollback } from '../pack/manifest.js';

export interface RegistryEntry {
  slug: string;
  version: string;
  manifest: PackManifest;
  bytes: Uint8Array;
  publishedAt: string;
  signedBy: string | null;
}
export interface RegistryListing {
  slug: string;
  version: string;
  venue_name: string;
  validation: PackManifest['provenance']['validation'];
  signedBy: string | null;
  publishedAt: string;
  bytes: number;
}

export interface PackRegistryStore {
  all(): Promise<RegistryEntry[]>;
  put(entry: RegistryEntry): Promise<void>;
}
export class MemoryPackRegistryStore implements PackRegistryStore {
  private m = new Map<string, RegistryEntry>();
  async all(): Promise<RegistryEntry[]> {
    return [...this.m.values()];
  }
  async put(e: RegistryEntry): Promise<void> {
    this.m.set(e.slug, e);
  }
}

export class PackRegistry {
  private entries = new Map<string, RegistryEntry>();
  private loaded = false;
  constructor(
    private readonly store: PackRegistryStore,
    private readonly pinnedKeys: Record<string, string> = PINNED_PACK_SIGNING_KEYS,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async load(): Promise<void> {
    if (this.loaded) return;
    for (const e of await this.store.all()) this.entries.set(e.slug, e);
    this.loaded = true;
  }
  async publish(
    bytes: Uint8Array,
  ): Promise<
    | { status: 'accepted' | 'duplicate'; entry: RegistryEntry }
    | { status: 'rejected'; stage: string; reason: string }
  > {
    await this.load();
    let v: VerifiedPack;
    try {
      // Pre-read the slug so anti-rollback compares against THIS venue's installed version.
      v = verifyPack(bytes, { pinnedKeys: this.pinnedKeys });
    } catch (e) {
      const err = e as { stage?: string; message: string };
      return { status: 'rejected', stage: err.stage ?? 'unknown', reason: err.message };
    }
    const slug = v.manifest.venue_slug;
    const current = this.entries.get(slug);
    if (current && current.version === v.manifest.version)
      return { status: 'duplicate', entry: current };
    if (current && isRollback(v.manifest.version, current.version))
      return {
        status: 'rejected',
        stage: 'rollback',
        reason: `pack ${v.manifest.version} is older than published ${current.version}`,
      };
    const entry: RegistryEntry = {
      slug,
      version: v.manifest.version,
      manifest: v.manifest,
      bytes,
      publishedAt: this.now().toISOString(),
      signedBy: v.signedBy,
    };
    this.entries.set(slug, entry);
    await this.store.put(entry);
    return { status: 'accepted', entry };
  }
  async list(): Promise<RegistryListing[]> {
    await this.load();
    return [...this.entries.values()]
      .map((e) => ({
        slug: e.slug,
        version: e.version,
        venue_name: e.manifest.venue_name,
        validation: e.manifest.provenance.validation,
        signedBy: e.signedBy,
        publishedAt: e.publishedAt,
        bytes: e.bytes.length,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }
  async get(slug: string): Promise<RegistryEntry | null> {
    await this.load();
    return this.entries.get(slug) ?? null;
  }
}
