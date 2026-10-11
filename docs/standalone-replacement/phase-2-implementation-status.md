# Phase 2 — independent RAGE host and native↔Node transport: engineering handoff

**Branch:** `feature/standalone-phase2-host-transport`, draft PR #42, stacked on Phase 1 PR #40 and Phase 0 PR #38.  
**Decision:** Phase 2 source implementation and offline acceptance candidate. **No GTA installation or in-game validation**. The standalone project is a full replacement effort, **not** a fallback or Essential coexistence strategy.

## Production implementation

| Workstream | Implemented | Evidence / remaining physical gate |
| --- | --- | --- |
| Independent RAGE host | New real `LSA.Standalone.RageHost` net481 DLL with `[Plugin]` entry/exit, separate single owner-fiber loop, owner-scope (never spans yield), world and clock gates, bounded owner IPC dispatcher and idempotent shutdown. Does not reference, load or search the old Essential AppDomain. | Windows build against **published RPH 1.124.0 SDK** in CI and compile-only stub. Must compile against actual installed RPH and test plugin load/unload in GTA Enhanced. |
| Exclusive mode | Operator-created standalone mode marker, prelaunch read-only profile verifier and runtime refusal of known legacy payloads. Cross-domain/process exclusive FileStream handle prevents duplicate standalone ownership. | Fully verify RPH enabled-plugin list and no renamed or dynamically loaded Essential; no cooperation assumed from Essential. No hot takeover. |
| Physical actor lifecycle | Real `RageActorResolver` resolves `Ped` through `World.GetEntityByHandle`, validates ped alive/address/mission lock and two GTA int decorators used as a 64-bit native lifetime cookie. Phase 1 core now retains and revalidates the immutable observed cookie in registration, lease authorization and reconciliation, detecting same-handle + same-address replacement **when its tag changes**. | **Fail-closed gate remains disabled** in game until tag registration/readback and destruction/reuse behavior are physically confirmed. No global destruction event is assumed. |
| Native-owned turn rights | `NativeTurnRegistry` issues exact native-only conversation tickets with turn/session/actor incarnation/lease/generation, requires one exact confirmation, permits exact cancellation and retires all on disconnect/world reset. Node cannot create an actor or a native lease. | Phase 3 is responsible for a real game-sourced typed/voice turn producer and Luna/provider wiring. The host does not issue player turns yet. |
| Full-duplex IPC | Current-user ACL named pipe `LSA.Standalone.Phase2.v1`, bounded length-prefixed JSON metadata, fresh host/transport identity and world epoch, strict per-direction sequences, command shape checks, timeout, bounded game-fiber work queue, unsupported effects rejected. Native-issued permits exposed via `turn.next`; only exact `turn.confirm` / `turn.cancel` acknowledged. | Binary PCM playback transport and device/audio adapters belong to Phase 4; action execution belongs to Phase 7. No physical effects can be triggered through this Phase 2 pipe. |
| Independent Node process | `lsa-standalone-companion/service.mjs` starts without `server.bundle.mjs`. Automatic health heartbeats and bounded retry after disconnect; each new connection obtains a fresh transport/run claim, with **zero replay** of retired turns. The independent CLI inspects health/snapshot. | Provider bootstrap, input-to-model interaction and durable conversation policies belong to Phase 3. |

## Executed tests and evidence

The dedicated `Standalone Phase 2 Host and IPC` workflow:
- Runs the same Phase 1 production core under `net10` tests with actual `net481` Release compilation and **22,114** native assertions (including new lifetime-tag ABA and native turn confirmation/cancellation/replay checks).
- Runs Node transport and reconnect tests: malformed/partial/oversized UTF-8 framing, version handshake, exact world identity, session disconnection, wrong sequence, in-flight retirement and fresh transport identity.
- Builds `LSA.Standalone.RageHost.dll` with the approved test stub and the *published* real RPH 1.124.0 package (the package is restored for CI only and not redistributed).
- Launches the **actual .NET Framework** test-harness process, exchanges native health and snapshot frames with the separate Node CLI, then obtains a native-issued fixture turn, denies a spoofed lease and replayed confirmation, and confirms exact cancellation.
- Validates a standalone-only mock install profile and rejection of a legacy Essential payload (read-only preflight).

Actual CI acceptance is established **only** by a green final run for the matching branch head; do not infer that each individual intermediate commit passed. See [Phase 2 workflow](../../.github/workflows/standalone-phase2.yml).

## Deliberate safety boundaries and deferred work

1. **Cannot physically prove in this web development environment:** installed GTA Enhanced/RPH build, game fiber identity on load/unload, whether the decorator registry is available/locked, whether a deleted and reused entity can retain an old cookie, or mod coexistence. [Controlled game acceptance](phase-2-gta-acceptance.md) remains required.
2. The production adapter's `allowExperimentalAdoption=false` is deliberate; therefore this Phase 2 host cannot start playing, listening, speaking or acting on an NPC. This is **not** a playable Essential replacement yet.
3. Reused identical handle/address **and identical cookie** is still a possible unknown until native physical lifecycle testing. Do not silently enable fallback address-only actor authority.
4. Phase 3 adds genuine native player input/target turns, AI request/answer scheduling and history; Phase 4 implements actual binary PCM and spatial audio; later phases implement behavior/perception and parity. They are not Phase 2 deliverables.
5. No build output, SDK, DLL, patched Essential backend, game mod files, personal configs or credentials have been deployed to GTA or added to the repository.

## Commands

```powershell
dotnet build native/standalone/LSA.Standalone.Core.csproj -f net481 -c Release
dotnet run --project native/standalone/tests/LSA.Standalone.Core.Tests.csproj -f net10.0 -c Release
node --test lsa-standalone-companion/tests/*.test.mjs

# Build against a real SDK you are allowed to use, installed or restored:
dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -p:RphReferencePath="<path to RagePluginHook.dll>"
dotnet build native/standalone-host/tests/Phase2PipeHarness.csproj -c Release

# Only in an isolated fixture (or after a controlled physical acceptance):
node lsa-standalone-companion/tools/health-check.mjs
node lsa-standalone-companion/service.mjs
```

**Gate disposition:** GO for Phase 3 implementation independently of GTA; NO-GO for gameplay deployment or enabling physical actor effects until physical acceptance is provided.
