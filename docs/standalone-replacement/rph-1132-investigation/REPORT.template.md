# RPH 1.132 / LSA PR #50 — Evidence-Based Compatibility Investigation

**Date:** 2026-10-18 · **Model:** Claude Opus 5.5 (full redo) · **Mode:** offline, read-only static analysis
**Supersedes:** the earlier report on branch `analysis/rph-1132-investigation`, part of which was produced on a
different model after an unannounced mid-session switch. Nothing from that report is relied on here; every result
below was regenerated in this pass. Material corrections are listed in §0.

**Scope.** How RAGE Plugin Hook (RPH) `1.132.1428.17748` provides its managed API, and whether the LSA standalone
host in PR #50 binds to it — reconciled against the actual binaries, CI artifacts and your GTA logs. Investigation
and planning only: no production source changed, nothing deployed, GTA not launched, no PR merged, the installation
untouched.

- PR #50 head analysed: `9933290ba9a6ec8213b054a61026c0f5cedbb689` (`refs/pull/50/head`; CI run 39129868947 green).
- Analysis branch/worktree: `analysis/rph-1132-investigation-opus55` (local only; not pushed).
- Confidence labels: **PROVEN** (directly shown by inspected binaries, metadata, logs or a reproduced build),
  **STRONGLY SUPPORTED** (several consistent sources, not complete proof), **UNKNOWN** (insufficient evidence).

---

## TL;DR

1. **Both GTA crashes were caused by compiling the host against the project's *fake* test SDK** — not by an RPH
   API change. The deployed `b5cd53f` host carries 11 imports the real RPH API does not have; `5884d8b` carries 10
   (it fixed only `GameTime`). The CI artifacts are byte-identical to what was deployed. *(PROVEN)*
2. **The exact failure points are now pinned.** `b5cd53f`: `EntryPoint.Main` itself could not be JIT-compiled
   (`Int32 Rage.Game.get_GameTime()` is in its own body), so none of its code ran. `5884d8b`: `Main` ran and
   caught a failure from `RageActorResolver..ctor`, whose only unresolvable import is
   `NativeFunction.CallByName<T>(string, object[])`. Both are checked against your logs. *(PROVEN / deduced)*
3. **Why CI shipped it:** MSBuild resolved `RagePluginHook` to the fake SDK build output via
   `{CandidateAssemblyFiles}`, which outranks the HintPath; the "official `-t:Rebuild`" produced a byte-identical
   fake-SDK DLL, and the 5884d8b audit only checked `get_GameTime`. Reproduced from scratch. *(PROVEN)*
4. **The current head is correct at the binary level.** Rebuilt in CI order against the official SDK, it has 14 type
   imports, 33 member imports, 4 generic instantiations and 18 attribute named arguments — **0 unresolved**. Two
   independent matchers and the repo's own auditor agree. **Each of the 37 member/instantiation imports also has
   independent 1.132 evidence:** 34 are used by LSPDFR (shipped with this runtime), 2 more by your Essential (which
   has run on it), and the last, `GameFiber.CanSleepNow`, executed on your machine. *(PROVEN static; STRONGLY
   SUPPORTED at runtime)*
5. **There is no RPH API DLL on disk, by design.** The launcher carries the managed `Rage` API in a packed payload
   and serves it to per-plugin AppDomains at runtime. A scan of all 99 PE files in your install finds no other
   definer of `Rage.*` types. *(PROVEN)*
6. **Your own 1.132 runtime proves 4 of the head's RPH imports by execution**, in the exact hash-verified 5884d8b
   build. They include `UInt32 Rage.Game.get_GameTime()`: 5884d8b's `Main` JIT-compiled and ran. The same run
   proves `LSA.Standalone.Core` loads through `AssemblyProbingPaths`.
7. **New issues the first pass missed:** the ExitPoint signature violates RPH's documented contract; the host's
   catch discards the exception message (why 08:17 lost the member name); one `GetEntityByHandle` call is
   unguarded against a documented throw; the csproj gate rejects the official 1.131 SDK filename; and console
   command registration and decorator registration must be confirmed on the first run.

---

## 0. Corrections to the superseded report

| Earlier claim | Corrected finding | Basis |
|---|---|---|
| "786 of LSPDFR's RPH member references resolve" | **692** RPH members (+85 types, 16 generic instantiations, 36 attribute args). The 786 included mscorlib/self members merely *instantiated over* RPH types (e.g. `Dictionary<int,Rage.Vector3>::.ctor`). | Fixed matcher; counts now equal the repo auditor's for every plugin |
| "LSPDFR … known to load on 1.132" | LSPDFR was loaded in **0 of 162** of your sessions. It is evidence only by virtue of shipping in the official 1.132 Enhanced installer. Your own plugins are the runtime-evidenced controls. | Log scan |
| 5884d8b "next member the JIT needs" (unspecified) | `RageActorResolver..ctor` → `NativeFunction.CallByName<T>(string, object[])` | §E.3 |
| (not found) | ExitPoint signature mismatch; message-less catch; unguarded `GetEntityByHandle`; probing-path lifetime; console-command and decorator registration checks | §D.4, §G |

---

## A. Binary inventory

