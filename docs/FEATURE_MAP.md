# Feature map — GrahmOS → TerraNova

Rebuild order follows the GrahmOS north star: ship Tier 0, then trust hardening, then the mesh and
edge tiers. A row is "done" only when its tests and gates exist here.

| #   | GrahmOS feature                                                                                                                         | TerraNova status | Notes                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| 1   | Offline-first resilience (readiness contract, fuzzy connectivity, PWA shell, persistent storage)                                        | **done**         | `core/readiness`, `core/connectivity`, console runtime + service worker, offline drill |
| 1   | Emergency communications (incidents, alerts, acks, check-ins, durable outbox, local evidence)                                           | **done**         | event-sourced + hash-chained; uplink via `VITE_SYNC_URL`                               |
| 1   | SafetyMap (floor contract, routing profiles, hazard avoidance, exit board, egress legs, smoke compartments, playbooks, venue packs)     | **done**         | SVG metre-space renderer; signed pack v3                                               |
| 2   | Trust hardening: signed checkpoints over the event chain, key rotation runbook, authority approval record in packs                      | next             | `provenance` field already carried                                                     |
| 3   | Importers: DXF / IFC / OSM → floor contract                                                                                             | planned          | contract + gate in place; importers port next                                          |
| 4   | Local search: MiniSearch over procedures, directory and skill content; honest local-model fallback states                               | planned          | `procedures.json` already ships in packs                                               |
| 5   | Geo basemap: MapLibre + PMTiles under the floor renderer; WGS84 POI overlay                                                             | planned          | pack format reserves `basemap.pmtiles`, `pois.geojson`                                 |
| 6   | Positioning: checkpoint / qualified GNSS hybrid with visible confidence                                                                 | planned          | origin is operator-set today                                                           |
| 7   | Tier 1 device mesh: signed envelopes, LAN relay, replay, receipts (V2a acceptance: A declares, B acks, A receives receipt, WAN blocked) | planned          | `Transport` + `ingestRemote` are the seams                                             |
| 8   | Tier 2 facility edge: store-and-forward relay, pack registry, optional ingestion sidecar                                                | planned          |                                                                                        |
| 9   | Resilience audit (NFPA travel-distance proxy, redundancy, bridges) and CMS evidence report                                              | planned          | `distancesFromAny` exists for it                                                       |
| 10  | Localisation (es, ar) of safety strings                                                                                                 | planned          |                                                                                        |

## GrahmOS 2.0 — next slices (from docs/OSS_LANDSCAPE.md and ADR 0003)

| #   | Slice                                                                         | Depends on           | Status  |
| --- | ----------------------------------------------------------------------------- | -------------------- | ------- |
| 12  | RFC 9171 bundle layer over signed envelopes (custody, lifetime, dedupe)       | dtn7-rs on the relay | planned |
| 13  | BLE transport on the bitchat wire format, in a native agent (iOS/Android)     | bitchat protocol     | planned |
| 14  | Wi-Fi Aware bulk transfer for packs and tiles (iOS 26 / Android)              | platform APIs        | planned |
| 15  | ZIM registry on the relay with Tantivy search; device search over ZIM indexes | Kiwix/libzim         | planned |
| 16  | Subway simulation harness (SubwayMeshDTN model) as a CI gate                  | —                    | planned |
| 17  | Field day on one line, two stations (docs/SUBWAY_TEST.md)                     | 12–16                | planned |
