# ADR 0001 — TerraNova rebuild architecture

**Status:** accepted · **Date:** 2026-10-27

## Context

GrahmOS TerraNova (`Grahmos_terranova`) is a working Tier-0 product whose domain logic grew inside
a React app: routing, pack verification, sync and incident state are entangled with Dexie,
Supabase, MapLibre and component code. Every hardening pass had to be re-proven in a browser.
The rebuild exists to keep the product claims and lose the entanglement.

## Decision

1. **Three layers, one direction of dependency.** `packages/core` is pure TypeScript with no DOM,
   storage, or network; it declares ports (`EventLogStore`, `OutboxStore`, `Transport`).
   `packages/cli` and `apps/console` supply adapters. Core is tested in Node in milliseconds.
2. **Incident state is a projection of an event log.** Events (`incident.declared`, `alert.broadcast`,
   `alert.acknowledged`, `checkin`, …) are sealed into a SHA-256 hash chain in the order the device
   saw them. Projection is deterministic (`at`, then per-device `seq`, then id), so two devices that
   exchange events converge. This replaces row-level vector clocks with something simpler to
   reason about and already shaped for the later relay/peer transport.
3. **One canonicaliser, one hash, one signature backend.** RFC 8785-style canonical JSON,
   `@noble/hashes` SHA-256 and `@noble/ed25519` run identically on a laptop, in a browser on a
   plain-http facility LAN (no `crypto.subtle`), and in CI.
4. **Pack v3.** `manifest.json` hashes every file; the Ed25519 signature covers
   `{venue_slug, version, hashes}`; public keys are pinned in the app; installs refuse rollback;
   builds are byte-deterministic so the shipped fixture can be gated against a rebuild.
5. **Metre-space SVG floor renderer first.** The floor contract is in venue metres. Rendering it
   directly needs no tiles and is exactly as available as the pack. A georeferenced MapLibre +
   PMTiles basemap is a later feature layered underneath, not a prerequisite.
6. **Claims are gated.** `scripts/gates.mjs` fails on a third-party runtime host in the console,
   on credentials in the tree, on a bundled pack that is not labelled a fixture, on a pack that
   does not verify, and on a stale fixture. `scripts/e2e-offline.mjs` proves the offline claim by
   killing the origin and reloading.

## Consequences

- New features land as core modules with tests before any UI.
- Transport (relay, mesh) becomes an adapter of `Transport` plus `CommsService.ingestRemote`;
  no projection code changes.
- Performance work (a routing worker) is an adapter concern; the planner API is already
  synchronous and pure.
