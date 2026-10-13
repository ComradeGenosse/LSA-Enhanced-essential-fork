# Memory K capability policy — Workstream B correction (13 October 2026)

This revision stays on PR #160 against #138 and uses PR #158's modular activation plan. Workstream B **only** describes configuration intent, dependency constraints, implementation candidates and read-only diagnostic evidence. It does not implement Workstream C lifecycle, policy enforcement, pause/shadow behavior, cloud scheduling, native feature switching, or proof of GTA acceptance.

## Semantics and limits

- `requestedMode` is parsed startup *intent*. Omitted and explicit `off` requests both leave **legacy runtime behavior unchanged**. The reported state is `not_requested`, **not** `disabled` or effectively off.
- `implementationStatus` is `candidate_unverified` or `absent`. Candidate only means that a relevant software seam exists in inspected source, not that the compiled native build or complete implementation works.
- `registrationStatus` is `registered`, `missing` or `unverified`. A constructed object/method establishes **registration only**. Neither registered nor a host-context snapshot proves a healthy source, timeline, privacy gate, writer, or operation.
- `state` is `not_requested`, `blocked` (policy dependencies), `unavailable` (absent implementation or missing seam), or `unverified` (candidate subject to runtime proof). `blockers` retain explicit missing-dependency and missing-evidence reasons.
- `effectiveMode: null`, `actualRuntimeState: 'unknown'` and `operationalState: 'unverified'` are intentional for **every** capability. Without Workstream C enforcement and authenticated operation/lifecycle receipts there is no truthful effective-on/off mode. Do **not** treat these as an authorization decision. Production authority/privacy checks remain unchanged.
- `memoryKDiagnostics().environment` reports read-only registration/snapshot observations separately from `freshness`, `timelineConfirmation`, `writerHealth`, `currentOwnerProof`, `privacy.enforcement`, M3 intake, cloud consent/budget/idle. Those readiness conditions are `unverified` without appropriate proof. No diagnostic read authorizes a write or enables an operation.
- `memoryKCapabilities()` is retained as a compatibility projection of the same capability rows. No new operational switch is wired to either service.

## Dependency contracts verified against #138

- D03 NPC outcomes require the **already durable player line** in the same reply (`d03_no_durable_player_line` otherwise) and fresh D01/D02/speech-ledger continuity. NPC on/player off is blocked; player on/NPC off remains legal.
- Ordinary PS1/PS2/PS3/PS4/PS6 do not inherit Memory K SQLite/privacy. Plain PS6 depends on PS2/PS3 and existing native Director admission, not on M3/callbacks.
- M3 event intake requires PS2 accepted observations, P2, native attribution and privacy, **not PS3 salience**. Coverage may register native samples independently of optional positive-event capture.
- M6 can process already retained eligible evidence with live M3 capture off. M7 can consume authorized queued jobs with M6 scheduling off; persisted consent, budget, fresh native idle, recovery and source checks remain mandatory. Compiled M9 producer families do not depend on M3 consumer activation; the families in this catalog are still unavailable in the inspected production build.
- M4 live dialogue/journal/M5 keep their accepted-player-line requirement. Retained-data reading and privileged privacy are distinct from these live consumers. No fake readiness is inferred from method availability.

## Regression and acceptance boundary

Focused policy tests cover the closed catalog, unsupported modes, independent requests, player/NPC asymmetry, PS2/M3/PS6, M6/M7/M9, legacy defaults and read-only bootstrap diagnostics. Existing D01/D02/D03 and single-writer P2 flows are not modified. Full original S01–S10, exact-head CI, native/build, physical GTA, and soak acceptance remain independent release gates for #138. Existing unrelated release-gate failures must be reported, not suppressed.

**Workstream C remains required before actual modular off/shadow/on operation can be claimed.**
