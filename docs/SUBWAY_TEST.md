# The subway test

A subway is the one place where everybody already understands that the signal dies. If GrahmOS
works there, the claim needs no explanation. This is the acceptance test for "the network keeps
functioning with no internet", in two stages: simulation first, then a real line.

## Stage 1 — simulation harness (CI)

Model: a line of N stations, trains running both directions on a timetable, phones boarding and
alighting with a passenger model, no cellular between stations, optional Wi-Fi at some stations.
Based on the SubwayMeshDTN study (New York subway graph, Epidemic and MaxProp routers).

Inputs: TerraNova signed envelopes wrapped as RFC 9171 bundles with a lifetime. Transports:
BLE (range 10–30 m, 7 hops), Wi-Fi Aware (range 50 m, bulk), station relay (Tier 2) where present.

Pass criteria for an alert declared on a train between stations A and B:

| Metric                                                                       | Threshold                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------ |
| Delivery to every phone on the same train                                    | 100% within 60 s                           |
| Delivery to the next station's relay                                         | on the train's arrival                     |
| Delivery to a phone on a train travelling the opposite direction that passes | ≥ 80%                                      |
| Delivery to a phone boarding at station B five minutes later                 | ≥ 95% within 10 min (custody at the relay) |
| Duplicate delivery                                                           | 0 (envelope id dedupe)                     |
| Forged or tampered bundle accepted                                           | 0                                          |

## Stage 2 — field day

Line: one real line, two stations with a tunnel section where cellular measurably drops (use the
MobiCom 2026 subway measurement to pick it). Devices: 6–10 phones, mixed iOS and Android, one
Raspberry-Pi relay at each station, optionally one LoRa bridge per platform.

Script:

1. Provision every phone online at the depot (pack installed, keys pinned, readiness READY).
2. Airplane mode on all phones; Bluetooth and Wi-Fi Aware on.
3. Phone A declares a fire incident and broadcasts the evacuation alert mid-tunnel.
4. Every phone in the car shows the alert takeover within 60 s and acknowledges.
5. At the next station the relay receives custody; a phone that boards there receives the alert.
6. A phone on the opposite train receives it on the pass, when the trains overlap in a station.
7. Phone B checks in "needs help"; the check-in reaches Phone A before the train leaves.
8. Every phone exports its evidence package; chains verify; the relay log shows one copy of each
   bundle with its custody timestamps.

Evidence: the evidence packages, the relay logs, a video of the alert takeovers, and the timetable.
Publish all of it. A claim is only "mesh-tested on line X between stations A and B".

## What this test is not

It is not a claim that GrahmOS replaces cellular service, that it works on a brand-new phone with
no provisioning, or that any routing protocol is optimal. It is a repeatable demonstration that an
emergency message crosses a signal gap on ordinary phones with no infrastructure.
