# Phase 1 — LSA.Standalone.Core

**Implementation:** independent native policy library; no GTA deployment, RAGE host, Node protocol or audio device implementation yet. This project is intentionally separate from `native/promoted-characters`, and does not reference, load or copy the Essential DLL.

## Actual production-code boundary

`LSA.Standalone.Core.csproj` compiles the **same C# sources** into `net481` (the intended RAGE .NET Framework library contract) and `net10.0` (deterministic offline verification). The game abstraction interfaces in `Contracts.cs` are design seams and not working GTA adapters. `NativeAuthority` is production state-machine logic, not a test-only mock.

- `IActorResolver`: resolves physical native handle/address and current life/script-controlled status. `ActorRef` is a per-run/epoch/incarnation physical identity, *not* a persistent character ID.
- `IOwnerContext`: future real RAGE adapter verifies game **fiber** ownership; the core also checks constructing OS thread. Simulation changes `IsOwner` to check fail-closed behavior.
- `IGameWorld`, `IGameClock`: safe world gate and monotonic source time. Clock regression bumps the world epoch and revokes all outstanding actors/leases.
- `IInputSource`, `IAudioOutput`, `IActionExecutor`: explicit contracts for later phases. Action dispatch acknowledges an accepted request separately from `PhysicalCompletionConfirmed`.
- `NativeAuthority`: authoritative actor tracking and per-lane (`Conversation`, `Audio`, `PhysicalAction`, `Input`) exact-generation ownership leases. Supersession is compare-and-swap, not an unbounded force switch. Scripts/world safety invalidate held claims rather than allowing work to reappear afterward.
- `tests/SimulatedGame.cs`: deterministic fake world and actor resolver. It substitutes only game observation/time; all lease logic is **the same production code**.

**Identity limitation:** without an actual GTA entity-lifetime signal, identical handle+address recycled without a terminal observation cannot be detected from static snapshots alone. The real adapter **must** revoke an actor incarnation on despawn/invalidity/world switch or stronger native lifetime evidence. This remains a Phase 2/5 physical acceptance gate, not a proven solution.

## Run independently

```bash
dotnet restore native/standalone/LSA.Standalone.Core.csproj
dotnet build native/standalone/LSA.Standalone.Core.csproj -f net481 -c Release
dotnet run --project native/standalone/tests/LSA.Standalone.Core.Tests.csproj -f net10.0 -c Release
```

`.github/workflows/standalone-phase1.yml` runs these commands on Windows and reads the compiled **net481** assembly's references. It rejects any compiled dependency on Essential, RAGE or other LSA runtime assemblies.

## Current phase gate

Phase 1 is an **initial independent core implementation**, not an integration candidate. Before beginning Phase 2 we should close remaining interface/schema decisions, add one actor/lease event trace export, and verify the `net481` release build and safety matrix in CI. Real RAGE plugin load and two-process transport remain Phase 2; real spatial playback remains Phase 4–5.
