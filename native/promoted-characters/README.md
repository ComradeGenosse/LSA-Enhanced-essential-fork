# Optional P2 authored owner plugin

`LSA.PromotedCharacters.dll` is a `net481` RAGE loader. Its private runtime implements Essential's public `IIntegration` inside the existing Essential AppDomain. It owns promoted/recreated peds through the unchanged `LSA.SessionIdentity.dll` authored seam. It adds no dialogue protocol, nonce allocator, model tool, PCM route or task scheduler.

From the candidate directory, supply the same compile-only references as P1:

```powershell
$env:LSA_IDENTITY_RPH_REFERENCE = '<compile-only SDK>\RagePluginHook.dll'
$env:LSA_IDENTITY_FRAMEWORK_ROOT = '<reference root containing .NETFramework\v4.8.1>'
$env:LSA_INTELLIGENCE_DAMAGE_REFERENCE = '<compile-only shipped>\DamageTrackerLib.dll'
$env:LSA_RNUI_REFERENCE = '<NuGet RAGENativeUI 1.9.3>\lib\net472\RAGENativeUI.dll'
node tools/buildCharactersAddon.mjs
```

The builder verifies pinned Essential/RPH hashes and the P1 contract, restores/builds against reference assemblies, and packages the loader, command-free bootstrap, private runtime and P1 library plus a disabled example config under `dist/promoted-characters`, together with a disabled `LSA.Enhanced.example.json` for the UX phase 2–3 input router and menu. `LSA_BUILD_DOTNET` may explicitly name a .NET executable when it is not on PATH. Build receipts state `deploymentPerformed: false` and `gtaRuntimeTest: false`. Dependency/core/game DLLs are never copied or deployed by this builder.

Install the loader and JSON config directly in `plugins`. Install `LSA.PromotedCharacters.Bootstrap.dll`, `LSA.PromotedCharacters.Runtime.dll` and `LSA.SessionIdentity.dll` in `plugins/LSA.PromotedCharacters/`. Only the loader is a RAGE plugin; the P1 library must not be loaded independently. Copy the example config to `LSA.PromotedCharacters.json`, enable it and use the same stable lowercase world UUID and pipe names as the companion. RAGE can load the loader explicitly or through its load-all selection. The loader locates the existing Essential AppDomain and checks its already loaded Core hash before installing integrations there. Generic source examples remain disabled; deployment may enable them explicitly. The loader compiles against a hash-pinned RAGENativeUI 1.9.3 reference but never ships it: the native menu uses the copy Essential's payload installs and requires assembly version 1.9.3.0, otherwise only the menu is disabled. See [host correction and evidence](../../docs/P2-rage-host-correction.md).

Match native `editorPort` to companion `promotedCharacters.editorPort`. Existing RAGE console inputs are `LSACharacters`, `LSAPromote`, `LSAFollowPromoted`, `LSAWaitPromoted`, `LSADismissPromoted`, `LSASummonCharacter <CharacterId>` and `LSADespawnCharacter <CharacterId>`. The last two take the exact durable ID displayed in the editor. UX phase 1 adds two bridge commands: `LSACurrentNpc` shows Essential's current NPC and input gates, and `LSAAskCurrent "<request>"` sends a typed request to that NPC through Essential's own text input (see [UX phase 0–1 status](../../docs/UX-phase0-1-status.md)). UX phase 3 adds `LSAMenu`, which opens the native LSA menu when `Plugins/LSA.Enhanced.json` enables it. The loader also hosts the phase 2 input router (L4/R4 gestures) and the phase 3 menu on one fiber; both are off by default (see [UX phase 2–3 status](../../docs/UX-phase2-3-status.md) and [controller setup](../../docs/controller-setup.md)). Live controls require a ticking game; close the console after submission. The HTTP worker never touches a ped and permits only one outstanding console operation. It reads the editor token from the companion's per-user endpoint file, `%LOCALAPPDATA%\LSA Enhanced\control-endpoint.v1.json`, and falls back to the editor page when that file is missing or stale. Profile/memory editing works in the local editor while GTA is paused or offline.

The native integration keeps at most 256 RAM encounter records, 16 capture tickets, and P1's 64 live authored registrations. It handles at most four queued player operations per Essential Update, a budget shared with the loader's bridge commands (`DomainHost.Submit`, strings only, executed in Update). The private `ControlChannel` is a separate current-user ACL pipe with fresh owner epoch, world UUID, and per-request UUID. Ordinary controls retain a 5-second admission bound and short completion wait. Explicit `spawn` requests may wait up to 60 seconds (30 seconds by default, configured by the companion's `promotedCharacters.summonWaitMs`); expiry is checked on the game fiber and cancelled requests cannot spawn after gameplay resumes. Worker threads only parse/queue bounded JSON. The P1 factual pipe remains factual and rejects controls/audio.

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

The same loader/runtime now also hosts merged UX4 talk targeting. UX4 can share Essential's existing Talk key without changing the controller binding. A normal hold performs direct Talk with no bracket; a tap enters explicit target selection/cycling, and the bracket fades independently of the target lifetime. See [UX4 status](../../docs/UX4-talk-targeting-status.md) and [controller setup](../../docs/controller-setup.md).

The same private runtime includes optional PS0/PS1 perception. Its `intelligence.mode` defaults to `off`; `shadow` uses a separate output-only factual channel without model context, memories or actions. No additional plugin or DamageTracker service is created. See [PS0/PS1 status, bounds and physical checklist](../../docs/PS0-PS1-perception-status.md).

Clock recovery checks link the production integration and Windows pipe code against strict game substitutes:

```powershell
dotnet build native/promoted-characters/lifecycle-tests/LifecycleTests.csproj -c Release "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/promoted-characters/lifecycle-tests/bin/Release/net481/LifecycleTests.exe
```

The UX phase 1 bridge links the real `DomainHost`, the production runtime sources and the real console frontend against game substitutes in a separate Essential test domain (it also runs under Mono):

```powershell
dotnet build native/promoted-characters/bridge-tests/BridgeTests.csproj -c Release "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/promoted-characters/bridge-tests/bin/Release/net481/BridgeTests.exe
```

The UX phase 2–3 router, dispatcher, view models and RNUI guard are tested without RAGE, Windows input or a companion (also under Mono):

```powershell
dotnet build native/enhanced/input-tests/InputTests.csproj -c Release "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/enhanced/input-tests/bin/Release/net481/InputTests.exe
```

On a game-clock reset, P2 cancels old requests and retires live associations before starting a new owner epoch. No ped tasks or automatic re-adoption occur. The console frontend remains loaded through native-host failures and explains when controls are unavailable. Startup diagnostics are bounded and do not register additional commands.
