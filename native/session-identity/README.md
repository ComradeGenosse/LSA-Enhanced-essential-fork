# Optional explicit-owner identity addon

`LSA.SessionIdentity.dll` uses the public Essential `IIntegration` seam. It is a library explicitly installed by an authored owner plugin; it has no game plugin entry point, auto-loader, spawn/task/delete logic, session allocator, or playback/action API. Normal companion builds do not deploy it.

## Compatibility and build

The pinned Essential DLL targets .NET 4.8.1. Supply a .NET SDK, compile-only .NET 4.8.1 framework reference assemblies, and the compile-only RPH SDK DLL. No running GTA process or game installation path is used.

| Reference | SHA-256 |
| --- | --- |
| `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll` | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| RPH SDK `RagePluginHook.dll` | `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0` |

From the repository root, after supplying these reference paths:

```powershell
$env:LSA_IDENTITY_RPH_REFERENCE = '<compile-only SDK>\RagePluginHook.dll'
$env:LSA_IDENTITY_FRAMEWORK_ROOT = '<framework reference root containing .NETFramework\v4.8.1>'
dotnet restore native/session-identity/SessionIdentity.csproj --ignore-failed-sources "-p:RphReferencePath=$env:LSA_IDENTITY_RPH_REFERENCE" "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
cd lsa-essential-e1-candidate
node tools/buildIdentityAddon.mjs
```

`buildIdentityAddon` verifies both assembly hashes and the separate pinned identity metadata/signatures before compiling. It writes only to `dist/session-identity/` and records the addon hash, references, and `deploymentPerformed: false`. It copies neither dependency DLL. The integration checks the actual loaded Essential DLL at startup; mismatch leaves optional evidence unavailable. `EnrichActor` and `Update` perform no disk reads.

Missing optional identity evidence disables P1 at companion bootstrap while leaving mandatory E1 checks in force. A mismatched mandatory E1 DLL/bundle/metadata still fails the normal candidate build.

## Owner API

The plugin that owns the entity also owns the registration token and its cleanup. Calls belong on an active RAGE game fiber. The integration and Core update fibers may have different managed thread IDs; the store checks RAGE's active-fiber state rather than pinning access to its construction thread. Ordinary background threads, including pipe workers, cannot access the store. Use a stable lowercase UUID-v4 world profile shared with companion config and a bounded immutable authored source key (1–128 characters, at most 256 UTF-8 bytes). Neither the ped handle nor appearance is an alias.

```csharp
// ownedPed already belongs to this authored plugin. No entity is created here.
var integration = SessionIdentityIntegration.Install();
if (integration.IsAvailable)
{
    var token = integration.Owner.Register(
        ownedPed, "companion.alex", "e54d56bd-4e43-4ab0-91ea-a188a04e3b90");
    // Owner cleanup: retire this exact token before deleting/recreating its ped.
    integration.Owner.Retire(token);
    // A recreation must Register again, minting a new incarnation/revision.
}
```

`AuthoredTestOwner.RegisterAlex(ownedPed, worldProfileId)` is the same bounded test seam. A null result means the optional source is unavailable. `TryResolveCurrent` is factual; it grants no native execution authority. Duplicate live aliases conflict permanently until explicit owner retire/re-register. Stale tokens cannot retire a newer registration. The roster is capped at 64 and starts empty on integration restart or regressed game time.

Essential calls the registered integration's public lifecycle callbacks. `OnPedControlChanged` and `OnNpcActionExecuted` are no-ops: temporary control release and action completion are not destruction. The owner must still retire associations it replaces; existence/death checks supplement that responsibility. Physical handle validity and callback/fiber cadence remain in the GTA checklist.

## Evidence transport

`EnrichActor` validates `ActorContext.PedId` and emits a small JSON claim in `IntegrationJsonBlock("sessionIdentity", ...)`. It uses only the in-memory roster. A separately queued local named-pipe proof checks that block against the owner's current ledger.

The pipe is protected to the current Windows user's SID and accepts only correlated identity verification. Its worker never accesses a ped, mints a claim, or renews the game-fiber lease. Update validates the roster, handles at most 16 questions, and queues 250 ms heartbeats. The companion expires its lease after 1.5 seconds and retires only exact registered sessions. Revoke facts carry epoch/ped/incarnation/revision. Frames and queues are bounded; unrecognized/gameplay commands disconnect.

The installed owner and same-user local processes are the trust boundary. This is not authentication against a malicious process running as that Windows user. An arbitrary JSON block alone is insufficient authority. The pipe name can be supplied to `Install` before its first call and must match companion config.

## Offline tests

From the repository root:

```powershell
dotnet run --project native/session-identity/tests/OfflineTests.csproj --verbosity quiet
dotnet build native/session-identity/facts-tests/OwnerFactsTests.csproj "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/session-identity/facts-tests/bin/Debug/net481/OwnerFactsTests.exe
cd lsa-essential-e1-candidate
node tools/runTests.mjs
node tools/buildCandidate.mjs
```

The evidence-store test uses .NET 10 and compiles the production store source without a game reference. The Windows pipe test compiles the production store/channel against .NET 4.8.1 and also has no game references. It verifies real ACL-capable pipe handshake, fresh proof, revoke, heartbeat, and rejection of gameplay frames. Neither test executes the addon or loads Essential/RPH assemblies. The Node fixture contains only a synthetic claim minted by that core test.

Build-time verification remains separate from GTA acceptance. The merged P2 promoted-character flow now exercises this P1 owner/identity foundation in live GTA, but the dedicated P1 recreation/revocation/stale-work stress checklist is still useful follow-up coverage. See [P1 status and controlled GTA checklist](../../docs/P1-session-identity-status.md).
