# PRODUCTION-W08 — M9 authenticated native event + original PS6 integration handoff

**Owner:** T8. **Date:** 2026-10-12. **Exact feature baseline:** PR #94,
`0201731973a1c02a8852271897e2c8df420396b9`.
**Target:** `integration/memory-closure-final-k-20261011`.
**Status:** partial specialist source implementation, **A08 NOT MET / GTA NO-GO**.
This document does not attest a compiled original Core/GTA plugin, a source-time PS2 receipt, a P2-backed event, a played line, or an approved deployment.

## Real callback/source capability inventory (as inspected)

| Requested event | Actual original pinned source | T8 producer state |
| --- | --- | --- |
| Vehicle collision, source classified | `DamageTrackerLib.DamageTrackerService.OnVehicleTookDamage` in `native/intelligence/DamageSensors.cs`. `VehDamageInfo.WeaponInfo.Type` maps `VEHICLE` to `collision`; original `SensorAdapters.Damage` creates a concrete `RawSignal.signalId`, `gameTick`, `receivedMs`, vehicle captureRef and damage. The loaded DamageTrackerLib hash is checked in `IntelligenceIntegration.cs`. | **Real original callback exists**, new `M9OriginalVehicleCollisionProducer` is specialized to it and added to native isolated harness. **Not yet registered in the K-owned original host**. Actor participation requires independent source-time player/vehicle proof; if unavailable, disabled. Event receipt is never PS2 witnessing by itself. |
| Rollover | No positively verified, registered original owner-fiber orientation source in pinned integration | **DISABLED / unsupported**; generic M9 JS edge classifier alone is not an event source |
| Airborne + landing | No positively verified original airborne, grounded and event-tick continuity source in pinned integration | **DISABLED / unsupported** |
| Vehicle entered water / submerged | No positively verified registered water/submersion source in pinned integration | **DISABLED / unsupported** |
| Wanted level change | No positively verified registered player wanted-level source in pinned integration | **DISABLED / unsupported** |
| Wasted | Original state `Ped.IsDead` produces generic `death` in `SensorAdapters.Sample`, **not** an independently source-attested original Wasted callback | **DISABLED / unsupported** |
| Busted | No independently registered pinned Busted callback | **DISABLED / unsupported** |
| High-speed collision | DamageTracker callback reports `damage` and `classification`; not exact before-impact velocity or velocity delta | **DISABLED / unsupported** (never infer from speed drop) |

Additional original API references: `native/intelligence/DamageSensors.cs`,
`native/intelligence/SensorAdapters.cs`, `native/intelligence/IntelligenceIntegration.cs`,
`native/intelligence/DirectorAdmission.cs` (original native C-11, including one-use stock intake,
bound original turn/generation and `Complete` audio proof), `native/intelligence/m9/M9NativeDamageAdapter.cs`,
`native/intelligence/m9/M9NativeFrameAdapter.cs`; original PS3 selector
`lsa-essential-e1-candidate/src/perception/sceneDirector.mjs`.
No RAGE getter is claimed usable just because a plausible native name exists.

## Implemented specialist files

- **New** `native/intelligence/m9/M9OriginalVehicleCollisionProducer.cs` stages *the identical original* `RawSignal` reference once, captures run/host/epoch, source event ID, tick, vehicle and actor scope, guards callback mutation and <=3-second age, validates current anchors through `M9NativeDamageAdapter`, and consumes on the game owner fiber. Missing source-time player/vehicle actor proof rejects `Capture`. The producer is inert until K registers it at the exact pinned DamageSensors/SensorAdapters creation site.
- **New** `lsa-shared-brain/src/events/m9CommittedWitnessAuthority.mjs` is a synchronous fail-closed readback guard. It checks the current native run/world/player and owner incarnation/encounter, separately re-reads T2's **source-time PS2** witness and observation-game-tick, reads exact committed P2 `journal_event` **AND** matching durable sidecar through the ONE P2 store, checks direct claims, source hash, scope and deletion, and rechecks native scope after readback. A queued write, prompt, `nativeVerified` candidate flag, no-witness inference or stale receipt does not authorize a memory.
- Updated `m9MemoryCues.mjs`: typed input, combat and stock-turn quiet gates are mandatory alongside microphone/player/owner/timeline.
- Updated `m9DirectorCueAdmission.mjs`: requires a **committedWitnessAuthority.check** port on every original PS3 entitlement, rechecks before registration and before/after original SceneDirector call; only the original PS3 selector, PS6 grant and native C-06/C-11 route may produce speech. A Director `delivered` result now reports `director_submitted_audio_unverified`, explicitly **not** an audible dialogue receipt; T3/W03 must receive the exact native completion callback before recording anything spoken.
- Existing `m9EventProducers.mjs`, `m9Ps2CandidateBridge.mjs`, `M9NativeFrameAdapter.cs` remain candidate/adapter-only (not proof of GTA availability).
- Tests extended in `native/intelligence/m9-tests/Program.cs`, project inclusion in `M9NativeTests.csproj`, `lsa-essential-e1-candidate/tests/memory-m9-completion.test.mjs`; new negative source fixtures `lsa-shared-brain/tests/m9-production-source-admission.test.mjs`.
- New specialized CI `.github/workflows/memory-k-w08-specialist.yml` runs Node 24 Windows/Linux isolated fixture tests and native .NET 4.8.1 policy harness on Windows.

