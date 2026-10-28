import { hashValue } from '../crypto/sha256.js';

/**
 * Durable outbox — the device's single queue of writes that have not yet been accepted elsewhere.
 *
 * Writes land here FIRST (after the local log) and are flushed in order by whatever transport is
 * present. Pending count, last error, and "sync now" all read from this one place, so the operator
 * can inspect exactly what has not left the device. Storage and transport are ports: the console
 * backs them with IndexedDB and HTTP, tests with memory.
 */
export interface OutboxEnvelope<P = unknown> {
  id: string;
  kind: string;
  createdAt: string;
  payload: P;
  /** SHA-256 of canonical payload — a receipt names exactly these bytes. */
  payloadHash: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  /** Earliest time the next attempt may run (backoff). */
  notBefore?: string;
}

export interface OutboxStore {
  all(): Promise<OutboxEnvelope[]>;
  put(env: OutboxEnvelope): Promise<void>;
  delete(id: string): Promise<void>;
}

export type DeliveryOutcome =
  | { status: 'delivered'; receipt?: string }
  | { status: 'rejected'; reason: string }
  | { status: 'retry'; reason: string };

export interface Transport {
  readonly name: string;
  send(env: OutboxEnvelope): Promise<DeliveryOutcome>;
}

export interface FlushReport {
  transport: string;
  delivered: string[];
  rejected: Array<{ id: string; reason: string }>;
  retried: Array<{ id: string; reason: string }>;
  skipped: number;
  /** True when the flush stopped early to preserve ordering. */
  haltedOnRetry: boolean;
}

export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxEnvelope>();
  async all(): Promise<OutboxEnvelope[]> {
    return [...this.items.values()];
  }
  async put(env: OutboxEnvelope): Promise<void> {
    this.items.set(env.id, env);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export const BACKOFF = { BASE_MS: 2000, MAX_MS: 5 * 60_000 } as const;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF.MAX_MS, BACKOFF.BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export interface OutboxOptions {
  now?: () => Date;
  /** Max consecutive attempts before an envelope is parked as rejected. */
  maxAttempts?: number;
}

/** Deterministic queue ordering: creation time then id. */
export function orderEnvelopes(envs: OutboxEnvelope[]): OutboxEnvelope[] {
  return [...envs].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

export class Outbox {
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private flushing = false;

  constructor(
    private readonly store: OutboxStore,
    opts: OutboxOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.maxAttempts = opts.maxAttempts ?? 12;
  }

  async enqueue<P>(id: string, kind: string, payload: P): Promise<OutboxEnvelope<P>> {
    const env: OutboxEnvelope<P> = {
      id,
      kind,
      createdAt: this.now().toISOString(),
      payload,
      payloadHash: hashValue(payload),
      attempts: 0,
    };
    await this.store.put(env as OutboxEnvelope);
    return env;
  }

  async pending(): Promise<OutboxEnvelope[]> {
    return orderEnvelopes(await this.store.all());
  }

  async pendingCount(): Promise<number> {
    return (await this.store.all()).length;
  }

  /**
   * Flush in order. A `retry` outcome halts the flush (later writes may depend on earlier ones:
   * an offline declare→resolve pair must apply INSERT before UPDATE). A `rejected` outcome removes
   * the envelope and is reported — a permanently invalid write must not block the queue forever,
   * but it must be visible.
   */
  async flush(transport: Transport): Promise<FlushReport> {
    const report: FlushReport = {
      transport: transport.name,
      delivered: [],
      rejected: [],
      retried: [],
      skipped: 0,
      haltedOnRetry: false,
    };
    if (this.flushing) return report;
    this.flushing = true;
    try {
      const nowIso = this.now().toISOString();
      for (const env of await this.pending()) {
        if (env.notBefore && env.notBefore > nowIso) {
          report.skipped += 1;
          continue;
        }
        let outcome: DeliveryOutcome;
        try {
          outcome = await transport.send(env);
        } catch (e) {
          outcome = { status: 'retry', reason: e instanceof Error ? e.message : String(e) };
        }
        const attempts = env.attempts + 1;
        if (outcome.status === 'delivered') {
          await this.store.delete(env.id);
          report.delivered.push(env.id);
          continue;
        }
        if (outcome.status === 'rejected' || attempts >= this.maxAttempts) {
          await this.store.delete(env.id);
          const reason =
            outcome.status === 'rejected'
              ? outcome.reason
              : `gave up after ${attempts} attempts: ${outcome.reason}`;
          report.rejected.push({ id: env.id, reason });
          continue;
        }
        const notBefore = new Date(this.now().getTime() + backoffMs(attempts)).toISOString();
        await this.store.put({
          ...env,
          attempts,
          lastAttemptAt: nowIso,
          lastError: outcome.reason,
          notBefore,
        });
        report.retried.push({ id: env.id, reason: outcome.reason });
        report.haltedOnRetry = true;
        break;
      }
      return report;
    } finally {
      this.flushing = false;
    }
  }
}
