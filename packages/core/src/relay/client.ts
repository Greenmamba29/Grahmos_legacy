import type { DeliveryOutcome, OutboxEnvelope, Transport } from '../comms/outbox.js';
import type { IncidentEvent } from '../comms/types.js';
import { sealEnvelope, verifyEnvelope, type DeviceKeyStore, type Envelope } from './envelope.js';
import { RELAY_PATHS, type PullResult } from './protocol.js';

export interface RelayClientOptions {
  baseUrl: string;
  venueSlug: string;
  deviceId: string;
  seed: Uint8Array;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Relay transport: seals each outbox event into a signed envelope and POSTs it; pulls envelopes
 * since a cursor and verifies them before handing them to the comms service. Pure fetch; the host
 * decides when to call `pull`.
 */
export class RelayClient implements Transport {
  readonly name: string;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly o: RelayClientOptions) {
    this.name = `relay:${o.baseUrl}`;
    // Bound to globalThis: an unbound `window.fetch` throws "Illegal invocation" in browsers.
    this.f = o.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = o.timeoutMs ?? 8000;
  }

  private async req(path: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.f(`${this.o.baseUrl}${path}`, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async send(env: OutboxEnvelope): Promise<DeliveryOutcome> {
    const event = env.payload as IncidentEvent;
    const sealed = sealEnvelope(event, this.o.venueSlug, this.o.deviceId, this.o.seed);
    try {
      const res = await this.req(RELAY_PATHS.envelopes, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sealed),
      });
      if (res.status === 202 || res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { cursor?: number };
        return { status: 'delivered', receipt: `${this.name}#${body.cursor ?? '?'}` };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string };
        return { status: 'rejected', reason: body.reason ?? `HTTP ${res.status}` };
      }
      return { status: 'retry', reason: `HTTP ${res.status}` };
    } catch (e) {
      return { status: 'retry', reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Pull and verify envelopes since `cursor`. Invalid envelopes are reported, never returned as events. */
  async pull(
    since: number,
    keys: DeviceKeyStore,
    limit = 200,
  ): Promise<{
    cursor: number;
    events: IncidentEvent[];
    rejected: Array<{ id: string; reason: string }>;
  }> {
    const res = await this.req(
      `${RELAY_PATHS.envelopes}?venue=${encodeURIComponent(this.o.venueSlug)}&since=${since}&limit=${limit}`,
      { method: 'GET' },
    );
    if (!res.ok) throw new Error(`relay pull HTTP ${res.status}`);
    const body = (await res.json()) as PullResult;
    const events: IncidentEvent[] = [];
    const rejected: Array<{ id: string; reason: string }> = [];
    for (const env of body.envelopes as Envelope[]) {
      if (env.deviceId === this.o.deviceId) continue; // our own echo
      const v = await verifyEnvelope(env, keys);
      if (v.ok) events.push(env.event);
      else rejected.push({ id: env.id, reason: v.reason });
    }
    return { cursor: body.cursor, events, rejected };
  }
}
