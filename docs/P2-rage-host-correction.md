# P2 RAGE runtime hosting correction

> **Follow-up status:** this correction was subsequently merged and exercised in live GTA. P2 promotion, editor/profile/memory editing, summon, follow/wait and native vehicle/driver behavior now have live evidence. The “next live run” wording later in this record describes the checkpoint immediately after the hosting fix, not a current P2 implementation gate.

Production installation exposed three loading defects that offline native policy tests did not exercise:

* RAGE loads each plugin in an isolated AppDomain. Calling Essential's static `IntegrationManager.Register` from a second domain does not register with the running Essential instance, and can load a second copy of the protected core.
* RAGE shadow-copies DLLs to Temp. `Assembly.Location` cannot locate live configuration.
* `ReloadAllPlugins` tries every top-level Plugins DLL, including the P1 library without a Plugin attribute.

The corrected package separates the Core-free RAGE entry point, command-free `LSA.PromotedCharacters.Bootstrap.dll`, and `LSA.PromotedCharacters.Runtime.dll`. The entry point reads configuration under the current GTA executable's Plugins directory. Read-only CLR domain enumeration probes eligible RAGE domains locally and selects exactly one containing the pinned, already-loaded Core. The installed RAGE build uses `PreInitializedDomain_N` for the executing plugin; `LosSantosAlive_AppDomain` can exist without Core. Selection therefore checks assembly evidence rather than relying on the friendly name; it never starts/stops the CLR, creates/unloads game domains, patches Core, or enumerates native ped handles. A MarshalByRef bootstrap validates the already-loaded Core locally inside that domain before loading runtime/P1. Assembly/Type objects never cross the domain boundary. Native initialization/shutdown run on a RAGE fiber created in Essential's domain; its existing Update/EnrichActor callbacks and NPC state remain authoritative.

Missing, ambiguous, or mismatched Core fails closed. Only fixed reason codes are logged. Startup waits are bounded. Rejected duplicate starts cannot stop the active owner.

```text
Plugins/LSA.PromotedCharacters.dll                  # RAGE entry point
Plugins/LSA.PromotedCharacters.json                 # deployment settings
Plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll
Plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll
Plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll
```

Only the entry point is a standalone plugin. The private folder keeps runtime/P1 out of `ReloadAllPlugins`. No SDK, framework assemblies, or extra copies of Essential are deployed.

The production CLR host test exercises enumeration, exact selection, duplicate rejection, actual cross-domain proxies, isolated static state, rejection of empty named domains, missing-Core rejection, and the entry point's absence of Core/P1/runtime references. It executes no game assemblies. All 294 companion tests pass.

Physical evidence (2026-10-02): this layout started Essential's companion, Smart Vehicle Entry, and the P2 editor. At 18:15:30 RAGE logged `integrations_installed` in Essential's domain and `essential_host_ready` in the loader. Essential's own initializer then logged `characterProfile Available=True` and `sessionIdentity Available=True` at 18:15:33. The user confirmed successful gameplay. The executing domain changed between runs (`PreInitializedDomain_3`, then `_1`), confirming the need for assembly-based selection. The read-only roster probe returned `owner_unavailable`; command execution, promotion/follow behavior, and long-session stability remain unverified. A preceding launch stopped during DX12 initialization before plugin loading; its crash cause is unresolved.

Validation: 294 companion tests passed before these native changes. The current package builds without warnings or errors; 34 host/command assertions and 29 runtime admission/lifetime assertions pass. The 28-assertion clock-reset/Windows-pipe harness builds, but its named-pipe execution requires an elevated Windows token unavailable in this sandbox. These harnesses execute no game assemblies. The deployed Core hash remains unchanged.

The first explicit-registration attempt produced two RAGE command sets: one canonical set and one set with `2` suffixes. A fresh process then showed one loader instance and one explicit registration log, so the extra pass is RAGE's own attributed-command discovery. The loader now leaves the seven `[ConsoleCommand]` methods to RAGE discovery and keeps `Main` alive until unload. The offline command harness verifies the seven unique attributes and that no explicit registration call is made; it does not execute the installed RAGE console.

The bootstrap split keeps the command-bearing loader exclusively in its original RAGE domain. Earlier probing loaded that loader into every candidate domain; a per-domain static guard could not cover those copies. Probing and final hosting now instantiate only the separate Bootstrap assembly. Its metadata contains no plugin/command attributes, no PlayerCommands/EntryPoint types, and no RAGE/Core/P1/runtime references. The entry point no longer calls `Game.AddConsoleCommands`; this prevents the second registration pass while the attributed methods remain visible to RAGE.

The enabled console frontend stays alive until explicit unload even if the optional native host is unavailable. Native commands report unavailability while `LSACharacters` still supplies the editor URL. A game-clock regression previously permanently shut down P2 and caused the loader to return. It now cancels old pipe requests, discards captures/live associations, retires claims, and starts a fresh pipe epoch without inspecting or tasking old peds. The lifecycle harness covers both P1 reset orders and fail-closed reset cleanup. Runtime startup uses an atomic single-owner admission check; shutdown cancels pending host discovery. P1/P2 preparation is separate from initialization: the loader registers callbacks before Core iteration, while Core's own initialization/update fiber creates the owner store and channel. Fixed logs identify frontend/native-host exits, owner-thread failures and clock resets. The next live run must verify exactly seven canonical names, no numbered aliases, a ready native owner, and a successful `LSAPromote` operation.

References: [.NET AppDomain isolation](https://learn.microsoft.com/en-us/dotnet/framework/app-domains/application-domains), [MarshalByRefObject](https://learn.microsoft.com/en-us/dotnet/api/system.marshalbyrefobject), [CLR domain enumeration](https://learn.microsoft.com/en-us/dotnet/framework/unmanaged-api/hosting/icorruntimehost-enumdomains-method). Pinned SDK XML documents initial `PluginAttribute.AssemblyProbingPaths` dependency probing.
