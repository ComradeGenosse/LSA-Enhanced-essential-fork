# LSA Standalone Native Replacement — phased roadmap

**Status:** proposed parallel migration; Phase 0 in progress, implementation phases not started.  
**Baseline:** `main` at `79a0aa6eb5f6b655afde65993d5d68cba269bca7` (2026-10-11).  
**Do not treat:** documentation, merge, offline compilation, packaging, GTA installation, and real-game acceptance as equivalent.

This is a **new program**, not an amendment to the existing playable LSA v1.0 scope. The working Essential-based pipeline remains authoritative until a distinct, explicitly accepted cutover. Existing [decisions](../research/DECISIONS.md) and [contracts](../research/system-contract-register.md) govern the *current* runtime; any eventual replacement of D-001/D-012/D-016 requires a separate versioned architecture decision and migration review, not a silent edit.

## Objective and boundaries

Build an independently authored RAGE Plugin Hook native runtime and an independently bootstrapped companion that preserve LSA Enhanced's selected capabilities **without loading `LosSantosAlive.dll` or patching `server.bundle.mjs`**. Reuse our AI, identity, character, perception, PS4 knowledge, Director, ACT policy, controller UX and provider code wherever safe. Do not reimplement all legacy Essential methods or copy third-party binary code/assets into the new deliverable.

- **Non-negotiable:** one physical-task owner per ped, one session/turn/audio authority per actor, exact cancellation and generation fences, no durable CharacterId used as a GTA effect address, no false physical-completion claims, no perception-to-knowledge shortcut, no stale work after world reset, no background game calls outside the approved game-fiber boundary.
- **Parallel operation:** code may coexist in the repository, but the independent and Essential runtimes must not drive the same GTA world/ped at once. Test with isolated installation profiles, explicit mode selection, startup mutual-exclusion checks and rollback.
- **Source ownership:** use independently written code and libraries whose licensing/redistribution terms have been verified; the reference Essential binaries are evidence/build references only, not standalone distribution payload.
- **No big-bang PR:** split into phase-specific PRs against a future `standalone/integration` branch after Phase 0, and keep `main` unaffected until validated cutover. Do not create that additional branch in Phase 0 unless required for implementation.

## Phases and exit gates

| Phase | Deliverable | Offline gate | Required GTA gate / boundary |
| --- | --- | --- | --- |
| **0. Baseline and scope freeze** | Feature-parity and dependency inventory, exact stock hashes/revision, open-risk/evidence register, minimum playable slice and rollback plan | Every MVP dependency accounted for; representative sources and evidence pinned; unknowns explicit | Capture/attach a verified known-good installed-game manifest and representative baseline traces before Phase 0 is marked complete |
| **1. Independent native foundation** | Native CLR library, `IGameWorld`, `IActorResolver`, `IGameClock`, `IInputSource`, `IAudioOutput`, `IActionExecutor`, world/owner/epoch state | No `LosSantosAlive` assembly references/load or Essential-specific types in independent production build; deterministic identity/retirement tests pass | None yet; RAGE compatibility is compile-only |
| **2. Independent RAGE host and transport** | Own plugin entry point, game-thread dispatcher, lifecycle, bounded versioned native↔Node protocol, native health/shutdown, independent Node startup | Real two-process interop, protocol version negotiation, backpressure/reconnect/expiry, startup failure and teardown tests pass | Plugin load/fiber/entry point remains unproven offline |
| **3. Authoritative typed-turn lifecycle** | Single conversation target owner and typed-input path, exact session/turn/generation, model requests, validation, staged history | End-to-end typed request → Luna (provider fixture) → response and failure path; exactly-once and no stale history across resets | None yet; physical target selection unverified |
| **4. Native audio system** | Independent stream authorization, PCM buffering, speaker routing, completion/cancel receipts, output and lip-sync adapters | PCM bytes/order/backpressure/finalization/interruption and simulated playback tests; real RAGE-targeted audio package compiles | Spatial audibility, accurate lip-sync and output-device operation cannot pass without GTA |
| **5. First standalone GTA vertical slice** | Isolated deployment candidate, deterministic build manifest and logs, draft integration PR | All prior offline gates and safe installer/rollback checks pass | **Go/no-go:** one NPC accepts typed input, Luna replies, spatial speech is audible, exact playback completes/interrupts and nothing competes with Essential |
| **6. Player microphone + UX4 + C-01** | Native source-time PTT lifecycle, one transcription, controller/menu targeting, justified proximity-listening receipts | Race, partial/cancel, one-to-many hearing, semantic typed-vs-audible routing and absence-of-duplicate-STT tests | Real mic input/ownership timing, controls, vehicle/acoustic restrictions and directed-listener association |
| **7. Promoted characters + physical actions** | P1/P2 bindings, summon/adoption, ACT adapters; supported subset follow/wait, movement, vehicles, combat/reflex and scenarios | Lease/supersession, repeated requests, mission-script locks, spawn/despawn, simulated postcondition/expiry adapters | Follow/seat/drive/combat/animation and release tested per feature, not inferred from dispatch |
| **8. Evidence + autonomous initiative** | PS0–PS4 source adapters, radio/ballistics/proximity observations when accepted, Director and spontaneous speech with exact arbitration | Provenance/observation authorization, PS3 grant/ack, bounded proposals, no hallucinated witnessing or double-speaker paths | Native event fidelity, multi-NPC context, combat priorities, spontaneous playback and realistic scene transitions |
| **9. Parity, soak, migration and retirement** | Golden-log comparison, known-good feature matrix, installer conversion and rollback, performance/reliability | All retained tests and packaging succeed; user data migration reversible | Long sessions, multiple characters, mod coexistence, voice/vehicles/missions/reconnects, final acceptance and explicit cutover approval |

