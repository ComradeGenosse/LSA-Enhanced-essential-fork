# Standalone LSA Native Replacement

**Status (2026-10-11):** isolated standalone **source/CI candidate** through draft [PR #50](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/50), including a compiled host and reversible test packaging. **Not GTA-accepted, not merged into main, and not a live Essential replacement.** Existing Essential-based LSA on `main` is unchanged.

This program is scoped separately from the [currently active playable v1.0 roadmap](../ROADMAP.md). The new project aims to remove our dependency on the Essential DLL and stock-server source patches **only after** independently authored runtime behavior has passed offline and staged GTA gates.

Start here:

1. [**Source-backed hardened architecture / implementation plan (Oct 11)**](architecture-review-hardened-plan-20261011.md) — reviewed F1–F18, retained brain/body/voice design, source pins, physical probes, protocol contracts, phase PRs and acceptance gates (**proposed; no code enabled**).
2. [**Phased roadmap**](roadmap.md) — Phase 0–9 implementation, offline tests, GTA gates and Milestones A/B/C.
3. [**Phase 0 evidence baseline**](phase-0-baseline.md) — exact Essential and source revisions, native and Node dependency seams, reusable functionality, omitted stock features.
4. [**Feature parity matrix**](feature-parity-matrix.md) — retain/replace/defer by user-visible feature, with offline and actual-GTA proof requirements.
5. [**Phase 0 acceptance and blockers**](phase-0-acceptance.md) — research findings, completed CI checks, and gates explicitly deferred to a real GTA deployment.
6. [**Stock server/turn/audio protocol map**](phase-0-protocol-audio.md) — independent Node transport contract, exact tuple and terminal behavior.
7. [**RAGE host, audio, and licensing feasibility**](phase-0-audio-host-licensing.md) — verified NAudio API references and the required spatial-audio spike.
8. [**Installed GTA baseline and rollback**](phase-0-gta-baseline.md) — local read-only fingerprint tool and physical scenario checklist.

### Repeatable preliminary inventory

```bash
node tools/standalone/phase0-inventory.mjs > phase0-inventory.json
node tools/standalone/phase0-static-review.mjs > phase0-static-review.json
node --test tools/standalone/phase0-inventory.test.mjs tools/standalone/phase0-static-review.test.mjs
```

The script is read-only and finds **candidate** direct source dependencies. It is not a static compiler, IL call graph, reflective resolution audit, runtime simulator, or evidence of GTA acceptance. The generated JSON is for local review; do not commit arbitrary generated data or environment-private information.

### Implementation rules

- New code should live in an independently built project and namespace, with simulated and real RAGE adapters.
- Never let the stock Essential plugin and standalone runtime control the same ped simultaneously.
- Prefer production-state-machine tests with mock game effects, real interprocess transport tests and deterministic event replay before any GTA launch.
- Open reviewable, narrow follow-up PRs; do not merge all phases together or assert binary, feature or physical parity from file counts.
- Freeze an installed-game rollback baseline before the first standalone physical test.

