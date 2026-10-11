# Phase 0 — Original server lifecycle and replacement protocol audit

**Source-pinned:** `main` `79a0aa6eb5f6b655afde65993d5d68cba269bca7` (2026-10-11). **State:** research-complete for the Milestone A logical contract; stock internal behavior remains a reference, not a copied implementation or runtime acceptance. This is **not** an implemented protocol.

## What is being replaced (two dependencies, not just one)

1. **Native DLL**: `LosSantosAlive.dll` is the actual RAGE-side NPC executor and source of microphone/target/context and audio playback events. Our `native/promoted-characters/EntryPoint.cs` finds its AppDomain; `DomainHost.cs` verifies its exact hash; `RuntimeEntry.cs` registers `IIntegration` inside that domain.
2. **Original Node server**: `lsa-essential-e1-candidate/tools/buildCandidate.mjs` modifies the pinned, obfuscated `upstream/server.bundle.mjs`. At build time it verifies the original DLL SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`, stock Node bundle SHA-256 `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2`, pinned metadata hash and exactly **70 AST edits**. `bootstrap.mjs` and `essentialGlue.mjs` attach our provider stack to stock's session, action and playback lifecycle; the stock turn allocator is **not** replaced today.

An independent standalone native core must **also** supply new Node bootstrap/session/transport implementation or the 70 patches remain a production dependency.

## Stock-patch seam families and replacement duties

The exact 70 output edit positions/labels are produced at build time by `patchSource()` in `tools/buildCandidate.mjs` and stored in `build-manifest.json.astPatches`. The grouped source anchors below were traced directly through the patch source. These are **families** of edits; do not mistake the table for a one-to-one list of 70 edits.

| Stock symbol / injection | Today | Standalone native + companion obligation |
| --- | --- | --- |
| `kK` / `WP` / `Zi` | Transport factory, session opening, context association, Gemini isolation | Independent transport, `session.open/closed`, exact actor+listener+world snapshots and nonce/lifetime |
| `Xn` / `Xi` | Original input-to-turn intake, generation allocation, native binding and Director ticket enforcement | Atomic `turn.accepted` and generation allocation on one authoritative host; no fake player/special turns |
| `ib` / `wd` | Typed input vs microphone intake and hydration | First-class `player_text`, `player_mic` sources, type-safe target and listener presence (omitted/null/present) |
| `kb` / `M4` | Internal/special turn hydration, Director preflight and binding ACK before model input | Native admission, ticket reservation, source-qualified spontaneous dialogue and one responder |
| `Zt` / `hK` / `Qi` / `Ei` / `el` | Terminal, cancel, interrupt, session retire and microphone reset observation | Single terminal arbiter with fail-closed generation/epoch ownership, explicit disconnect/reset |
| `rP` / `AP` / `wP` | Provider event/output forwarding, transcript and terminal processing, history correction | Canonical `decision`/audio/action flow; history staged until **matching** successful audible playback |
| `yK` plus action handlers | Suppression of physical side effects for speech-only Director; stock action parsing/dispatch and validation | Single validated action execution boundary after context-aware policy; never replay already-published effects |
| `BK`, `qK`, `ia`, `AO`, `CO`, `eo`, `pd`, `EO` | Prompt/world/actor/listener snapshot, preservation of private reserved blocks | Native snapshot service; preserve absence vs null; prevent private evidence from being promoted into untrusted raw context |
| `_P` / `Sd` / `Td` / `td` | Stock Gemini paths bypassed for OpenAI | No stock Gemini compatibility requirement in Milestone A |
| Original turn priority callbacks | PS6 admission observes `A.mic`, live sessions, pending output owners and maps | One explicit source-time microphone/output owner, no scanning obfuscated internal mutable maps |

`buildCandidate.mjs` **requires a literal 70-edit count** and tests its stock source fingerprint. We should not port those edits mechanically: the contract describes desired behavior, while the new implementation uses independently owned structures and stable versioned messages.

## Existing tested companion seams (reuse with adapter, not copy of stock)

- `src/openai/openaiConnection.mjs`: `beginTurn()` demands `pedId`, `turnId`, integer `generationId`, integer `sessionNonce`; current native event routing is `host.isCurrent` gated. `sendText`, `startRealtimeInput`, `sendRealtimeAudio`, `endRealtimeInput`, `abortTurn` are separable from the *source* of native identity. Current microphone input specifically uses **16 kHz mono PCM16**, a provider-facing contract.
- `src/openai/runSequentialTurn.mjs`: staged STT/reasoning/TTS, source-aware decision policy, output authorization before PCM handoff, provider deadlines, native playback acknowledgement and terminal handling. Existing TTS output is **24 kHz mono PCM16**; input and output sample rates are intentionally different.
- `src/integration/nativeDelivery.mjs`: observes but does not allocate/own audio. `sameIdentity` checks `pedId`, `turnId`, `generationId`, `sessionNonce`. `observeNative` distinguishes `audio_turn_accepted` from terminal `audio_turn_rejected`, `playback_ended`, interrupt/cancel/fail. A successful `playback_ended` has `reason='completed'`, `wasInterrupted=false`, `hadAudio=true`, `playbackStarted=true`.
- `src/integration/essentialGlue.mjs`: `attachBridge` requires `isCurrent`, `routePinnedEvent`, `authorize`, `onNativeEvent`, `assertCapabilities`, `validateDecision`, `failMatchingTurn`; `hostFor` wires `prepareTurn`, `emit`, `observe`, `authorize`, `failTurn`. A standalone bridge can satisfy these existing conceptual contracts while later renaming interfaces.
- `src/bootstrap.mjs`: currently assumes `server.bundle.mjs` entry for automatic telemetry. Standalone startup must explicitly supply entry/env/config/log locations instead of assuming a stock launcher.

## Physical native audio baseline (binary inspected, not a playback proof)

Pinned Essential CLR metadata and IL show:

- `LosSantosAlive.Audio.NpcSpatialAudio` uses `NAudio.Wave.WaveOutEvent`: constructor, `DesiredLatency`, `NumberOfBuffers`, `Init`, `Play`, `Stop`, `Dispose` calls are present in its methods; `WaveFormat` is referenced.
- `NpcSpatialAudio` exposes `SetAudioVolume`, `SetSpeakerPed`, `EnqueuePcm16Mono`, `TryQueueMonoChunk`, `InterruptTurn`, `IsAudibleAudioPlaying`, `GetLastChunkRms`, `HardMuteForMs` and shutdown methods.
- `NpcPlaybackCoordinator` exposes exact-turn authorization, tagged chunk queue, stream end, interruption and started/ended events. `NpcLipSync` has start/stop talking methods.
- These observations make **NAudio 2.x on .NET Framework** a source-grounded first feasibility candidate. They **do not** establish the original internal attenuation/panning algorithm, live device behavior, game mix integration, lip-sync animations or redistributable rights to Essential assets. Never copy the original code.

## Proposed independent Milestone A wire contract (design, not implemented)

**Envelope**, with versioned schema and bounds to be finalized in Phase 2:

```text
v, messageId, hostRunId, worldEpoch, actorRef, actorIncarnation,
conversationId, turnId, generationId, sessionNonce,
source [player_text|player_mic|special_event],
kind, monotonicSequence, payload
```

Use the same actorRef/incarnation and run/epoch tuple for **every** event; no names, model hash or long-lived CharacterId as an effect address. The original `pedId` may remain a compatibility/display field but is insufficient alone to authorize an operation. Each side validates the exact message schema and known sender-owned sequence/tuple before mutation.

| Message family | Direction | Required ordering / semantics | Error and audit cases |
| --- | --- | --- | --- |
| `host.hello`, `host.ready`, `host.stop` | both | Version, capability negotiation and fresh epoch before requests | duplicate process, invalid protocol, missing host, mismatched epoch |
| `actor.snapshot`, `actor.retired`, `target.committed` | native→Node | Pre-use provenance and lifetime, never inferred from name | reused handles, stale target, script-unsafe mission state |
| `turn.request`, `turn.accepted`, `turn.rejected` | both | One authoritative turn allocator; source qualified; no early provider start without identity | duplicate text, busy output, fresh player turn supersedes Director |
| `audio.authorize`, `audio.accepted`, `audio.rejected` | both | Authorize exact speaker/turn before streaming | busy speaker, expired actor, wrong generation |
| `audio.chunk`, `audio.stream_end` | Node→native | Bounded PCM; monotone chunk index and exactly one EOS; no bytes after retirement | missing/duplicate/out-of-order PCM, malformed sample, stream overrun |
| `audio.playback_started`, `audio.playback_ended` | native→Node | Real device state; terminal success only if started + audible bytes + completed, exact identity | silence, underflow, device failure, cancelled, late callback |
| `turn.cancel`, `turn.terminal`, `session.retired` | both | Idempotent exact-target terminal; side effects never revived | disconnect between authorize/send/EOS/ack |
| `action.request`, `action.accepted`, `action.outcome` | both (Phase 7) | Policy/dispatch separate from GTA physical completion | handler-only success, staleness, scripted task priority |

**Suggested turn lifecycle:** `requested → bound → provider_work → audio_authorizing → audio_streaming → stream_ended → playback_started → terminal`; errors/cancel can transition **once** to `terminal` from any nonterminal state. Playback-start and EOS may race; validate identities rather than assuming they arrive in one fixed order. History is staged after input acceptance and committed only after an eligible terminal receipt; terminal failure retires any pending assistant text. The existing E1 tests should be reused as contract fixtures.

## Minimal source-to-test traceability for Phase 1–5

| Requirement | Production reuse/proposed seam | Existing tests to adapt | Additional offline fixture |
| --- | --- | --- | --- |
| Exact turn and single source | `openaiConnection.beginTurn`, new authoritative host | `tests/*.test.mjs` filtered E1 lifecycle; inspect by filename at implementation | two NPCs, reused ped ID/new incarnation, rapid typed/mic swaps |
| No history before playback | `nativeDelivery`, `DialogueHistory`, `runSequentialTurn` | E1 terminal/history tests | old-generation playback ended after new session |
| Provider streaming correctness | `speak.mjs`, `runSequentialTurn.mjs` | streaming, interruption and failure tests | chunk sequence, EOS reordering, zero/odd bytes |
| Real native process boundary | new protocol; existing named-pipe patterns | `tools/testPerceptionInterop.mjs`, native bridge suites | wrong-protocol process, mid-chunk death, restart and replay |
| Actor/owner safety | `EntityAnchors`, new `IActorResolver` | `native/intelligence/integration-tests`, `native/promoted-characters/bridge-tests` | actor lifetime reset while audio is active |
| Native audio | new `IAudioOutput` adapter | none proves independent Windows sound | PCM fixture/read clock, device-unavailable, simulated time; GTA later |

## Decision and uncertainty register

- **Contract-level research sufficient to start Phase 1:** clear new ownership boundary, exact input/PCM output profiles, safe terminal behavior, existing companion adapter seams and independent test strategy.
- **Requires implementation spike before Phase 5:** NAudio 2.x output, sample conversion/mixing, spatial emitter tracking, audio callback threading, output-device switching; compare against XAudio2/X3DAudio only if NAudio output is inadequate. Do not assert NAudio automatically implements 3D spatialization.
- **Physical-only proof:** spatial direction and attenuation, actual audible playback/driver under GTA, model->RAGE lip-sync and gaze, RPH fiber/task safety.
- **Unproven/hidden stock behavior:** obfuscated internal scheduler races and undocumented semantics. This is why acceptance uses an independent behavioral contract and scenario replay, **not** line-for-line binary cloning.

Reference code: [stock patch builder](../../lsa-essential-e1-candidate/tools/buildCandidate.mjs), [OpenAI connection](../../lsa-essential-e1-candidate/src/openai/openaiConnection.mjs), [sequential pipeline](../../lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs), [native delivery](../../lsa-essential-e1-candidate/src/integration/nativeDelivery.mjs), [Essentials bridge](../../lsa-essential-e1-candidate/src/integration/essentialGlue.mjs), [audio API inventory](../plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md). External technology context: [NAudio project / license](https://github.com/naudio/NAudio), [RAGE execution model](https://docs.ragepluginhook.net/html/4c04eafe-2474-4f41-9087-ac47bb16d491.htm), [X3DAudio overview](https://learn.microsoft.com/en-us/windows/desktop/xaudio2/x3daudio-overview).