The SHA-256 values below are of the copies analysed here (staged from your PC at ~13:33 UTC). These files were
re-hashed read-only on your PC at 14:45 UTC and again at the end, at 18:30 UTC. The check covers the 14 rows that
exist there as files, the switcher copy of the `b5cd53f` payload, and all five archives: 22 files, each check
verified against a digest computed on the PC (`evidence/pc-hash-check*.txt`). **Both times, 18 are byte-identical.
The other 4 are the Promoted Characters family** (`LSA.PromotedCharacters`, `.Runtime`, `.Bootstrap`,
`LSA.SessionIdentity`). **They were replaced on your PC several times while this analysis ran**: first at 14:22 UTC,
and the latest build seen is dated 18:29 UTC. Their rows therefore describe the builds that were analysed. No
conclusion in this report depends on those four files (§D.2).
Files that exist only inside archives (SDKs, LSPDFR, CI payloads) were hashed after extraction, and their archives
match. Proprietary binaries were analysed in place and are not included in any output.

{{INVENTORY_TABLE}}

Archives (SHA-256): NuGet `ragepluginhook.1.124.0.nupkg` `B48E24AA586A73B5F1F3B220EA7EB7576D388A52446A11D69FA29842F8508C36`; 1.131 ZIP
`4751D4B2FBFC7CD0B3F901D711D1D4C245FEF774082AB87F9FED52A49EF3E159`; 1.132 installer `lspdfr_049_9695_Manual_Install_Enhanced_1158_16.zip`
`8524E534F219C7F33634ED45CED055F3C7B0B461FA8302FF2F0AC46470C7ED34` (Downloads and Codex copies identical); CI smoke ZIPs —
`b5cd53f` `CA07E3BE0CCFB70323C2F64DDE9E82BCB128E30035E440B2682C1876F2567423`, `5884d8b` `FBA36250DA34E9C077B1A9FB4BDB94C84CE79496152F3290560984F01E69E078`.

**Provenance chain (PROVEN):** CI artifact ZIP (`BUILD_SHA.txt`) → `payload/*.dll` → the copies in your Codex
`pr50-*-testing` folders → the install manifest recorded at each run (`.LSAStandaloneSmoke/manifest.json` in the
log collections). Hashes match at every step for both `b5cd53f` and `5884d8b`. What crashed in GTA is exactly what
CI built.

Other facts:
- The installed `RAGEPluginHook.exe` and the installer copy are byte-identical (stock LSPDFR-Enhanced 1.132 loader).
- The 1.124 NuGet SDK and the 1.131 ZIP's `SDK/RagePluginHookSDK.dll` are byte-identical: assembly
  `RagePluginHook v0.0.0.0` (no strong name), FileVersion 1.124.1393.17586, 186 types (178 public `Rage.*`),
  2,759 methods, 913 properties.
- All **162** RPH logs staged from your PC (27 Sep – 18 Oct) report `RAGE Plugin Hook v1.132.1428.17748` with
  game `1.0.1158.16`. Plugin loads: LosSantosAlive (Essential) 151, Smart Vehicle Entry 151, LSA Promoted
  Characters 117, LSA Standalone 2, LSPDFR 0. The only unhandled plugin exception in all 162 logs is the
  `get_GameTime` one.
- `Failed to load plugin` appears only on 2–4 Oct, and none of these failures is an RPH member-binding failure:
  - `LSA.PromotedCharacters`: `FileNotFoundException` for itself (see §B.5).
  - `LSA.SessionIdentity`, placed directly in `Plugins\`: *"does not have the required Plugin attribute"*.
  - A stray `SmartVehicleEntry.dllbbb`: *"not a valid CLR assembly"*.
- Eight more GTA sessions ran after staging (14:27–18:17 UTC); they are not among the 162. Checked read-only on
  your PC: all were RPH 1.132.1428.17748 with game 1.0.1158.16, and each loaded only Promoted Characters (newer
  builds), Essential and Smart Vehicle Entry. None loaded LSA Standalone, and none logged an unhandled exception, a
  plugin load failure or a missing member.
- `LSA.Standalone.Core.dll` references **no** RPH assembly in any build: every RPH binding lives in the host.

---

## B. RPH 1.132 runtime architecture — where the API comes from

**Plain English.** You never ship RPH's code with your plugin. You compile against the **SDK**, a reference
assembly that only describes the API. At runtime, `RAGEPluginHook.exe` puts the real implementation into GTA, gives
each plugin its own AppDomain, and the CLR binds your plugin's references to that implementation **by assembly name,
then member name plus exact signature**. A reference whose signature doesn't exist exactly →
`MissingMethodException` at JIT time. There is no separate runtime API file to find, and none should be expected.

```
 build time                          GTA process at runtime
 ──────────                          ─────────────────────────────────────────────────────────
 LSA host.dll ──refs──▶ SDK          RAGEPluginHook.exe (protected launcher)
   "RagePluginHook v0.0.0.0"           └─ packed payload ──materialized──▶ managed RagePluginHook (Rage.*)
   Rage.Game::get_GameTime():UInt32                                         │
                                       per-plugin AppDomain  (base dir = GTA root)
                                         ├─ RPH core code initialises in the domain ("<UNLOADED PLUGIN>: …")
                                         ├─ plugin file loaded by path from Plugins\
                                         ├─ deps: by name from GTA root, + PluginAttribute.AssemblyProbingPaths
                                         └─ Rage.GameFiber.Main() ──▶ EntryPoint.Main()   (JIT binds every token)
