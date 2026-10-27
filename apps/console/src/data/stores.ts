import type {
  EventLogStore,
  IncidentEvent,
  OutboxEnvelope,
  OutboxStore,
  Sealed,
} from '@terranova/core';
import type { TerraNovaDB } from './db';

export class DexieEventLogStore implements EventLogStore {
  constructor(private readonly d: TerraNovaDB) {}
  async all(): Promise<Array<Sealed<IncidentEvent>>> {
    return (await this.d.events.orderBy('n').toArray()).map((r) => r.link);
  }
  async append(link: Sealed<IncidentEvent>): Promise<void> {
    await this.d.events.add({ eventId: link.entry.id, link });
  }
}

export class DexieOutboxStore implements OutboxStore {
  constructor(private readonly d: TerraNovaDB) {}
  async all(): Promise<OutboxEnvelope[]> {
    return this.d.outbox.toArray();
  }
  async put(env: OutboxEnvelope): Promise<void> {
    await this.d.outbox.put(env);
  }
  async delete(id: string): Promise<void> {
    await this.d.outbox.delete(id);
  }
}
