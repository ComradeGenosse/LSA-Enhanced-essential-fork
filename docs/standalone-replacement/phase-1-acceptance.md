# Phase 1 — independent native core acceptance

**Scope:** the core library and its simulation harness, not a playable GTA plugin.  
**Branch:** `feature/standalone-native-core-phase1`, stacked on Phase 0 PR #38.  
**State:** **implementation complete for the Phase 1 core boundary; offline Windows gate pending matching final CI**. The documented acceptance gate is the exact branch HEAD's `Standalone Phase 1 Native Core` workflow result.

## Production code

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Genuine independent compiled .NET DLL | `native/standalone/LSA.Standalone.Core.csproj` builds `net481` and `net10.0` from identical production sources | Windows CI builds actual Release `net481` and checks compiled assembly references |
| Essential and GTA runtime not loaded | Only `Contracts.cs`, `ActorIdentity.cs`, `NativeAuthority.cs`, `AuthorityTrace.cs`; no current native plugin referenced | Compiled assembly reference check rejects `LosSantosAlive`, `RagePluginHook` and existing LSA native assemblies |
| Explicit native boundary | `IGameClock`, `IGameWorld`, `IActorResolver`, `IOwnerContext`, `IInputSource`, `IAudioOutput`, `IActionExecutor` | The same production core compiles for Windows .NET Framework and offline test runtime |
| Physical identity | Immutable `ActorRef` with host run, epoch, handle, address, incarnation; durable profile ID excluded | Re-register/retire/handle-reuse/world-reset scenarios |
| Game-fiber ownership | OS thread check **and pluggable fiber predicate** | Wrong-thread and explicit wrong-owner context tests; the actual RAGE predicate remains Phase 2 |
| Single active owner per actor/lane | Separate bounded TTL leases for conversation, input, audio, physical actions; exact token + generation on supersession | Busy-owner, CAS supersession, old-token release, expiration, generation tests |
| Fail closed on bad world state | Native observation failure, dead/despawned actor, new address, script control, unsafe world, world/clock read faults | Unit simulations, continuous `Reconcile()`, seeded replay of mixed event sequences |
| Bounded evidence | Immutable, monotonically numbered `AuthorityEvent`, max 256 retained records, dropped counter; no transcripts, voice or owner-name strings | Snapshot content/ordering/bounding/revocation tests |
| Physically truthful actions | `IActionExecutor` requires `PhysicalAction` lease, and `Dispatched` differs from `PhysicalCompletionConfirmed` | Interface compiled; **no physical completion acceptance until Phase 7 real adapter and GTA tests** |

## Critical safety and behavioral contracts

- All effect adapters must validate `NativeAuthority.IsLeaseCurrent(lease)` immediately before acting, including **every PCM push**, and require the correct `LeaseKind`. Holding an `ActorRef` alone is **not** authorization.
- The native owner fiber must call `Reconcile()` during its update loop. This permanently revokes active leases when a scripted takeover, actor death/missing observation, unsafe game state or inconsistent physical identity is observed.
- The real adapter must explicitly call `RetireActor` when an entity despawns. **An unobserved disappearance/reappearance reusing the identical handle AND address cannot be inferred from a static snapshot**, so an actual lifetime event or stronger incarnation evidence is required before Phase 5.
- The `IOwnerContext` predicate will be supplied by the RAGE host in Phase 2; these tests establish the contract and fail-closed state machine, **not** proof of correct RAGE game-fiber identification.
- `ReadTrace()` is an owner-fiber-only in-memory diagnostic; Phase 2 must choose the versioned/logged format and cross-process trace export. It must not expose private owner strings, API keys, dialogue, or unbounded data.
- There is no independent model transport, microphone, TTS device, physical action adapter, command-line RAGE loader or installation in this phase. Do not label the state machine `GTA accepted`.

## Tests / reproducible commands

```bash
dotnet restore native/standalone/LSA.Standalone.Core.csproj
dotnet build native/standalone/LSA.Standalone.Core.csproj -f net481 -c Release
dotnet run --project native/standalone/tests/LSA.Standalone.Core.Tests.csproj -f net10.0 -c Release
```

`.github/workflows/standalone-phase1.yml` runs this on Windows and checks the actual compiled `net481` assembly dependency list, in addition to the simulation.

## Phase 2 handoff

1. New `LSA.Standalone` RAGE host entrypoint in an isolated project; never import the existing Essential bootstrapping class.
2. Process-wide exclusive controller mode and active-RAGE game-fiber adapter; refuse plugin activation if Essential is already acting as native controller.
3. Bind real RAGE observations to `IActorResolver` and call `Reconcile()` on the approved fiber, then verify world resets/handle retirement.
4. Introduce a versioned, bounded, exact identity/turn native↔Node transport following [Phase 0 protocol audit](phase-0-protocol-audio.md).
5. Continue offline integration tests and preserve real GTA physical acceptance gates. **Do not deploy Phase 1 alone:** it contains no game host or audio.

**No changes to `main`, existing stock server, GTA installation, P2 profiles, or original Essential DLL.**
