# Memory K capability policy foundation — 13 October 2026

This scoped change starts Workstream B from the modular activation plan on the current #138 integration head. It adds policy/configuration descriptors and read-only effective-state diagnostics. It does not split Memory K into releases or wire a registry to start or stop production workers.

## Implemented

- Closed capability IDs, supported modes, and dependency edges for the shared source/storage prerequisites, perception consumers, Memory K consumers, callback/inspector gates, and currently unavailable native producer families.
- Strict optional `memoryK.capabilities` configuration. Omitted configuration requests no new capability and preserves all existing config fields and runtime wiring.
- Pure resolver results distinguish requested mode, effective mode, disabled, enabled, blocked, and unavailable states. Block reasons identify missing dependencies or runtime seams.
- Every optional capability depends on native authority and the mandatory privacy substrate. A request cannot resolve enabled if either is unavailable.
- A read-only bootstrap diagnostic reflects currently registered source, SQLite, D02, and M3 seams. It does not start or stop them, write memory, make provider calls, or alter existing health receipts.
- Focused tests cover dependency resolution, default/disabled behavior, diagnostic reasons, unavailable producers, and independent player/NPC/event requests.

## Still planned

- Workstream C owns a runtime instance, activation lifecycle, disposal, and partial-start failure handling.
- Later workstreams wire individual capabilities to existing implementations and add their scoped positive/negative integration tests. M2/M3 current behavior, M4/M5/M8 callers, M6/M7 workers, and M9 support must not be inferred from this policy catalog.
- Native producer families remain unavailable until included in the production project and qualified. Cloud curation stays off absent its existing persisted consent and budget gates.
- Full S01–S10, native/package, physical GTA, performance, and soak acceptance remain separate release gates; this change makes no full-product acceptance claim.

## Invariants

D01/D02/D03 provenance, Essential execution ownership, single-writer P2 SQLite, timeline/source fencing, privacy suppression, PS4 single-writer assembly, and existing legacy configuration behavior remain authoritative. Capability modes cannot grant any of these authorities.