These are *sequential gates*, not claims that a later implementation is impossible to research in parallel. Physical behavior can and should be probed incrementally as soon as its adapter is available, rather than waiting until Phase 9.

## Named release milestones

- **A — Independent conversation (Phases 0–5):** a single, typed NPC exchange with verified GTA audio and safe interruption; not a full Essential replacement.
- **B — Playable standalone LSA (Phases 6–8):** microphone, promoted characters, selected actions, perception and bounded Director features with documented omissions.
- **C — Essential retirement (Phase 9):** an explicitly accepted installation that no longer depends on the Essential DLL or its original server bundle.

## PR policy and validation evidence

1. Each phase PR documents scope, exact parent SHA, affected current contracts, migration-only contracts, production source changed, unit/integration/regression tests **actually executed**, and GTA tests **not executed**.
2. Use **real production implementation** behind game abstractions; mocks replace only RAGE/game effects. A simulator accepting the wrong message must not cause a test to pass.
3. Use deterministic clocks, entity-handle recycling, lost/late/out-of-order events, random-but-seeded schedules, cancellation, transport resets, and serialized real-process envelopes. Keep seeds/traces for replay.
4. Define playback success as exact native accepted playback that started, contained real audio, and completed for the matching actor/turn/generation. A model reply or audio-byte send is insufficient.
5. Define physical-action success by per-family game postconditions or truthful persistent-mode ownership, **not** an action-handler boolean.
6. Mark gates **PASS / FAIL / BLOCKED / UNTESTED** with links to build logs, commit hashes and fixtures; no 'seems fine' acceptance.
7. Branch-specific experiments must not be represented as `main` behavior; verify open PR #32 (radio), #35 (ballistics) and #37 (C-01) before importing them.

## Phase 0 handoff and first coding boundary

Phase 0 materials: [scope / evidence baseline](phase-0-baseline.md), [feature-parity matrix](feature-parity-matrix.md), [open gates and acceptance checklist](phase-0-acceptance.md). Phase 0 is *not yet complete*: installed-payload backup/hash receipts, exhaustive direct Essential symbol inventory and chosen audio-platform spike remain open.

When Phase 0 is accepted, **Phase 1 PR** should start by adding only independent interfaces and the real identity/ownership state machine with game fakes and tests. The current `LSA.PromotedCharacters.Runtime` assembly and production installer stay unmodified.

