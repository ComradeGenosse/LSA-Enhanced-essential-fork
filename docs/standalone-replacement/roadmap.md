# LSA Standalone Native Replacement — phased roadmap

**Status (2026-10-11):** Phase 0 research and Phases 1–3 offline implementation are represented in stacked draft PRs; **Phase 4 source integration is in progress** on [PR #44](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/44). Source/CI success is not GTA acceptance; standalone actor adoption, spatial playback and independent mic/STT are still unverified.  
**Historical planning baseline:** `main` at `79a0aa6eb5f6b655afde65993d5d68cba269bca7` (2026-10-11). This is not a claim about the current `main` head.  
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
| **3. Authoritative typed-turn lifecycle** | Single conversation target owner and typed-input path, exact session/turn/generation, model requests, validation, staged history | Existing [PR #43](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/43) adds independent typed input, native one-shot reply staging, model fixtures and cancellation; source CI only | Physical target selection and on-screen keyboard remain GTA-unverified; **early streaming speech segments require a new versioned Phase 4 extension**, not an assumption about Phase 3 |
| **4. Native audio + speech generation** | Keep existing native PCM authority/rolling queues; add **provider-neutral OpenAI/Faster Qwen3-TTS**, per-character voice identity, **early validated Luna segments**, native ordered playback, device completion/cancel receipts, lip-sync contracts and GPU scheduling ([detailed speech upgrade](speech-architecture-upgrade.md)) | Existing [PR #44](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/44) tests single-response PCM/TTS transfer; **new S1–S4 gates** separately require provider switching, segmented early speech, native playback rights, device-progress flow control, and synthetic interruption tests | Actual NPC speaker/spatial device start/completion, interruption and lip-sync **remain unverified**; buffer/EOS receipts are not evidence of audibility |
| **5. First standalone GTA vertical slice** | Isolated deployment candidate, deterministic build manifest and logs, draft integration PR; default OpenAI path plus optional Qwen A/B acceptance | Phase 4 provider, segment ordering and output/receipt tests pass; safe installer/rollback | **Go/no-go:** one NPC accepts typed input, Luna replies, spatial speech is audible, exact playback completes/interrupts, rollback works and Essential never runs concurrently |
| **6. Native mic + provider-neutral STT + UX4 + C-01** | **Independent** native microphone owner, binary PCM input, exact utterance identity, capability-checked cloud/local transcription, one final STT with multiple justified proximity listeners and UX4 PTT/targeting ([M1–M2 plan](speech-architecture-upgrade.md#p6-m1-independent-native-microphone-recording-and-stt-provider-contract)) | Native source/release + one-STT receipt; cancellation, late STT, cross-clock rebasing, partial hearing, per-observer privacy and provider swap tests | Real microphone device/key input, native acoustic source-time/LOS/vehicle coverage, and no speech feedback from NPC audio |
| **7. Promoted characters + physical actions** | P1/P2 bindings, summon/adoption, ACT adapters; supported subset follow/wait, movement, vehicles, combat/reflex and scenarios | Lease/supersession, repeated requests, mission-script locks, spawn/despawn, simulated postcondition/expiry adapters | Follow/seat/drive/combat/animation and release tested per feature, not inferred from dispatch |
| **8. Evidence + autonomous initiative** | PS0–PS4 source adapters, radio/ballistics/proximity observations when accepted, Director and spontaneous speech with exact arbitration | Provenance/observation authorization, PS3 grant/ack, bounded proposals, no hallucinated witnessing or double-speaker paths | Native event fidelity, multi-NPC context, combat priorities, spontaneous playback and realistic scene transitions |
| **9. Parity, soak, migration and retirement** | Golden-log comparison, known-good feature matrix, installer conversion and rollback, performance/reliability | All retained tests and packaging succeed; user data migration reversible | Long sessions, multiple characters, mod coexistence, voice/vehicles/missions/reconnects, final acceptance and explicit cutover approval |

These are *sequential gates*, not claims that a later implementation is impossible to research in parallel. Physical behavior can and should be probed incrementally as soon as its adapter is available, rather than waiting until Phase 9.

## Speech architecture upgrade: sequencing and integration boundaries

The [speech architecture upgrade](speech-architecture-upgrade.md) is the implementation-ready plan derived from the Faster Qwen3-TTS [PR #39](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/39), C-01 microphone/proximity [PR #37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37), and standalone Phase 4 [PR #44](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/44). **These are proposed extensions, not features already delivered in the standalone host.**

1. **Phase 4 S1 — provider abstraction and voices first:** one versioned PCM speech contract, OpenAI/Qwen adapters, per-character provider/voice assignments independent from the physical NPC/lease, reversible provider choice, local Qwen isolation and no credential forwarding.
2. **Phase 4 S2 — early validated model-to-TTS segments:** revise one-shot `TryStageReply` by introducing **new** native-authorized, exact ordered segment receipts instead of silently reinterpreting the old reply schema. Validate model output before TTS. Do not let TTS synthesize incomplete structured JSON/actions.
3. **Phase 4 S3/S4 — physical playback lifecycle and scheduling:** retain a four-second per-stream native memory cap while supporting longer audio by actual output-credit drain; replace arbitrary 2.2-second stalls with a progress-aware bounded watchdog after proving sink behavior. Gate history/lipsync on genuine started/finished/interrupted callbacks. Keep Qwen model-family residency and GPU contention under bounded priority.
4. **Phase 5 — first GTA voice slice:** independently verify physical audio and the exact NPC, then optionally compare Qwen vs OpenAI in the same scene. **STT is not a prerequisite to this typed-input slice**.
5. **Phase 6 M1/M2 — own microphone/one STT/many hearing rights:** new native `utteranceId` and source-time recording (no Essential Harmony hooks); separate bounded PCM data plane from control frames; cloud/local STT plugin contracts, one transcript only after exact release; C-01 observer-specific hearing receipts with full/partial/none knowledge gates.

Keep raw provider/model text, reference voice audio and credentials out of telemetry and repository assets. Never conflate first PCM with physically audible time, queued PCM with completed NPC speech, or typed text with overheard player speech. **All protocol and persistent voice-store changes need explicit schema versions and negative tests.**

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

Phase 0 materials: [scope / evidence baseline](phase-0-baseline.md), [feature-parity matrix](feature-parity-matrix.md), [source/server protocol](phase-0-protocol-audio.md), [audio and RAGE feasibility](phase-0-audio-host-licensing.md), and [completed-research / outstanding physical gates](phase-0-acceptance.md). The source census is implemented and produces reproducible CI artifacts; an exact installed GTA baseline and physical audio proof remain **pre-deployment gates**, not source facts. See [local capture](phase-0-gta-baseline.md).

**Implementation checkpoint:** Phase 1 is represented by [PR #40](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/40), Phase 2 by [PR #42](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/42), Phase 3 by [PR #43](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/43), and Phase 4 by [PR #44](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/44); these are **draft/stacked engineering branches**, not accepted standalone GTA releases. The current `LSA.PromotedCharacters.Runtime` assembly and production installer remain unmodified by this plan.

