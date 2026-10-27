import { appendFile, readFile } from 'node:fs/promises';
import type { Envelope, RelayLogStore } from '@terranova/core';

/** Append-only JSONL log on disk: one `{cursor, env}` per line. Survives relay restarts. */
export class FileRelayLogStore implements RelayLogStore {
  constructor(private readonly path: string) {}
  async all(): Promise<Array<{ cursor: number; env: Envelope }>> {
    try {
      const text = await readFile(this.path, 'utf8');
      return text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as { cursor: number; env: Envelope });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  async append(cursor: number, env: Envelope): Promise<void> {
    await appendFile(this.path, `${JSON.stringify({ cursor, env })}\n`);
  }
}
