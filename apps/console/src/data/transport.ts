import type { DeliveryOutcome, OutboxEnvelope, Transport } from '@terranova/core';

/**
 * Uplink for the outbox. Tier 0 ships with NO uplink configured: the queue is still durable and
 * inspectable, and everything on the device keeps working. Set VITE_SYNC_URL to point the console at
 * a relay/cloud endpoint that accepts `POST {envelope}` and answers 2xx / 4xx / 5xx.
 */
export const SYNC_URL: string | null = import.meta.env.VITE_SYNC_URL || null;

export class HttpTransport implements Transport {
  readonly name: string;
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 8000,
  ) {
    this.name = `http:${new URL(url, location.href).host}`;
  }
  async send(env: OutboxEnvelope): Promise<DeliveryOutcome> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(env),
        signal: ctl.signal,
      });
      if (res.ok) {
        const receipt = res.headers.get('x-receipt');
        return receipt ? { status: 'delivered', receipt } : { status: 'delivered' };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
        return { status: 'rejected', reason: `HTTP ${res.status}` };
      return { status: 'retry', reason: `HTTP ${res.status}` };
    } catch (e) {
      return { status: 'retry', reason: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(t);
    }
  }
}

export function configuredTransport(): Transport | null {
  return SYNC_URL ? new HttpTransport(SYNC_URL) : null;
}
