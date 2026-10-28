import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export type PackFiles = Record<string, Uint8Array>;

export function readZip(bytes: Uint8Array): PackFiles {
  const out: PackFiles = {};
  const entries = unzipSync(bytes);
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    out[name] = data;
  }
  return out;
}

export function writeZip(files: PackFiles): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const name of Object.keys(files).sort()) {
    const data = files[name]!;
    entries[name] = [data, { level: name.endsWith('.pmtiles') ? 0 : 6 }];
  }
  return zipSync(entries, { mtime: new Date('2000-01-01T00:00:00Z') });
}

export const u8 = (s: string): Uint8Array => strToU8(s);
export const str = (b: Uint8Array): string => strFromU8(b);
