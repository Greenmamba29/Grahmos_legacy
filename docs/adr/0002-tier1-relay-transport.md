# ADR 0002 — Tier-1 transport: signed envelopes over a facility relay

**Status:** accepted · **Date:** 2026-10-27 · **Reviewers:** V1 Technical DRI, Security/Trust Lead, Edge/Replication Lead (roles per AGENTS.md)

## Context

GrahmOS's V2a acceptance test reads: _Device A declares an incident, an isolated local relay
delivers it to Device B, B acknowledges, and A receives the receipt while WAN and Supabase remain
blocked; all devices restart and reconstruct the same state._ The reference repo documented this
and left it unimplemented. TerraNova's event log and outbox were designed as the seams for it.

## Decision

1. **Unit of exchange: a signed envelope.** `{id, venueSlug, deviceId, publicKey, sealedAt, event}`
   signed Ed25519 by the device key; `id` is the SHA-256 of the canonical event, so the same event
   deduplicates on every path. The relay and every receiver verify before storing or folding.
2. **Transport: plain JSON over HTTP to a relay on the LAN**, not WebRTC/CRDT. A phone hotspot,
   a laptop, or a facility box can host `node:http`; the console already speaks `fetch`; the
   security boundary is the signature, not the channel. WebRTC remains an option for peer-only
   rooms with no host, as a later ADR.
3. **Store-and-forward with a cursor.** The relay appends accepted envelopes to a JSONL log and
   assigns a monotonically increasing cursor. Devices pull `since=<cursor>` per venue; a dropped
   message is a visible gap the next pull fills. Receipts are the relay cursor returned on POST
   (delivery to the relay) and the acknowledging device's own `alert.acknowledged` event (delivery
   to a person).
4. **Key policy: pin on first sight per device.** Blocks impersonation of a device already seen.
   It does not prove who enrolled the device; facility enrollment (authority-signed device keys)
   is Tier 2 and the console says "self-attested" until then.
5. **No CRDT.** Incident state is a deterministic projection over the union of event logs
   (ordering: wall clock, per-device seq, id). Convergence follows from set union; conflicts are
   impossible by construction because no event overwrites another.

## Consequences

- `core/relay` (envelope, core, client) is pure; `packages/relay` is a 150-line Node server; the
  console gains a transport and a pull loop and no projection code changes.
- The V2a acceptance test runs in Node on every CI run (`core/relay/relay.test.ts` in-process,
  `packages/relay/src/server.test.ts` over a real socket with a file log).
- Tier 0 is untouched: with no relay configured, nothing in the console waits on one.