## K original registration and integration instructions (NOT done by T8)

1. In **K-owned** `IntelligenceIntegration.cs` / original native project file, include `M9OriginalVehicleCollisionProducer.cs` alongside original `M9NativeDamageAdapter.cs` and `M9NativeFrameAdapter.cs`. Register only after the **exact pinned** DamageTracker assembly is verified and existing callback source is active. From the original `DamageSensors.VehicleDamage -> SensorAdapters.Damage` signal creation path, pass the **same RawSignal object**, actual host/nativeRun/world epoch and source-qualified player captureRef to `Capture`. The existing `SensorAdapters.Damage` bool interface does not currently return that object: K must expose a narrowly scoped authenticated original callback hook rather than reconstructing a signal from wire JSON. Never invoke `Capture` from an arbitrary signal or model input. Native player-in-colliding-vehicle source-time attestation must be real; absent this capability, keep M9 collision disabled.
2. Only the existing native game owner fiber may call `TryTake`; retire on callback source shutdown, world epoch switch, owner/vehicle retirement, and pipe loss. Use this occurrence as collision receipt for `M9NativeFrameAdapter.TryBuild`, verifying its exact object/source again. Do not set `verifyNativeField('vehicle_motion'/'wanted_level')` or `verifyTerminalReceipt` true without a separately proven original source. In JS `verifySource` must check the current registered native receipt/channel independently, not the `source.authenticated` property alone.
3. K/T2: correlate `M9Ps2CandidateBridge`'s **separate typed** candidate to the *actual* source-time PS2 signal observation and independent promoted NPC receipt(s). Closed PS2 v1 `signal` is not an arbitrary extension point. Missing or unqualified observers remain unknown. The P2 original M3 writer and T6 transaction adapter must durably commit a source-linked `journal_event` **and sidecar** with the exact candidate event ID, original signal ID, source hash, actor event tick and owner incarnation/encounter. The proposed `m9CommittedWitnessAuthority` ports explicitly require this schema; no compatibility shim may fabricate a source-time witness or claim.
4. Supply four synchronous sources for `M9CommittedWitnessAuthority`: `readCurrentNativeScope`, `readSourceTimePs2Witness`, `readCommittedP2Event`, `readCommittedP2Sidecar`. Their outputs must conform to the strict fields enforced in the source module. Especially preserve original PS2 `adapterEpoch`/nativeRun mapping as independently attested source identity, never inferring it from current time.
5. Supply `committedWitnessAuthority` to `M9DirectorCueAdmission` plus **the original** PS3 selector/grant/SceneDirector driver, current C-06 mic/text/player/combat/stock/busy priority, and sole PS4 C-04 frame registration. Do not trigger a separate model/voice/TTS pipeline. T3 must capture spoken text only upon exact original native playback completed callback with corresponding turn/generation/identity; `director_submitted_audio_unverified` must never be displayed or persisted as `spoken`.
6. Preserve current product OFF/shadow behavior. Run original native project build, pinned ABI checks, original S10 integrated replay, sound/interruption/source deletion/rollback tests on one exact K merge SHA, then consider any controlled GTA test only after independent authorization.

## Test receipts / limitations

**Source changes pushed**, but at handoff authoring **isolated tests not yet verified green on this branch**.
No local `dotnet` installation and no container-network clone were available in the authoring runtime.
Dedicated Actions commands (must inspect the run logs and commit SHA before claiming PASS):

```sh
node --test lsa-shared-brain/tests/m9-production-source-admission.test.mjs lsa-essential-e1-candidate/tests/memory-m9-completion.test.mjs lsa-essential-e1-candidate/tests/memory-agent-b-events.test.mjs
dotnet run --project native/intelligence/m9-tests/M9NativeTests.csproj --configuration Release
```

These are **isolated fixtures**, not pinned original GTA source registration or a physical GTA receipt. A08 requires K to integrate original source callback + T2 source-time PS2 + P2 readback + native PS6 and to produce separate verified final-head test logs. **A08 NOT MET, GTA NO-GO.**