```

Evidence:

1. **The launcher is not the API (PROVEN).** 1.131 and 1.132 `RAGEPluginHook.exe` are the same kind of file: PE32+
   .NET, assembly `RagePluginHookLauncher v1.0.0.0`, 158 TypeDefs, **0 in namespace `Rage`**.
2. **It carries the runtime in protected form (PROVEN, structural).** Module attributes `SuppressIldasmAttribute`
   and `ConfusedByAttribute`; duplicate decoy metadata streams; an empty user-string heap (string encryption); a
   packed data blob of 10,847,744 bytes (1.131: 10,838,208); six resources linked to a runtime-materialized
   assembly, including one named `HookData`; and the framework primitives for this pattern —
   `Assembly.Load(byte[])`, `Assembly.LoadFrom(string)` and `AppDomain.AssemblyResolve`.
3. **Nothing else on disk defines the API (PROVEN by elimination).** Of 99 PE files in the install, 10 contain the
   identifier `GameFiber`; all 10 were parsed, and **none defines any `Rage.*` type** (9 reference
   `RagePluginHook`; one only contains the string).
4. **The runtime type exists in the plugin's domain (PROVEN).** The 08:00 exception text
   `Method not found: 'Int32 Rage.Game.get_GameTime()'` means the CLR resolved `RagePluginHook` to an assembly that
   contains `Rage.Game` (otherwise it would be a `TypeLoadException`) but has no `Int32` getter. The stack frame
   `Rage.GameFiber.Main()` shows RPH's fiber invoking the plugin entry.
5. **Per-plugin AppDomains with the GTA root as base directory (PROVEN).** The RPH log shows
   `AppDomainPool::InitializeAppDomain` / `Creating new instance of RemotePlugin in new AppDomain`, and RPH core
   initialising inside each plugin domain. Essential's own diagnostics log
   `[LosSantosAlive] AppDomain.BaseDirectory=C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced`
   (in 128 sessions, always this value). Your 2 Oct 21:36 UTC log shows RPH failing to initialise `Plugins\LSA.PromotedCharacters.dll` in its
   domain with `FileNotFoundException: Could not load file or assembly 'LSA.PromotedCharacters, Version=0.0.0.0, …'`.
   That was a load *by name*, and it didn't find the file sitting in `Plugins\`. This is consistent with by-name
   probing covering the GTA root and not `Plugins\`, which is why `AssemblyProbingPaths` matters (§D.2).
6. **Binding is version-agnostic (PROVEN).** Plugins (LSA, LSPDFR, Essential, RAGENativeUI) all reference
   `RagePluginHook, Version=0.0.0.0, PublicKeyToken=null`. A reference to a non-strong-named assembly binds by
   simple name, so the SDK's version number doesn't matter; **signatures** do.

**Limit of static analysis (stated, not hidden).** The 1.132 implementation sits inside the launcher's protected
payload. Unpacking it would mean circumventing the vendor's protection, which is out of scope and wasn't done. So
the exact 1.132 member list cannot be read directly, and whether the payload is materialized purely in memory or
via a transient temp file is not determined (it makes no difference to binding). §C/§D close this gap with
runtime and control-group evidence instead.

---

## C. Version compatibility matrix

| | 1.124 | 1.131 | 1.132 (your install) |
|---|---|---|---|
| Developer reference | NuGet `lib/net472/RagePluginHook.dll` | ZIP `SDK/RagePluginHookSDK.dll` | none shipped. The installer ZIP has no `SDK\` folder, although its bundled `RPH_Readme.txt` still says to reference `SDK\RagePluginHookSDK.dll` |
| SDK bytes | `5D439745…82C7E0` | **identical** | — |
| Launcher | — | `30D14040…`, FileVersion 1.131.1424.17745 | `73F05B3F…`, FileVersion 1.132.1428.17748 |
| Launcher shell (metadata rows) | — | TypeDef 158 · Field 761 · MemberRef 750 · Method 2,463 · Property 258 · MethodSemantics 415 | 158 · 761 · 750 · **2,464 · 259 · 416** (+1 method / property / accessor row; decoy ENC rows and obfuscated resource names changed) |
| Packed payload | — | 10,838,208 B | 10,847,744 B (+9,536 B) |
| Companion DLLs (Gwen ×2, SlimDX, Mono.Cecil ×4, LMS.PortableExecutable, FW1FontWrapper, XInput1_4, Microsoft.Expression.Drawing) | — | baseline | **all 11 byte-identical** to 1.131 |

What the evidence supports:

- **1.124 ↔ 1.131 SDK: no API change (PROVEN).** Byte-identical, same MVID.
- **1.131 ↔ 1.132 launcher: the shell is essentially unchanged (PROVEN).** The real delta is inside the protected
  payload and can't be listed statically.
- **1.132 runtime vs the SDK, for what LSA uses: no incompatibility observed (STRONGLY SUPPORTED).** Every one of
  HEAD's 37 member/instantiation imports is covered:
  - LSPDFR (692 RPH members, 0 unresolved, shipped with this exact runtime) uses 34 of them.
  - Your Essential uses 21, including 2 of the 3 that LSPDFR lacks. It loaded in 151 sessions, 37 of them since its
    current file date, with no load failure or unhandled exception in any log.
  - The third, `GameFiber.CanSleepNow`, executed on your 1.132.

  Four imports are **proven by execution on your machine** (§D.2).
- **Cannot be established offline (UNKNOWN):** whether 1.132 changed anything *outside* the surface these plugins
  use; and all behaviour of GTA natives dispatched by name/hash.

---

## D. LSA → RPH compatibility report

### D.1 HEAD (`9933290b`) — full import surface

Rebuilt in the exact CI order (fake SDK built first, so the dangerous condition is present). The compiler received
`/reference:<official RagePluginHook.dll>`. The csproj gate's `RPH compile reference requested=… resolved=…` line
showed the same official path on both sides. Results:

| Check | HEAD | Method |
|---|---|---|
| Type imports | 14 / 14 resolve, all public | exact matcher + dnlib + repo auditor |
| Member imports | 33 / 33 resolve (exact return type, parameters, static/instance, generic arity, base-type walk, accessibility) | same |
| Generic instantiations | 4 / 4 (incl. `GetEntityByHandle<Ped>` against its RPH constraint) | exact matcher |
| `[Plugin]` / `[ConsoleCommand]` named arguments | 18 / 18 exist with matching type and public setter | exact matcher |
| Matcher disagreements | 0 | dnlib vs exact |
| Repo `RphSignatureAudit` | `types=14 members=33 coreTypes=18 coreMembers=67 resolved=100 errors=0` | repo tool built from HEAD |

("100 resolved" = 33 RPH members + 67 host→Core members.)

### D.2 Per-import evidence — HEAD

{{MEMBER_TABLE}}

**What the columns mean.** A ✓ in a plugin column means that plugin's compiled IL imports exactly the same signature.

- **LSPDFR** ships with this runtime, but you never loaded it.
- **Essential** and **Smart Vehicle Entry** have run on your 1.132. Their current files are dated 12 Oct and 3 Oct,
  and their hashes still match your PC. A ✓ there is strong evidence, not proof per import: only methods that
  actually ran were bound.
- **Other installed plugins** is a static match only. The Promoted Characters copies were replaced today (§A), and
  the logs don't record which build each session ran. PRBridge and Interop are LSPDFR add-ons, and LSPDFR never
  loaded. RAGENativeUI is a library.

The table is regenerated by `scripts/member_table.py`.

**"Executed on your 1.132"** means a method containing that import demonstrably ran in GTA. A method is
JIT-compiled before its first instruction executes, and the JIT resolves every member token in its body at that
point. All four marked rows rest on the exact, hash-verified 5884d8b host:

- Its `Main` logged `host_failed` and `stopped`, so `Main` was compiled. That covers `Game.LogTrivial`,
  `Game.get_GameTime():UInt32` and `GameFiber.Sleep(int)`.
- Its `OwnerScope.Enter` ran on the straight-line path before the failure. That covers `GameFiber.get_CanSleepNow()`.

Two further RPH members, `GameFiber.StartNew(ThreadStart)` and `GameFiber.Yield()`, are shown through Smart Vehicle
Entry. Its `Main` holds the unique literal `[SmartVehicleEntry] Loaded.`, which appears in 94 sessions after the
installed file's date (2026-10-03 22:27 UTC). That build's identity rests on the file date, not on a hash (S4).

Literal matches in your Promoted Characters logs corroborate these results but aren't relied on. Essential's IL
contains no readable string literals: all 965 `ldstr` sites load the empty string, and its real strings are
encrypted. So its log lines can't be traced to methods, and that wasn't attempted.

**Dependency resolution, proven on 1.132:** 5884d8b's `Main` contains 13 direct tokens into `LSA.Standalone.Core`
and it executed. So the runtime resolved `Plugins\LSA.Standalone\LSA.Standalone.Core.dll` through
`AssemblyProbingPaths="Plugins;Plugins/LSA.Standalone"`. That folder isn't on the AppDomain's base path.

### D.3 The deployed builds

| Import compiled into the deployed host | Real SDK | `b5cd53f` | `5884d8b` |
|---|---|---|---|
| `Rage.Game::get_GameTime() : Int32` | getter returns `UInt32` | ✗ | fixed |
| type `Rage.LocalPlayer` | doesn't exist (`Game.LocalPlayer` is `Rage.Player`) | ✗ | ✗ |
| `Rage.Game::get_LocalPlayer() : Rage.LocalPlayer` | returns `Rage.Player` | ✗ | ✗ |
| `Rage.LocalPlayer::get_Character()` | `Rage.Player::get_Character()` | ✗ | ✗ |
| `Rage.Ped::Exists()` | no such method | ✗ | ✗ |
| `Rage.Ped::op_Equality(Ped,Ped)` / `op_Inequality(Ped,Ped)` | defined on `Rage.Entity` | ✗ ✗ | ✗ ✗ |
| `Rage.Ped::DistanceTo(Ped)` | `Entity::DistanceTo(ISpatial \| Vector3)` | ✗ | ✗ |
| `NativeFunction::CallByName<T>(string, object[])` | `(string, NativeArgument[])` | ✗ | ✗ |
| `NativeFunction::CallByHash<T>(ulong, object[])` | `(ulong, NativeArgument[])` | ✗ | ✗ |
| `NativeFunction::CallByHash(ulong, object[]) : object` | `(ulong, Type, NativeArgument[])` | ✗ | ✗ |
| **Unresolvable imports** | | **11** | **10** |

Each ✗ is exactly a shape declared in `native/standalone-host/tests/FakeRphSdk.cs` at that commit. The same 11/10
results come from two independent matchers and from the repo's current auditor.

### D.4 Contract and behaviour review of the RPH-facing code (all 8 host files read)

| Area | Finding | Class |
|---|---|---|
| Plugin exit | `ExitPoint="…EntryPoint.Shutdown"` and `public static void Shutdown()` take **no parameter**. The official SDK doc: *"The exit point must have the following signature … `static void OnUnload(bool isTerminating)`"*; RPH aborts all fibers, then runs the exit method on a new fiber. Both runs loaded fine; neither ever unloaded, so RPH's reaction is unobserved. | **Confirmed contract mismatch** (runtime effect unknown) |
| Failure diagnostics | `catch (Exception error) { LogTrivial("host_failed kind=" + error.GetType().Name) }` drops the message. This is why 08:17 didn't name the missing member. | **Confirmed diagnostic gap** |
| Entity lookup | `StandaloneTypedCommands.Pump` (pinned auto-smoke path, ~L235) calls `World.GetEntityByHandle<Ped>` with no exist/is-ped guard and no try/catch. The SDK documents that it *throws* if the handle isn't an entity. An escape aborts the owner loop, and `Main`'s catch then stops the host. The other three call sites are guarded (`PedFor` / `TryObserve`) or wrapped. | **Supported risk** (narrow path) |
| Dependency loading | SDK: probing paths apply *"when initially loading the plugin. After loading the plugin, the paths have no effect."* Core loads today because `Main` references it directly (proven, §D.2). A future DLL first touched later from `Plugins\LSA.Standalone\` would fail with `FileNotFoundException`. | Supported risk (future changes) |
| Console commands | Six `[ConsoleCommand]` methods; HEAD never calls `Game.AddConsoleCommands()`. LSPDFR (17 commands) and your Promoted Characters (10) rely on attribute discovery too. But your Oct 2 logs show `Unknown command or variable "lsapromote"` while that plugin was loaded (it's not clear whether that build declared the command). The SDK documents `AddConsoleCommands()` as idempotent. | STRONGLY SUPPORTED that discovery works; verify on first run |
| Actor identity | Adoption depends on `DECOR_REGISTER` succeeding at plugin load. No plugin that ran on your 1.132 uses decorators, so there's no evidence either way. GTA modding practice is that decorator registration is locked early. The code fails closed (`decorators=unavailable`) and prints this in `LSAStandaloneStatus`. | UNKNOWN; observable at host stage |
| Fibers / threads | `OwnerScope` pins the entry thread plus `GameFiber.CanSleepNow` (SDK: "executing in the active GameFiber") and is never held across `GameFiber.Sleep(50)`. Console callbacks only set flags or queue text. **All 21 `StandalonePipeServer` methods contain 0 RPH tokens** and Core has none, so the background pipe thread cannot touch RPH. `NativeAuthority.WorldEpoch` (plain `int`) is read cross-thread: no tearing, possibly stale. The pipe worker has a cancellable connect, a 7 s read watchdog, bounded 1.5 s owner round-trips and a `worker.Join(1500)` on dispose, so it can't hang unload indefinitely even if the exit point isn't invoked. | Correct; minor data race |
| Natives & marshaling | Void natives use `CallByName<int>`, as the SDK instructs (*"If the native doesn't return a value pass int"*). The same doc entry prefers the dynamic `NativeFunction.Natives` to calling `CallByName` directly. That's a style recommendation, and LSPDFR calls `CallByName` directly as well. `NativeArgument` comes via `op_Implicit(int/string)`. The `CallBy*<T>` generics carry a `struct` constraint, so the string keyboard result correctly uses `CallByHash(hash, typeof(string))`. Argument order for `PLAY_FACIAL_ANIM(ped, anim, dict)`, `IS_PED_IN_COMBAT(ped, 0)`, `DECOR_SET_INT(entity, name, value)` and the 8-argument `DISPLAY_ONSCREEN_KEYBOARD` matches the public native reference (domain reference, not binary proof). Every native call site is in try/catch or behind a guard, and Core wraps `AllowsNpcControl`. | Correct statically; runtime-only for names/hashes |
| API ranges | `GetNearbyPeds(16)`: SDK range 1–16 ✓. `GameFiber.Sleep(50)` in the owner loop; RPH `PluginTimeoutThreshold=10000` ✓. | Correct |
| Audio interop | WinMM structs match Win32 (`WAVEHDR` 48 B on x64, `MMTIME` 12 B). The device is polled only on the owner fiber, and all spatial sampling sits in try/catch. | Correct statically; audibility is runtime-only |

GTA natives dispatched dynamically (resolved by RPH only at call time): by name — `DOES_ENTITY_EXIST,
IS_ENTITY_A_PED, IS_ENTITY_A_MISSION_ENTITY, DECOR_REGISTER, DECOR_IS_REGISTERED_AS_TYPE, DECOR_EXIST_ON,
DECOR_SET_INT, DECOR_GET_INT, IS_CUTSCENE_ACTIVE, IS_CUTSCENE_PLAYING, IS_PLAYER_SWITCH_IN_PROGRESS, GET_MISSION_FLAG,
NETWORK_IS_SESSION_ACTIVE, REQUEST_ANIM_DICT, HAS_ANIM_DICT_LOADED, PLAY_FACIAL_ANIM, IS_PED_RAGDOLL, IS_PED_FALLING,
IS_PED_SHOOTING, IS_PED_IN_COMBAT`; by hash — `0x00DC833F2568DBF6` (DISPLAY_ONSCREEN_KEYBOARD),
`0x0CF2B696BBF945AE` (UPDATE_…), `0x8362B09B91893647` (GET_ONSCREEN_KEYBOARD_RESULT), `0x58A39BE597CE99CD`
(CANCEL_…).

---

## E. Root-cause analysis of the `MissingMethodException`s

**Mechanism used throughout.** The .NET Framework JIT compiles a method on its first call and resolves every member
token in that method's IL at that moment. If one token can't be resolved, the method never starts, and the
exception surfaces at the call site with the uncompiled method shown as the top frame.

### E.1 `b5cd53f` — 08:00 EDT (`RagePluginHook_18102026_115921.log`) — PROVEN

- Logged by RPH as `UNHANDLED EXCEPTION DURING GAME FIBER TICK`, message
  `Method not found: 'Int32 Rage.Game.get_GameTime()'`, stack `EntryPoint.Main()` ← `Rage.GameFiber.Main()`.
- Static: `EntryPoint.Main`'s **own body** contains that import at IL_038B and IL_039D, and it's the only kind of
  unresolvable token in `Main`.
- Decisive log check: after "Plugin LSA Standalone was loaded" there are **zero `[LSA-…]` lines**. `Main`'s
  `finally` writes `[LSA-S2] stopped` unconditionally, so `Main` never began executing. It failed to JIT-compile,
  its own try/catch never existed at runtime, and RPH caught the exception.

### E.2 `5884d8b` — 08:17 EDT (`RagePluginHook_18102026_121606.log`) — PROVEN deduction

- Logged: `[LSA-S2] host_failed kind=MissingMethodException`, then `[LSA-S2] stopped`. So `Main` ran and its catch
  fired. There was no `[LSA-S2] refused …` (all activation checks passed) and no `[LSA-ACTIVATION]` (the failure
  happened before EntryPoint.cs L137).
- `EntryPoint.cs` is unchanged between `5884d8b` and HEAD, so the order below is the code you'd run today minus the fake imports.
- Static, along `Main`'s straight-line path in IL order: `StandaloneOnlyProfile`, `LoadNativeActivation`,
  `ValidateNativeActivation`, `OwnerScope..ctor`, `OwnerScope.Enter`, `GetSetting` → **0 unresolvable tokens**.
  Next is `newobj RageActorResolver..ctor` (IL_00DC, unconditional). Its body holds four call sites (IL_007B,
  IL_009D, IL_00C0, IL_00E3) into one unresolvable MemberRef:
  `Rage.Native.NativeFunction::CallByName<T>(System.String, System.Object[])` (`<int>` for `DECOR_REGISTER`,
  `<bool>` for `DECOR_IS_REGISTERED_AS_TYPE`).
- That constructor cannot JIT-compile, and nothing earlier can fail. So the exception was
  *"Method not found: '!!0 Rage.Native.NativeFunction.CallByName(System.String, System.Object[])'"*. The log
  doesn't print the message (§D.4), so the text itself is deduced; the member's identity is pinned by elimination.
- Had that constructor compiled, 9 further unresolvable imports were waiting (§D.3). That's the "fix one, crash on
  the next" loop.

### E.3 Why CI shipped fake-SDK hosts — PROVEN (reproduced from scratch)

1. At `5884d8b` the workflow built `tests/FakeRphSdk.csproj` (assembly name `RagePluginHook`) into
   `native/standalone-host/tests/bin/Release/net481/`.
2. The host referenced `<Reference Include="RagePluginHook"><HintPath>$(RphReferencePath)</HintPath>`. MSBuild's
   ResolveAssemblyReference found the fake DLL first through **`{CandidateAssemblyFiles}`**, because the fake
   output sits under the host project directory and is picked up as a default item. That search path outranks
   `{HintPathFromItem}`.
3. The "official SDK" `dotnet build -t:Rebuild` therefore passed `/reference:…tests/bin/…/RagePluginHook.dll`
   to csc and produced a **byte-identical** DLL to the fake build (`4e9da919…` in this reproduction). Its audit
   signature equals the deployed CI artifact's exactly: 10 failures, same counts.
4. The 5884d8b `RphSignatureAudit` checked only the `get_GameTime` signature, so it passed a build with 10 other
   unresolvable imports.

### E.4 Does the current head fix each cause? — Yes at source and build level (PROVEN offline)

| Failure cause | Head |
|---|---|
| `Int32 get_GameTime` | `(uint)Game.GameTime` (EntryPoint.cs L142/L148) → binds `UInt32 get_GameTime()`; **this exact import has executed on your 1.132** |
| `CallByName/CallByHash(…object[])` | `NativeArgument[]` generics + `(ulong, Type, NativeArgument[])` |
| `Rage.LocalPlayer` / `.Character` | `Game.LocalPlayer.Character` → `Rage.Player::get_Character()` |
| `Ped.Exists()` | `RphPedValidity.Exists` → `DOES_ENTITY_EXIST` on the current pool handle |
| `Ped ==/!=`, `DistanceTo(Ped)` | inherited `Entity` operators / `DistanceTo(ISpatial \| Vector3)` |
| Fake reference resolution | `Reference Include="$(RphReferencePath)"` (full path) + `VerifyRphReferenceResolution` gate; with the fake present, csc now gets the official path |
| Narrow audit | all-imports `RphSignatureAudit` over the exact packaged DLL |

**Not yet verified:** the head **CI artifact** itself (run 39129868947) wasn't downloadable from here. Local
rebuilds show the head pipeline is correct; G1 makes this a 1-minute offline check.

---

## F. Findings by confidence

**PROVEN**
- P1 Installed RPH runtime = stock 1.132.1428.17748 loader; all 162 logs on 1.132 / game 1.0.1158.16.
- P2 1.124 and 1.131 SDKs are byte-identical; identity `RagePluginHook v0.0.0.0`, no strong name.
- P3 The launcher contains no `Rage.*` types and carries the runtime packed; no other file in the install defines `Rage.*`.
- P4 Plugins bind by simple name to `RagePluginHook`; per-plugin AppDomains with the GTA root as base directory.
- P5 Deployed `b5cd53f` / `5884d8b` = CI artifacts; compiled against the fake SDK; 11 / 10 unresolvable imports.
- P6 `b5cd53f`: `Main` failed to JIT on `Int32 get_GameTime()`; no host code ran.
- P7 `5884d8b`: failed in `RageActorResolver..ctor` on `CallByName<T>(string, object[])` (deduction from metadata plus log).
- P8 Fake-SDK packaging mechanism (`{CandidateAssemblyFiles}`) reproduced, byte-identical output.
- P9 Head: 14 types / 33 members / 4 instantiations / 18 named args, 0 unresolved (two matchers + repo auditor).
- P10 On your 1.132, with the hash-verified 5884d8b/b5cd53f builds: `UInt32 get_GameTime()`, `LogTrivial`, `GameFiber.Sleep` and `GameFiber.CanSleepNow` resolve; `Int32 get_GameTime()` does not; `LSA.Standalone.Core` resolves via `AssemblyProbingPaths`.
- P15 At the end of the analysis (18:30 UTC), 18 of 22 analysed files still match your PC byte for byte. The 4 Promoted Characters-family DLLs were replaced repeatedly from 14:22 UTC on (`evidence/pc-hash-check*.txt`). The PR head is still `9933290b`.
- P11 ExitPoint signature differs from the SDK-documented contract.
- P12 The host's catch discards the exception message.
- P13 The head csproj gate rejects the official 1.131 filename `RagePluginHookSDK.dll` (the doc's own command fails).
- P14 The pipe-server thread and Core contain no RPH tokens.

**STRONGLY SUPPORTED**
- S1 The SDK ABI matches the 1.132 runtime for every import LSA uses: 34 are used by LSPDFR (shipped with 1.132), 2 more by your Essential (has run on 1.132), and the last executed on your 1.132.
- S2 The head build will not reproduce the `MissingMethodException` family, provided the deployed DLL is the audited official-SDK build.
- S3 RPH 1.132 auto-registers `[ConsoleCommand]` methods in the plugin assembly (LSPDFR precedent; your Oct 2 logs are ambiguous).
- S4 `GameFiber.StartNew(ThreadStart)` and `GameFiber.Yield()` resolve on your 1.132 (Smart Vehicle Entry's `Main` ran in 94 sessions; build identity by file date, not hash).

**UNKNOWN**
- U1 1.132 API members outside the surface used by these plugins.
- U2 GTA-native name/hash validity and behaviour on Enhanced (the 20 names + 4 hashes in §D.4).
- U3 Decorator registration after plugin load on Enhanced.
- U4 RPH's handling of the parameterless ExitPoint at unload.
- U5 Contents of the head CI artifact (not downloadable here).

---

## G. Prioritized implementation plan

Justified only by the findings above. **The host's RPH usage needs no API rewrite.**

### Confirmed fixes

| # | Change | Files | Evidence | Expected outcome | Verify (offline unless noted) |
|---|---|---|---|---|---|
| G1 | **Deploy only an audited official-SDK build.** No source change: download the head artifact and audit its payload before installing. | — | P5, P8, U5 | Removes every observed crash cause | `dotnet run --project native/standalone-host/tests/RphSignatureAudit.csproj -c Release -- <official SDK> payload/LSA.Standalone.RageHost.dll payload/LSA.Standalone.Core.dll` → `errors=0`; `BUILD_SHA.txt` = head; hash = `SHA256SUMS.txt` |
| G2 | **Log the message for binding exceptions** in `Main`'s catch: for `MissingMethodException`, `MissingFieldException`, `TypeLoadException`, `FileNotFoundException`, `BadImageFormatException`, append `error.Message` (type/member names only, no private data). | `EntryPoint.cs` ~L167–171 | P7, P12 | Any future binding failure names its member in one run | Unit-level: force a `MissingMethodException` in the harness; GTA: next run's log |
| G3 | **Match the documented ExitPoint signature:** `public static void Shutdown(bool isTerminating)`. Body unchanged (still never touches the game). | `EntryPoint.cs` L14/L34 | P11 | RPH can invoke the exit point as documented on unload | Metadata check that the method's signature is `void(bool)`; runtime: `UnloadPlugin` (H5) |
| G4 | **Fix the csproj reference gate** to compare the resolved path with `$(RphReferencePath)` (full-path equality) instead of `%(Filename)=='RagePluginHook'`, so the official `SDK\RagePluginHookSDK.dll` works and the fake still fails. Or fix the doc command. | `LSA.Standalone.RageHost.csproj` (VerifyRphReferenceResolution); `docs/standalone-replacement/rph-compatibility-audit.md` | P13 | The documented local build works | Build with both official filenames → success; with the fake → error |
| G5 | **Guard the pinned `GetEntityByHandle<Ped>`** in `Pump` with the same `DOES_ENTITY_EXIST` + `IS_ENTITY_A_PED` checks as `RageActorResolver.PedFor`, or a local try/catch returning "not eligible". | `StandaloneTypedCommands.cs` ~L235–237 | §D.4 (SDK-documented throw, unguarded) | A recycled handle can't stop the host | Static: no unguarded call sites remain |

### Optional / defensive

| # | Change | Why |
|---|---|---|
| O1 | Call `Game.AddConsoleCommands()` once at the start of `Main` | Documented idempotent; removes reliance on attribute discovery (S3) at zero risk. The whole in-game procedure needs these commands. |
| O2 | Stop building the fake SDK anywhere under `native/standalone-host/`, or exclude `tests/**` from the host project's default items | Removes the `{CandidateAssemblyFiles}` hazard at its source, on top of the head's path gate |
| O3 | Keep every DLL in `Plugins\LSA.Standalone\` referenced directly from `Main` (or install dependencies beside the host) | SDK: probing paths only apply at initial load |
| O4 | `Volatile` read/write for `NativeAuthority.WorldEpoch` | Cross-thread read from the pipe worker |
| O5 | Only if H2 shows `decorators=unavailable`: evaluate an alternative identity marker | U3 |

**Explicitly not recommended:** rewriting RPH call sites (already correct); searching for an RPH runtime DLL (there
is none by design); touching `LSA.Standalone.Core` (no RPH coupling); unpacking RPH.

---

## H. Remaining runtime-only checks (minimal)

One GTA session with an audited head build (G1, ideally with G2) installed through your existing switcher answers
almost everything. In order:

1. **Host stage loads.** The log shows `[LSA-ACTIVATION] …` and `[LSA-S3] started`, with no `host_failed`. Why it
   can't be done offline: the real `Rage` assembly exists only inside GTA (§B). This proves every import in the
   methods that run each tick.
2. **`LSAStandaloneStatus` in the F4 console.** The command is recognised (S3) and prints `decorators=registered |
   unavailable` (U3). If it's "Unknown command", apply O1.
3. **`LSAStandaloneProbe` next to a civilian**, then `LSAStandaloneStatus` → `probe_ready_stable`. This exercises
   the entity and decorator natives (U2).
4. **`LSAStandaloneCompose`.** This exercises the four keyboard native hashes on Enhanced (U2).
5. **`UnloadPlugin LSA.Standalone.RageHost.dll`.** Observe RPH's exit-point handling, before or after G3 (U4).
6. Then the PR's existing staged gates (typed → tts → audio → lipsync → streaming), which only the game can judge.

Methods that haven't run yet bind on first use. A later failure would therefore show up at a later stage, and with
G2 it would name its member.

---

## Appendix — method and reproducibility

- **Tools:** dnlib 4.4.0 via a purpose-built read-only analyzer (`tools/RphMeta`: `info`, `types`, `api`, `refs`,
  `audit`, `methods`; no IL-dump capability). It runs two independent matchers: dnlib's resolver, and an exact
  CLR-style matcher with scope-qualified types, positional generics, base-type walk, accessibility, generic
  constraints and attribute named arguments. It's validated against plugins known to run on 1.132 (0 failures;
  counts equal the repo auditor's). Also: pefile/dnfile (PE/CLR inventory), .NET SDK 10.0.402 (rebuilds), and the
  repo's `RphSignatureAudit` built from head.
- **Scripts:**
  - `pe_clr_inventory.py`, `scan_rph_logs.py`, `jit_order.py`, `runtime_proven.py`.
  - `member_table.py`: the §D.2 table.
  - `pc_hash_check.py`: compares your PC with the analysed copies, checked against a PC-side digest.
  - `render_report.py`: fills the two tables into this report.
  - `verify.sh`: regenerates every PROVEN number.
- **Reproduce the core result:**
  ```
  dotnet build native/standalone-host/tests/FakeRphSdk.csproj -c Release        # CI order: fake present
  dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -t:Rebuild -p:RphReferencePath=<official RagePluginHook.dll>
  dotnet run --project native/standalone-host/tests/RphSignatureAudit.csproj -c Release -- <official SDK> <host.dll> <core.dll>
  # head → errors=0 ; 5884d8b payload → errors=10 ; b5cd53f payload → errors=11
  ```
- **Not done, deliberately:** unpacking the RPH launcher's protected payload, or de-obfuscating Essential. No GTA
  launch, no deployment, no change to production source or to the installation.
