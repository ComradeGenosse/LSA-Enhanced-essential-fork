# Research: direct damage callbacks remain zero in GTA V Enhanced

Date: 2026-10-06  
Status: research only; no runtime/config/deployment changes  
Branch: `research/damage-callback-delivery-20261006`

## Finding

The current evidence localizes the failure **upstream of the LSA intelligence damage handlers**.

The strongest current hypothesis is that the separate `DamageTrackingFramework` producer is absent, not started by RAGEPluginHook, or otherwise not writing usable frames to the shared memory transport. Confidence: **high, but not root-cause confirmed for the October 6 session**.

`DamageTrackerService Started` is not evidence that producer-to-consumer delivery is working.

## Why the zero callback counters matter

Current `main` and `feature/act2-player-assigned-basic-activities` use the same damage-path source blobs:

- `native/intelligence/DamageSensors.cs`: `072b1a368590766683fab9d64dfaff17313d8f61`
- `native/intelligence/SensorAdapters.cs`: `e74f8537ddde2cf172063365fb2d83094470c73b`
- `native/intelligence/IntelligenceIntegration.cs`: `60d8d90e554935ac9db442471fd47b17dad7d73a`

In `native/intelligence/DamageSensors.cs`:

- line 21 subscribes to `OnPedTookDamage`, `OnPlayerTookDamage`, and `OnVehicleTookDamage`
- lines 26-27 increment ped/player diagnostics immediately on handler entry
- line 34 increments vehicle diagnostics immediately on handler entry
- line 51 removes the subscriptions

Therefore persistent `damage_callbacks=ped:0,player:0,vehicle:0` means those LSA handlers were never entered. Payload validation, participant/anchor mapping, queue admission, witness logic, and intelligence publication occur later and cannot explain zero callback-entry counts.

The October 6 session separately produced 31 `injury_state` and 7 `death` signals, so ordinary damage/death was exercised through the independent state-sampling path.

## Subscription / AppDomain path

The intended runtime path is:

`DamageTrackingFramework producer -> named MMF -> DamageTrackerService -> static damage events -> DamageSensors -> SensorAdapters -> intelligence signal publication`

The LSA runtime is deliberately injected into the existing Essential AppDomain:

- `native/promoted-characters/RuntimeEntry.cs:10-14` states that the runtime is loaded only in the existing Essential domain.
- `native/promoted-characters/DomainHost.cs:20-38` locates the unique AppDomain containing the pinned `LosSantosAlive` assembly and loads `LSA.PromotedCharacters.Runtime.dll` there.
- `native/intelligence/IntelligenceIntegration.cs:98-109` requires exactly one loaded `DamageTrackerLib`, pins its SHA-256, then constructs `DamageSensors`.
- `native/intelligence/IntelligenceIntegration.cs:166-167` creates/removes the subscription adapter according to the pin result.
- `native/intelligence/IntelligenceIntegration.cs:208` reports damage capability from `damage?.Running`.

This makes simple static-singleton separation between Essential and the LSA intelligence subscriber unlikely: they are intentionally hosted in the same Essential AppDomain.

## Important limitation of `DamageTrackerService.IsRunning`

Pinned `DamageTrackerLib.dll` SHA-256:

`64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750`

Repository metadata and prior IL inspection confirm the expected damage event API.

Upstream `DamageTrackerService` behavior at Variapolis/DamageTrackerFramework commit `c4e1009f9479ffd946b5f59892419a9fd87eb18f`:

- `DamageTrackerLib/DamageTrackerService.cs:54`: `IsRunning => _gameFiber != null`
- lines 66-76: `Start()` logs `DamageTrackerService Started` and then creates the consumer fiber
- lines 96-114: the fiber opens the named MMF, reads the whole buffer, deserializes it, then invokes damage events
- there is no local exception containment around MMF read/deserialization/event invocation
- lines 84-93: `Stop()` aborts the fiber but does not reset `_gameFiber` to null

So `IsRunning=true` means only that the service stored a fiber reference. It is **not a delivery heartbeat** and does not prove that the fiber is alive, deserializing successfully, or receiving producer frames.

## Producer prerequisite

The separate upstream producer is `DamageTrackingFramework`, not `DamageTrackerLib`.

Variapolis documents that:

