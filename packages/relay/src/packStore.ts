import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackRegistryStore, RegistryEntry } from '@terranova/core';

/** Packs on disk: `<dir>/<slug>.zip` plus `<dir>/<slug>.json` metadata. Survives relay restarts. */
export class FilePackRegistryStore implements PackRegistryStore {
  constructor(private readonly dir: string) {}
  async all(): Promise<RegistryEntry[]> {
    await mkdir(this.dir, { recursive: true });
    const out: RegistryEntry[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const meta = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as Omit<
        RegistryEntry,
        'bytes'
      >;
      const bytes = new Uint8Array(await readFile(join(this.dir, `${meta.slug}.zip`)));
      out.push({ ...meta, bytes });
    }
    return out;
  }
  async put(e: RegistryEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const { bytes, ...meta } = e;
    await writeFile(join(this.dir, `${e.slug}.zip`), bytes);
    await writeFile(join(this.dir, `${e.slug}.json`), JSON.stringify(meta, null, 2));
  }
}
