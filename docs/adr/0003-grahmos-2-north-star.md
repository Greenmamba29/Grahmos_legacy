# ADR 0003 — GrahmOS 2.0 north star: the operating layer for when the world is off

**Status:** proposed · **Date:** 2026-10-27

## Context

GrahmOS began as an emergency console. The 2.0 ambition is larger: an operating layer people
reach for the way they reach for Grandma's house, where everything they need is already there and
works without asking anyone's permission or signal. Concretely:

- the internet turned into a **searchable directory** that can be carried and installed;
- the network kept **functional with no internet**, phone to phone, through mesh and
  delay-tolerant delivery;
- proven in a **subway**, where everyone already knows the signal dies.

## Decision

1. **"OS" means an installable, offline-first runtime, not a kernel.** GrahmOS 2.0 ships as a
   PWA plus native agents (BLE, Wi-Fi Aware, LoRa bridge) and an edge appliance, on top of the
   operating systems people already have. A hardware or kernel project is out of scope until the
   runtime is adopted.
2. **Four tiers, degrading downward, as before.** Tier 0 device; Tier 1 phone mesh (BLE + Wi-Fi
   Aware); Tier 2 facility edge (relay, pack and ZIM registry, LoRa bridge); Tier 3 internet.
   Losing a tier never removes a life-safety capability.
3. **Three protocols are load-bearing and open:** TerraNova signed envelopes for authorship,
   RFC 9171 bundles for store-carry-forward across gaps, and signed packs (venues, maps, ZIM
   content) for installable truth.
4. **The directory is a catalogue of packs.** Content (ZIM), maps (PMTiles), venue floors, and
   procedure sets are packs with provenance; search is local on device and on the edge.
5. **The subway is the acceptance test.** Nothing claims "works without internet" until the
   drill in `docs/SUBWAY_TEST.md` passes on real phones on a real line, with the simulation
   harness passing first.

## Consequences

- Dependencies are chosen from `docs/OSS_LANDSCAPE.md` by verdict; GPL/AGPL code runs as
  sidecars or on the edge, never in the device bundle.
- The next engineering slices are: a BPv7 bundle layer over the existing envelopes; a BLE
  transport on the bitchat wire format behind a native agent; Wi-Fi Aware bulk transfer; a ZIM
  registry on the relay with Tantivy search; the subway simulation harness.
- Claim boundaries in `docs/CLAIMS.md` gain: "mesh-tested on line X between stations A and B" is
  the only form a mesh claim may take.
