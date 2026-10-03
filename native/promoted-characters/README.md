# Optional P2 authored owner plugin

`LSA.PromotedCharacters.dll` is a `net481` RAGE loader. Its private runtime implements Essential's public `IIntegration` inside the existing Essential AppDomain. It owns promoted/recreated peds through the unchanged `LSA.SessionIdentity.dll` authored seam. It adds no dialogue protocol, nonce allocator, model tool, PCM route or task scheduler.

From the candidate directory, supply the same compile-only references as P1:

```powershell
$env:LSA_IDENTITY_RPH_REFERENCE = '<compile-only SDK>\RagePluginHook.dll'
$env:LSA_IDENTITY_FRAMEWORK_ROOT = '<reference root containing .NETFramework\v4.8.1>'
node tools/buildCharactersAddon.mjs
```

The builder verifies pinned Essential/RPH hashes and the P1 contract, restores/builds against reference assemblies, and packages the loader, command-free bootstrap, private runtime and P1 library plus a disabled example config under `dist/promoted-characters`. `LSA_BUILD_DOTNET` may explicitly name a .NET executable when it is not on PATH. Build receipts state `deploymentPerformed: false` and `gtaRuntimeTest: false`. Dependency/core/game DLLs are never copied or deployed by this builder.

Install the loader and JSON config directly in `plugins`. Install `LSA.PromotedCharacters.Bootstrap.dll`, `LSA.PromotedCharacters.Runtime.dll` and `LSA.SessionIdentity.dll` in `plugins/LSA.PromotedCharacters/`. Only the loader is a RAGE plugin; the P1 library must not be loaded independently. Copy the example config to `LSA.PromotedCharacters.json`, enable it and use the same stable lowercase world UUID and pipe names as the companion. RAGE can load the loader explicitly or through its load-all selection. The loader locates the existing Essential AppDomain and checks its already loaded Core hash before installing integrations there. Generic source examples remain disabled; deployment may enable them explicitly. No RAGENativeUI dependency is required. See [host correction and evidence](../../docs/P2-rage-host-correction.md).

Match native `editorPort` to companion `promotedCharacters.editorPort`. Existing RAGE console inputs are `LSACharacters`, `LSAPromote`, `LSAFollowPromoted`, `LSAWaitPromoted`, `LSADismissPromoted`, `LSASummonCharacter <CharacterId>` and `LSADespawnCharacter <CharacterId>`. The last two take the exact durable ID displayed in the editor. Live controls require a ticking game; close the console after submission. The HTTP worker never touches a ped and permits only one outstanding console operation. Profile/memory editing works in the local editor while GTA is paused or offline.

The native integration keeps at most 256 RAM encounter records, 16 capture tickets, and P1's 64 live authored registrations. It handles at most four queued player operations per Essential Update. The private `ControlChannel` is a separate current-user ACL pipe with fresh owner epoch, world UUID, and per-request UUID. Ordinary controls retain a 5-second admission bound and short completion wait. Explicit `spawn` requests may wait up to 60 seconds (30 seconds by default, configured by the companion's `promotedCharacters.summonWaitMs`); expiry is checked on the game fiber and cancelled requests cannot spawn after gameplay resumes. Worker threads only parse/queue bounded JSON. The P1 factual pipe remains factual and rejects controls/audio.

Promotion capture locks the exact current selected/conversation ped, then rechecks selection/existence/address/script state at registration. The stable alias is an application-generated `promoted.<UUID>`, never a handle or name. Follow/wait use public `NpcActions` and existing state/vehicle flags. Every later native player command carries the captured current ownership token. Old tokens cannot act on recreated peds. Dialogue/model effects still use Essential's exact tagged native tuple.

Dismiss/release retire the exact P1 registration before safe native release. Only `despawn` can delete and only for a ped this addon constructed. Adopted ambient peds are never deleted by P2. Scripted state suspends optional native flags without clearing Rockstar tasks, deleting or teleporting. Automatic mission rejoin is intentionally absent; the player chooses a safe follow/wait after suspension. On addon unload, registered proof is retired; safe created peds are dismissed. Unknown guarded peds are left physically alone.

Offline checks from repository root:

```powershell
dotnet run --project native/promoted-characters/tests/OfflineTests.csproj --verbosity quiet
dotnet build native/promoted-characters/facts-tests/ControlChannelTests.csproj "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/promoted-characters/facts-tests/bin/Debug/net481/ControlChannelTests.exe
```

The first compiles the production safety/admission source with .NET 10. The second compiles the actual Windows control pipe/parser with .NET 4.8.1 against no game references, using a unique offline pipe. The production parser accepts its actual nested `IList` array representation for appearance; this is checked by the real framework serializer test. No test here loads RPH/Essential or exercises GTA.

See [P2 flow, persistence, limits and physical checklist](../../docs/P2-promoted-characters-status.md) and [focused native evidence](../../docs/P2-native-evidence.md).

Clock recovery checks link the production integration and Windows pipe code against strict game substitutes:

```powershell
dotnet build native/promoted-characters/lifecycle-tests/LifecycleTests.csproj -c Release "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/promoted-characters/lifecycle-tests/bin/Release/net481/LifecycleTests.exe
```

On a game-clock reset, P2 cancels old requests and retires live associations before starting a new owner epoch. No ped tasks or automatic re-adoption occur. The console frontend remains loaded through native-host failures and explains when controls are unavailable. Startup diagnostics are bounded and do not register additional commands.
