import type { Envelope } from './envelope.js';
import { verifyEnvelope, type DeviceKeyStore, type EnvelopeVerdict } from './envelope.js';
import type { PullResult, PostResult } from './protocol.js';

/** Persistence port for the relay's append-only log. */
export interface RelayLogStore {
  /** All stored rows in cursor order. */
  all(): Promise<Array<{ cursor: number; env: Envelope }>>;
  append(cursor: number, env: Envelope): Promise<void>;
}

export class MemoryRelayLogStore implements RelayLogStore {
  rows: Array<{ cursor: number; env: Envelope }> = [];
  async all(): Promise<Array<{ cursor: number; env: Envelope }>> {
    return [...this.rows];
  }
  async append(cursor: number, env: Envelope): Promise<void> {
    this.rows.push({ cursor, env });
  }
}

/**
 * The relay's core, independent of HTTP: verify, deduplicate, assign a cursor, serve catch-up.
 * The same class runs inside the Node relay and inside tests.
 */
export class RelayCore {
  private cursor = 0;
  private ids = new Set<string>();
  private rows: Array<{ cursor: number; env: Envelope }> = [];
  private loaded = false;

  constructor(
    readonly relayId: string,
    private readonly log: RelayLogStore,
    private readonly keys: DeviceKeyStore,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.rows = await this.log.all();
    for (const r of this.rows) {
      this.ids.add(r.env.id);
      this.cursor = Math.max(this.cursor, r.cursor);
    }
    this.loaded = true;
  }

  get head(): number {
    return this.cursor;
  }
  get count(): number {
    return this.rows.length;
  }

  async accept(env: Envelope): Promise<{ status: 'accepted' | 'duplicate'; result: PostResult } | { status: 'rejected'; verdict: Extract<EnvelopeVerdict, { ok: false }> }> {
    await this.load();
    if (this.ids.has(env.id)) return { status: 'duplicate', result: { cursor: this.cursor, duplicate: true } };
    const verdict = await verifyEnvelope(env, this.keys);
    if (!verdict.ok) return { status: 'rejected', verdict };
    this.cursor += 1;
    this.ids.add(env.id);
    this.rows.push({ cursor: this.cursor, env });
    await this.log.append(this.cursor, env);
    return { status: 'accepted', result: { cursor: this.cursor } };
  }

  async pull(venueSlug: string | null, since: number, limit = 200): Promise<PullResult> {
    await this.load();
    const out: Envelope[] = [];
    let cursor = since;
    for (const r of this.rows) {
      if (r.cursor <= since) continue;
      if (venueSlug && r.env.venueSlug !== venueSlug) {
        cursor = r.cursor;
        continue;
      }
      out.push(r.env);
      cursor = r.cursor;
      if (out.length >= limit) break;
    }
    return { cursor, envelopes: out };
  }
}
