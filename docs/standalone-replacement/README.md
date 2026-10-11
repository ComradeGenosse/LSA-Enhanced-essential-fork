# Standalone LSA Native Replacement

**Status:** exploratory parallel migration; **Phase 0 is in progress**. No standalone native binary exists or has been deployed. Existing Essential-based LSA on `main` is unchanged.

This program is scoped separately from the [currently active playable v1.0 roadmap](../ROADMAP.md). The new project aims to remove our dependency on the Essential DLL and stock-server source patches **only after** independently authored runtime behavior has passed offline and staged GTA gates.

Start here:

1. [**Phased roadmap**](roadmap.md) — Phase 0–9 implementation, offline tests, GTA gates and Milestones A/B/C.
2. [**Phase 0 evidence baseline**](phase-0-baseline.md) — exact Essential and source revisions, native and Node dependency seams, reusable functionality, omitted stock features.
3. [**Feature parity matrix**](feature-parity-matrix.md) — retain/replace/defer by user-visible feature, with offline and actual-GTA proof requirements.
4. [**Phase 0 acceptance and blockers**](phase-0-acceptance.md) — explicit PASS/OPEN/BLOCKED items before marking research complete.

### Repeatable preliminary inventory

```bash
node tools/standalone/phase0-inventory.mjs > phase0-inventory.json
node --test tools/standalone/phase0-inventory.test.mjs
```

The script is read-only and finds **candidate** direct source dependencies. It is not a static compiler, IL call graph, reflective resolution audit, runtime simulator, or evidence of GTA acceptance. The generated JSON is for local review; do not commit arbitrary generated data or environment-private information.

### Implementation rules

- New code should live in an independently built project and namespace, with simulated and real RAGE adapters.
- Never let the stock Essential plugin and standalone runtime control the same ped simultaneously.
- Prefer production-state-machine tests with mock game effects, real interprocess transport tests and deterministic event replay before any GTA launch.
- Open reviewable, narrow follow-up PRs; do not merge all phases together or assert binary, feature or physical parity from file counts.
- Freeze an installed-game rollback baseline before the first standalone physical test.