1. `DamageTrackerLib.dll` and the plugin must be installed.
2. `DamageTrackerFramework` **must be started in RAGEPluginHook**.
3. Consumer plugins start `DamageTrackerService` and subscribe to its events.

Producer code at the same upstream commit:

- `DamageTrackingFramework/Entry.cs:16-23`: plugin entry creates the producer fiber with `DamageTracker.CheckPedsFiber`
- `DamageTrackingFramework/DamageTracker.cs:28-59`: producer enumerates all peds/vehicles, collects damage, serializes the lists, and writes them to the named MMF every yield

There is no explicit per-NPC or per-player registration prerequisite. Peds are discovered via `World.GetAllPeds()`.

For peds, `DamageTracker.cs:207-239` reads the native damage handler; if that data is unavailable, it falls back to health/armor loss. A hit before the producer establishes the initial health baseline could be missed, but repeated NPC kills plus player death should not be dismissed as "damage was not exercised."

## Runtime evidence supporting producer absence

A prior GTA Enhanced RPH log shows:

- `LosSantosAlive.dll` loaded
- `LSA.PromotedCharacters.dll` loaded
- `SmartVehicleEntry.dll` loaded
- `DamageTrackerService Started`
- Essential's `PedShotReflexDetector` reports `DamageTracker event subscription started`
- direct damage callback counters remain zero while independent `injury_state` and `death` counters increase

The same log does **not** show RPH loading a `DamageTrackingFramework` plugin and does not show its `GameFiber started!` startup message.

That is the strongest current evidence for "consumer running without producer."

## Packaging / deployment evidence

The P2/PS addon does not package the producer or DamageTracker library.

- `lsa-essential-e1-candidate/tools/buildCharactersAddon.mjs:26` verifies a compile-only pinned DamageTracker reference.
- `docs/PS0-PS1-perception-status.md:63-74` documents the compile-time reference and explicitly states that the SDK, DamageTracker, framework, and Essential DLLs are not deployed by this builder.

Therefore ACT2 deployment parity does not establish that the external `DamageTrackingFramework` producer was installed or running.

The October 6 ACT2 deployment record confirms the rebased stack was built and hash-deployed, but that is separate from the external DamageTracker producer prerequisite.

## Remaining plausible alternatives

If the October 6 RPH session did load the producer, remaining causes include:

1. Producer fiber starts and faults before writing useful data.
2. GTA V Enhanced invalidates the producer's native memory assumptions/offsets.
3. Consumer fiber faults on `BinaryFormatter.Deserialize`, a torn/stale MMF frame, or another subscriber throwing during multicast event invocation.
4. Producer and consumer use serialization-incompatible `DamageTrackerLib` builds across their separate RPH AppDomains.
5. A duplicate `DamageTrackerLib` exists inside the Essential AppDomain. LSA attempts to detect this and fail closed, making it less likely when damage capabilities are reported enabled.

A separate upstream vehicle issue is visible in `DamageTrackingFramework/DamageTracker.cs:86-89`: `HandleVehicle` returns when `veh.ExistsSafe()` is true. If present in the shipped producer, that could independently suppress vehicle tracking, but it does not explain both ped and player callbacks remaining zero.

## Can current evidence prove the root cause?

No.

It strongly establishes that the failure occurs before LSA callback entry and makes a missing/not-running producer the leading explanation. It does **not** yet prove the exact October 6 cause because the actual October 6 RPH plugin-load list and installed `DamageTrackingFramework.dll` identity have not been captured alongside the session.

Do not treat "producer missing" as confirmed until that runtime/install evidence is checked.

## Smallest discriminating diagnostic

If static inspection of the October 6 installed files/log cannot settle it, add only read-only diagnostics:

- report current AppDomain name
- report loaded `DamageTrackerLib` full assembly identity, path, and SHA-256
- report whether the named DamageTracker MMF remains all-zero or receives/churns nonzero bytes
- do not deserialize or log damage payload contents

Minimal GTA probe:

1. idle ~10 seconds
2. damage one NPC once
3. let the player take one hit
4. capture the MMF-state diagnostic and callback counters

Interpretation:

- **MMF stays zero:** producer absent/not started/dead before write
- **MMF changes but callbacks remain zero:** producer is writing; failure is consumer/deserialization/event delivery
- **callbacks increment:** transport/event delivery works and investigation moves downstream

No speculative runtime fix should be applied until this boundary is distinguished.
