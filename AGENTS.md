# AGENTS.md — TerraNova

TerraNova is the clean, feature-by-feature rebuild of GrahmOS. The reference implementation lives
in `Greenmamba29/Grahmos_terranova`; this repository re-implements each feature with the same
product claims and sharper boundaries, and ships nothing it cannot prove.

## Operating rules (inherited from GrahmOS, enforced here)

1. **Tier 0 depends on nothing remote.** No cloud, public tile host, external AI, or edge node may
   sit on the life-safety path. `npm run gates` (offline gate) fails the build on a third-party
   runtime host in the console shell.
2. **Real offline behaviour over simulated success.** Every write confirms or shows failure.
   Missing capability is shown as missing, never mocked.
3. **A hash-verified pack is not a signed pack; a signed pack is not a validated venue.** Packs
   carry `provenance.validation` (`fixture` | `public-data` | `authority-approved`) and the console
   labels it. Bundled packs are fixtures and the gates refuse anything else.
4. **Core is pure.** `packages/core` has no DOM, no IndexedDB, no fetch. Browser concerns live in
   `apps/console`; Node concerns in `packages/cli`. A module that needs a port declares an
   interface (`OutboxStore`, `EventLogStore`, `Transport`) and the host supplies it.
5. **Events, not rows.** Incident state is a projection of a hash-chained event log. Never mutate
   projections directly; emit an event.
6. **New console panes go inside `PaneBoundary`** with a recovery key.
7. **Never weaken a gate to pass.** Fix the candidate or document a reviewed exception in an ADR.
8. **No secrets in the tree.** Signing seeds come from the environment; only public keys are pinned.
9. **Claim boundaries:** say _offline after provisioning_, _signed fixture pack_, _local outbox,
   no uplink configured_ — not "works on a fresh device", "validated venue", or "mesh".

## Decision records

Architecture changes to trust, transport, replication, or the floor contract need an ADR in
`docs/adr/` before code.

## Verification before any push

```bash
npm run ci            # typecheck, lint, tests, gates, build
node scripts/e2e-offline.mjs   # installed-device offline drill (needs Chromium)
```
