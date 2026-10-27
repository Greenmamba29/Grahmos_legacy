import type { IncidentEvent } from './types.js';
import {
  sealEntry,
  verifyChain,
  headHash,
  type Sealed,
  type ChainVerification,
} from './auditChain.js';

/** Persistence port for the sealed event log. Append-only. */
export interface EventLogStore {
  all(): Promise<Array<Sealed<IncidentEvent>>>;
  append(link: Sealed<IncidentEvent>): Promise<void>;
}

export class MemoryEventLogStore implements EventLogStore {
  private links: Array<Sealed<IncidentEvent>> = [];
  async all(): Promise<Array<Sealed<IncidentEvent>>> {
    return [...this.links];
  }
  async append(link: Sealed<IncidentEvent>): Promise<void> {
    this.links.push(link);
  }
}

/**
 * Hash-chained local event log. Local truth for incidents: append first, then enqueue for
 * transport. Also ingests remote events (from sync or a peer) by sealing them onto the local chain,
 * so the chain always describes exactly what THIS device has seen, in the order it saw it.
 */
export class EventLog {
  private head: string | null = null;
  private ids = new Set<string>();

  constructor(private readonly store: EventLogStore) {}

  async load(): Promise<Array<Sealed<IncidentEvent>>> {
    const links = await this.store.all();
    this.head = headHash(links);
    this.ids = new Set(links.map((l) => l.entry.id));
    return links;
  }

  has(eventId: string): boolean {
    return this.ids.has(eventId);
  }

  /** Append an event. Duplicate event ids are ignored (returns null). */
  async append(ev: IncidentEvent): Promise<Sealed<IncidentEvent> | null> {
    if (this.head === null) await this.load();
    if (this.ids.has(ev.id)) return null;
    const link = sealEntry(ev, this.head ?? '');
    await this.store.append(link);
    this.head = link.hash;
    this.ids.add(ev.id);
    return link;
  }

  async events(): Promise<IncidentEvent[]> {
    return (await this.store.all()).map((l) => l.entry);
  }

  async verify(): Promise<ChainVerification> {
    return verifyChain(await this.store.all());
  }

  get headHash(): string | null {
    return this.head;
  }
}
