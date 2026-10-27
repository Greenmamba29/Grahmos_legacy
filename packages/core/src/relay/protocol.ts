/**
 * Relay protocol v1 — plain JSON over HTTP so a facility box, a laptop, or a phone hotspot can host
 * it with no WAN. Store-and-forward with a monotonically increasing cursor per relay.
 *
 *   POST /v1/envelopes            body: Envelope            → 202 {cursor} | 409 duplicate {cursor} | 400/422 rejected
 *   GET  /v1/envelopes?venue=<slug>&since=<cursor>&limit=<n> → 200 {cursor, envelopes: Envelope[]}
 *   GET  /v1/health               → 200 {ok, relayId, cursor, count, packs}
 *   POST /v1/packs                body: pack zip bytes  → 201 {slug, version} | 409 duplicate | 422 rejected {stage, reason}
 *   GET  /v1/packs                → 200 RegistryListing[]
 *   GET  /v1/packs/<slug>         → 200 application/zip (latest published version)
 */
import type { Envelope } from './envelope.js';

export interface PostResult {
  cursor: number;
  duplicate?: boolean;
}
export interface PullResult {
  cursor: number;
  envelopes: Envelope[];
}
export interface RelayHealth {
  ok: true;
  relayId: string;
  cursor: number;
  count: number;
  packs?: number;
}

export const RELAY_PATHS = {
  envelopes: '/v1/envelopes',
  health: '/v1/health',
  packs: '/v1/packs',
} as const;
