# LSA Enhanced: Unified In-Game UX, Controls & Settings Plan

Oct 3, 2026 · @Chris Scoggins

## Executive summary

Build LSA Enhanced as one command layer with two clients: a controller-first RAGENativeUI menu inside GTA, and the existing web Character Studio as the rich desk or second-screen client. Both call the same companion ControlService and the same Essential-domain executor, so no feature is written twice and no second NPC authority appears.

Ship the chord MVP first (Phase 2): an LSA input router in the P2 loader that turns L4/R4 into Mark, Text and Follow with real suppression. It needs two small prerequisites: merging the three diverging native-host lines (Phase 0) and a string-only command bridge into Essential's AppDomain (Phase 1).

Evidence base: GitHub `main` at `f533942`, the unpushed local commit `86d02eb` on `fix/p2-command-assembly-isolation`, a metadata and IL call-graph scan of the pinned Essential DLL (`9b6de42d…`), and the 2026-10-03 RagePluginHook log on `acceptance/ps-fiber-fix-log-20261003-1645`.

| Question | Recommendation | Decisive evidence |
| --- | --- | --- |
| Where do chords live? | A new `InputRouter` in the P2 loader domain. Steam Input only maps L4/R4 to router-only keys; Essential's Mark/Text keys are replayed with `SendInput` when a tap resolves | Essential polls `user32!GetAsyncKeyState` itself (P/Invoke owners: `InputController`, `TextInputService`, `LsaControlsMenu`) and has no public Mark method |
| Embedded web UI (A) | No in-process browser. Studio stays out of process: second screen now, a Steam-overlay deep link as a spike, a WebView2 overlay host later | RPH runs plugins in `PreInitializedDomain_N`; CefSharp supports only the default AppDomain; RPH has `CreateTextureFromFile` but no dynamic textures |
| Native UI (B) | Yes, as the primary in-game surface | `LosSantosAlive.dll` already references RAGENativeUI 1.9.3 (`MenuPool`, `UIMenu`); its F7 controls menu initializes on Enhanced |
| Shared backend | Evolve `editorServer.mjs` into a method-registry ControlService; keep `CharacterService`, `ProfileStore` and the P1 registry | Console commands already reach `CharacterService` through `/api`, but by scraping the token out of the editor HTML |
| Ordinary NPCs | Default to an in-character request through `InputController.SendTextPrompt`; deterministic Follow/Wait/Dismiss stays P2-owned | Ownership-token checks in `PromotedCharactersIntegration.Handle`; stock validation in `validateStockDecision` |
| Settings | Keep files separated by owner; add a schema, a SettingsService and a new `LSA.Enhanced.json`; secrets never surface | `normalizeConfig` loads once and freezes; P1/P2 wiring is duplicated across `e1.config.json` and `LSA.PromotedCharacters.json` |
| Model preview | GTA renders the real ped with a scripted camera; no WebGL asset conversion | P2 already captures and restores standard components and props |

What I would change in the original proposal:

- **"Render the editor inside GTA"** becomes an out-of-process overlay or second screen. In-process embedding is blocked by the AppDomain model and the DX12 render path.
- **"Follow current NPC" for ordinary NPCs** becomes a spoken request the NPC can refuse. Forcing a task on an unowned ped would bypass the stock role and capability validation.
- **"Configurable bindings"** covers LSA gestures. Essential's own keys stay owned by its F7 menu and `LosSantosAlive.config`; LSA reads them and never rewrites them.
- **"Unify settings"** means one schema and one editor, not one file. Credentials and wiring files stay separate on purpose.

"Current NPC" keeps the P2 definition everywhere: `NpcTargeting.GetPlayerConversationPed() ?? NpcTargeting.GetCurrentSpeakerPed()`, with no nearest-ped fallback.

## 1. What already exists and can be reused

Most of what a unified UX needs already exists in Essential's public surface, the P2 runtime and the companion. The real gaps are an input layer, a command bridge into Essential's AppDomain, a client-neutral API and a settings schema.

### Essential runtime (pinned `LosSantosAlive.dll`)

| Surface | What it gives us | Evidence | Reuse for |
| --- | --- | --- | --- |
| `IIntegration` + `IntegrationManager.Register` | `Update`, `EnrichActor`, `OnPedControlChanged` callbacks on Essential's own fiber | Analysis §2; `RuntimeEntry.Start` registers `PromotedCharactersIntegration` | Executor for every native command |
| `NpcTargeting.GetPlayerConversationPed` / `GetCurrentSpeakerPed` | The current selected or conversation ped | `PromotedCharactersIntegration.Handle("capture")`; `docs/P2-native-evidence.md` | "Current NPC" in every client |
| `NpcActions.FollowTarget`, `WaitHere`, `ReleaseExclusiveControlForExternalSystem`; `NpcFocus.SetFocus`; `NpcStateStore` | Companion behaviour without a second task scheduler | `Handle` follow/wait/dismiss branches | Deterministic P2 commands |
| `InputController.SendTextPrompt(Ped, string)` | The stock typed turn: look-at, context JSON, `GeminiBridgeClient.SendJson`, audio-queue clear | IL call graph of the pinned DLL | Ordinary-NPC "ask" commands |
| `TextInputService.StartTextInputMode` / `IsOpen` | Stock text entry and its open flag | IL: only `InputController.Update` calls `StartTextInputMode` | Input gate; optional Text fallback |
| `LsaControlsMenu.BlocksLsaInput` | Essential's own RNUI controls menu (F7) and its input block | RPH log "Controls menu initialized. Press F7 to open."; IL: `InputController.Update` reads it | Input gate; link from the LSA Controls page |
| `NpcRoleManager.CanUseAction`, `NpcState.IsActionBlocked` | Native role and per-NPC action gates | Analysis §4, §13 | Optional gated direct commands |
| `ServerLauncher.StopServer` / `EnsureServerRunning` | Stops and starts the Node companion | Analysis Appendix A | Developer "restart companion" spike |
| RAGENativeUI 1.9.3 | Menus, already a hard dependency of Essential | AssemblyRef table; MemberRefs `MenuPool.ProcessMenus`, `UIMenu..ctor`, `UIMenuItem.add_Activated` | Native frontend |

Two things are **not** available. There is no public Mark method: marking lives in a private `InputController` method that calls `GetBestConversationPed`, `SetPlayerConversationPed` and `FirstRunTutorial.NotifyPedMarked`. And no plugin can stop Essential from reacting to a key, because it reads keys with its own `GetAsyncKeyState` P/Invoke.

### P2 and P1 native runtime

| Piece | File / symbol | Reuse |
| --- | --- | --- |
| Core-free RAGE loader and console frontend | `EntryPoint.Main`; `PlayerCommands` (`LSACharacters`, `LSAPromote`, `LSAFollowPromoted`, `LSAWaitPromoted`, `LSADismissPromoted`, `LSASummonCharacter`, `LSADespawnCharacter`) | Host for the InputRouter and the RNUI frontend; stays in the loader AppDomain |
| Cross-domain bootstrap | `DomainHost : MarshalByRefObject` (`Start`, `Ready`, `Alive`, `Stop`, `CoreStatus` hash pin); moved into command-free `LSA.PromotedCharacters.Bootstrap.dll` by local `86d02eb` | Add string-only `Submit`, `TryTakeResult`, `Snapshot` |
| Essential-domain runtime | `RuntimeEntry.Start` (GameFiber "LSA character host lifetime"); `PromotedCharactersIntegration : IIntegration` | Executor: native work runs in `Update`, at most 4 requests per tick today |
| Player-control pipe | `ControlChannel` (current-user ACL, one instance, 5 s watchdog, op allowlist `capture`…`roster`); `OperationAdmission` (UUID, epoch, world, ≤ 5 s expiry, 256-entry dedupe) | Unchanged authority for P2 commands; add one read-only `current` op |
| Safety policy | `NativeSafetyPolicy.CanControl`, `Current`, `Fresh`; `Safe()` guards cutscenes, player switch, mission flag, MP session, foreign scripts, directed interactions | Same gates for every new command |
| Ownership and suspension | `Encounter.OwnershipToken`, `Suspend`, `Retire`; `ResetForClockDiscontinuity` in `86d02eb` | Unchanged |
| Perception shadow | `IntelligenceIntegration` counters (`[PS] host_status`, `shadow anchors=…`) | Read-only diagnostics |

Today's `LSAFollowPromoted` path, end to end, shows how much already exists:

1. `PlayerCommands.Command_LSAFollowPromoted` calls `Send("follow")` on a worker thread, with one request in flight.
2. It fetches `GET /`, regex-matches the token, then posts `{"action":"control_current","operation":"follow"}` to `/api`.
3. `CharacterService.controlCurrent` asks the native side to `capture` the current ped, finds the profile whose `promotion.ownerAlias` matches, then calls `inspect` and checks the encounter and ped still match.
4. It sends `follow` with the `ownershipToken` over the P2 pipe.
5. `PromotedCharactersIntegration.Handle` runs on Essential's Update: `NativeSafetyPolicy.Current` checks the token, `Safe()` checks the guards, then `NpcFocus.SetFocus`, `NpcActions.FollowTarget` and the vehicle flags on `NpcState`.

The chord only needs to start this chain without the console; steps 3–5 stay as they are.

### Companion (Node, inside Essential's patched `server.bundle.mjs`)

| Piece | File / symbol | Reuse |
| --- | --- | --- |
| Character authority | `CharacterService.promote`, `list`, `edit`, `memory`, `controlCurrent`, `control`, `remove`; `#serial` queue; `FAILURE_REASONS` | Unchanged; wrapped as the `characters.*` method module |
| Native owner client | `NativeOwnerClient.request`; `OWNER_OPERATIONS` | Unchanged pipe transport |
| Editor HTTP and page | `startCharacterEditor` (loopback, Host/Origin checks, 64-hex token, CSP, `x-frame-options: DENY`); inline `editorHtml` | Becomes the ControlService HTTP transport plus Studio assets |
| Stores | `ProfileStore` (schema v1, 500 profiles, 8 MiB, revisions, atomic write + backup); P1 `identity/characters.v1.json` | Unchanged; the write discipline is reused for settings |
| Config | `loadConfig` / `normalizeConfig` (read once, frozen); `normalizeCharacterConfig`, `normalizeIdentityConfig`, `normalizePerceptionConfig`; `loadPrivateEnvironment` (4 credential names) | Validators behind the SettingsService |
| Telemetry | `EVENT_NAMES`, `safeKeys`, `safeTokens` in `observability/eventContract.mjs` | New control and settings events must be allowlisted |
| Pinning practice | `tools/native-metadata/Program.cs` modes, `verifyCharactersContract.mjs`, `build-manifest.json` contracts | Pin every new Essential seam the same way |

### Controls in use today

The 2026-10-03 RPH log records `TalkKey=Mouse4`, `TextKey=Mouse5`, `MarkPedKey=F9`, `MarkedPedTalkKey=F10`, the Essential controls menu on F7 and the RPH console on F4. So L4 and R4 currently reach Essential as F9 and Mouse5 through Steam Input. Stock defaults differ (`Mouse4`/`None`/`F3`/`Mouse5`, per `deployment/verify-installed.mjs`).

### What is missing

- An input layer that owns gestures; today every key is consumed independently by Essential.
- A string-only command bridge from the loader into Essential's AppDomain for non-P2 commands.
- A client-neutral API. `PlayerCommands.Send` fetches `GET /` and regex-matches `const auth="…"` before every POST.
- A settings schema. Cross-file values (`worldProfileId`, pipe names, `editorPort`) are kept in sync by hand.
- One integrated native host. `main` (PS0/PS1), `origin/diagnostics/ps-update-lifecycle` (fiber fix) and local `86d02eb` (bootstrap split, attributed-command discovery, clock reset) all edit `EntryPoint`, `RuntimeEntry` and `PromotedCharactersIntegration`.

## 2. Controller and chord input

Put gesture recognition in a new `InputRouter` inside the P2 loader's AppDomain, let Steam Input only translate L4/R4 into router-only keys, and drive Essential's Mark and Text through a key relay. This is the only placement that gives real suppression, because Essential reads its keys itself with `GetAsyncKeyState`.

### Where it should live

| Option | Verdict | Reason |
| --- | --- | --- |
| Steam Input chords alone | Reject as the gesture engine; keep as the physical mapper | A Chorded Press needs the anchor held first, so the anchor's own press has already fired. It is order-dependent, blind to game state, and lives outside the repo. Steam Input also could not emit F13–F24 as of a November 2025 feature request. |
| Patch Essential | Reject | Pinned, obfuscated binary (`9b6de42d…`); the project rule is extend, never replace. |
| Runtime inside Essential's AppDomain | Reject for input and UI; keep as executor | An unhandled exception there can take Essential down. `86d02eb` showed command-bearing code must stay in the loader domain. Essential never reads `UIMenu.IsAnyMenuVisible` for input (IL: only `LsaControlsMenu` does), so co-locating buys no input blocking. |
| **InputRouter in the loader domain + key relay** | **Recommend** | Isolated from Essential, already runs a GameFiber and the console frontend, and reaches Essential state through `DomainHost`. |

### Layers

1. **Steam Input** maps L4 → router key A and R4 → router key B. Essential binds neither. A candidate pair is F6/F8, to be verified free of GTA, Rockstar Editor, RPH (F4), Essential (F7, F9, F10) and Steam (F12).
2. **`KeySource`** polls A and B every frame with `GetAsyncKeyState`, the same call Essential uses with Steam Input today. It ignores input unless GTA's window is in the foreground.
3. **`GestureRecognizer`** is pure C# with no RPH types. It turns key transitions into tap, chord, hold, chord-hold and double-tap events.
4. **`InputGates`** drop gestures while the RPH console is open (`Game.Console.IsOpen`), the game is paused, an LSA menu is open, Essential text input is open (`TextInputService.IsOpen`), Essential's F7 menu blocks input (`LsaControlsMenu.BlocksLsaInput`), or a cutscene, player switch or loading screen is active.
5. **`LoaderDispatcher`** maps the gesture's command id to an executor:
   - `essential.mark` and `essential.text` go to `EssentialKeyRelay`, which pulses Essential's own configured key (read from `LosSantosAlive.config`; today F9 and Mouse5) with `SendInput` for about 80 ms, so Essential's poll sees exactly one press.
   - `current.follow` and other LSA commands become command envelopes (section 8).

Essential's config stays untouched. Keyboard F9 and mouse button 5 keep working directly, and if LSA Enhanced is off, L4/R4 simply do nothing until Steam Input is switched back.

### Gesture rules

&#91;embedded content: gesture recognizer · per key group, default bindings\]

A tap can only fire from Pending and a chord only from Chord armed, so when the second key arrives inside the window the tap is never emitted. Every output then waits in Consumed until all keys are released.

- A chord fires once per formation. Holding never repeats it; the group re-arms only after all its keys are released.
- When a chord wins, both taps are suppressed, because neither ever left the pending state.
- A tap fires on release, or at the end of the chord window if the key is still held and nothing else is bound to that key.
- Single-action latency equals the longest ambiguity window bound to that key. With the default bindings, Mark and Text wait at most 120 ms.
- A chord fires on press unless a chord-hold is bound to the same keys; then it fires on release and the hold fires at `holdMs`.
- Focus loss, pause and gate closure reset every group, so no key can get stuck.
- Config validation rejects duplicate gestures and any router key that equals an Essential key (that would double-fire), and reports the added latency per key.

### Default bindings

| Gesture | Command | Behaviour |
| --- | --- | --- |
| Tap L4 | `essential.mark` | Relayed to Essential's MarkPedKey |
| Tap R4 | `essential.text` | Relayed to Essential's TextKey |
| Chord L4+R4 | `current.follow` | Promoted NPC: P2 follow. Ordinary NPC: asks "Follow me." |
| Chord-hold L4+R4, 600 ms | `ui.quickMenu` | Phase 3; until bound, the chord fires on press |
| Keyboard key, configurable | `ui.mainMenu` | Phase 3 |

Timing defaults: `chordWindowMs` 120 (bounded 40–250), `holdMs` 600, `doubleTapMs` 250 (no default binding), `relayPulseMs` 80, per-command cooldown 750 ms.

### Configuration

Bindings live in a new `Plugins/LSA.Enhanced.json`, read and hot-reloaded by the loader:

```json
{
  "version": 1,
  "input": {
    "enabled": true,
    "keys": { "L4": "F6", "R4": "F8" },
    "timing": { "chordWindowMs": 120, "holdMs": 600, "doubleTapMs": 250, "relayPulseMs": 80 },
    "bindings": [
      { "id": "mark", "gesture": "tap", "keys": ["L4"], "command": "essential.mark" },
      { "id": "text", "gesture": "tap", "keys": ["R4"], "command": "essential.text" },
      { "id": "follow", "gesture": "chord", "keys": ["L4", "R4"], "command": "current.follow" }
    ]
  },
  "quickCommands": {
    "ordinaryNpc": "ask",
    "phrases": { "follow": "Follow me.", "wait": "Wait here." }
  }
}
```

Logical key names (`L4`, `R4`) are stable; only their physical key changes with the Steam Input layout. Destructive commands (despawn, unpromote, memory delete) cannot be bound to gestures.

### Core types

```csharp
public enum GestureKind { Tap, Chord, Hold, ChordHold, DoubleTap }
public readonly struct GestureEvent { public readonly string BindingId; public readonly GestureKind Kind; public readonly long AtMs; }
public sealed class GestureRecognizer
{
    public GestureRecognizer(GestureMap map, GestureTiming timing);
    // Once per frame with the logical keys currently down; appends resolved gestures.
    public void Update(long nowMs, LogicalKeySet down, List<GestureEvent> output);
    public void Reset(); // focus loss, pause, gate closure
}
internal sealed class EssentialKeyRelay
{
    // Keyboard keys use KEYBDINPUT; Mouse4/5 use MOUSEINPUT with XBUTTON1/2.
    // Key-up is scheduled by the router fiber, never by sleeping the game fiber.
    public RelayResult Pulse(EssentialKey key, long nowMs);
    public void Update(long nowMs);
}
```

If Essential's key for an action is `None`, the relay reports `essential_key_unbound` and the HUD says to bind it in Essential's F7 menu.

### Tests

- `native/enhanced/input-tests` (offline, net481, no game types): tap, chord in both orders, a near miss just outside the window, hold, chord-hold, release-one-and-re-press, focus loss mid-chord, a key held for 30 s, and config validation.
- `EssentialBindings` parser: F1–F24, letters, digits, `Mouse4`, `Mouse5`, `None`, unknown names, and an `ApiKey` line that must never be retained.
- A relay stub that records `SendInput` calls: exactly one pulse per tap, zero for chords.

## 3. Option A: embedded web Character Studio

In-process embedding is not realistic in this stack. An out-of-process web overlay is realistic but medium-to-large work, and the cheapest "web inside the game" is a Steam-overlay deep link that needs a short spike first.

### Why in-process embedding is blocked

- RPH hosts every plugin in a non-default AppDomain (log: `PreInitializedDomain_N`, `LSA.PromotedCharacters_AppDomain`). CefSharp only works in the default AppDomain and initializes once per process, so even a plugin reload would need a GTA restart.
- RPH already hooks the DX12 swap chain and draws through its own D3D11 wrapper (log: "Hooking game swap chain", "Initializing D3D11 Renderer"). Its API offers `Game.CreateTextureFromFile`, `Graphics.DrawTexture` and the `FrameRender` events, but no texture from memory. Streaming browser frames would need a second, competing D3D12 hook.
- In-process WebView2 needs an STA thread and a window, and has no fast offscreen path (`CapturePreviewAsync` encodes an image per call).
- A browser-engine crash inside GTA's process ends the session.

### Realistic approaches

| Approach | How it works | Input and focus | Isolation | Install burden | Effort | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A0. External browser or second screen | Today's `http://127.0.0.1:37921`, opened via `LSACharacters` or a menu item | Mouse and keyboard in the browser; GTA loses focus | Separate process | None | Done | Keep as the default rich client |
| A1. Steam-overlay deep link | The loader calls Steamworks `ActivateGameOverlayToWebPage(url)` through the game's own `steam_api64.dll` | Steam's overlay owns input, including its controller cursor; whether GTA pauses must be measured | Steam's process | None, if the overlay attaches when GTA starts through RPH | Small: spike plus \~150 lines | Spike first; best value if it works |
| A2. WebView2 overlay host | A separate `LSA.Studio.Overlay.exe` (.NET 8, WebView2, topmost borderless window) started and steered by the loader | Focus mode for typing and mouse; a non-activating mode where the InputRouter forwards controller navigation over a local socket | Separate process | WebView2 Evergreen runtime (part of Windows 11; the RPH log reports build 10.0.26100); borderless windowed mode required | Medium to large | Later, only if A1 fails or a richer in-game web view is needed |
| A3. In-process CEF or WebView2 rendered to a texture | Offscreen rendering plus a custom D3D12 hook | Input forwarding re-implemented by hand | None | Large Chromium payload; AppDomain conflict | Very large and fragile | Reject |

### Constraints for A0–A2

- **Focus and pause.** GTA's "Pause Game On Focus Loss" option stops the game when another window takes focus, and P2 live controls need a ticking game (`docs/P2-promoted-characters-status.md`). Studio must label which actions will defer, and setup notes should recommend turning that option off for second-screen play.
- **Controller navigation.** A0 and A2's focus mode need mouse and keyboard. A1 relies on Steam's overlay controls. A2's non-activating mode keeps GTA focused and needs a small focus engine in Studio driven by the InputRouter.
- **Localhost HTTP stays appropriate.** Keep the current hardening: IPv4 loopback, exact Host/Origin, per-run token, CSP with `frame-ancestors 'none'`, `x-frame-options: DENY`. A top-level overlay navigation is not framing, so nothing needs relaxing. LAN or phone access stays out of scope.
- **Lifecycle.** Studio must keep working with GTA paused or closed (profile and memory editing already do) and report live-control failures with the existing reason codes (`owner_unavailable`, `native_stale`).
- **Performance.** A0 and A1 cost nothing inside GTA. A2 adds a Chromium browser and renderer process, and borderless windowed mode with a topmost window can affect frame pacing; both need measuring before commitment.

### What the web client is still best at

Long-form editing (biography 1,200 chars, notes 2,400), memory management, portraits, relationship views, voice audition in the browser through the companion's existing speech provider, advanced settings and diagnostics. These belong in Studio wherever it is displayed; the controller-first in-game surface is the native menu (section 4).

## 4. Option B: native RAGENativeUI frontend

Option B is moderate effort and low risk: RAGENativeUI 1.9.3 already ships with Essential, the menu can run in the loader's AppDomain on its own fiber, and every action reuses the command contract from section 8. It should be the primary in-game surface.

### Where it runs

- **The loader AppDomain** (`LSA.PromotedCharacters.dll` today; renaming it `LSA.Enhanced.dll` later is optional). RNUI's static state is per AppDomain, and Essential never consults `UIMenu.IsAnyMenuVisible` for its key handling, so sharing Essential's domain would add crash risk and buy nothing.
- **A dedicated GameFiber** calls `MenuPool.ProcessMenus()` every frame and yields. The existing 100 ms loop in `EntryPoint.Main` keeps supervising the host.
- **Callbacks never touch peds.** They submit commands and render results; all ped work stays in `PromotedCharactersIntegration.Update`.
- **Data sources.** Native facts come from `DomainHost.Snapshot()`, a JSON string of at most 16 KiB built on Essential's Update, refreshed every 250 ms only while a menu is open. Names, profiles and memories come from the companion API (section 7).
- **Version guard.** Compile against a hash-pinned RAGENativeUI 1.9.3 reference taken from the stock payload. At startup require assembly version 1.9.3.0; otherwise disable menus and keep gestures and console commands working.

### Menu structure, derived from the code

| Page | Content and source | Actions and executor |
| --- | --- | --- |
| Current NPC | Name from the encounter profile (`SessionProfiles`) or the promoted profile; promoted, suspended and mode from the runtime snapshot (`Encounter.Suspended`, `Encounter.Mode`); role via `NpcRoleManager.GetRoleName`; voice from `voiceReference.voice` | Promote (`CharacterService.promote`); Follow, Wait, Dismiss when promoted (`controlCurrent`); "Ask to follow" and "Ask to wait" when ordinary (`npc.ask` → `SendTextPrompt`); Open in Studio |
| Characters | `CharacterService.list()` with `runtimeStatus` | Summon, Follow, Wait, Dismiss (`control`); Despawn only for addon-created peds, hold to confirm |
| Character detail | Name, nicknames, relationship state (associate, friend, trusted, strained, neutral), availability (available, dead, retired), traits, memories with their selected flag | Rename via the on-screen keyboard; relationship and availability as list scrollers; toggle which memories are supplied to dialogue (at most 3 per turn); add a short memory; long fields open Studio |
| Controls | Router on/off, bindings, timings, Essential's current keys read from `LosSantosAlive.config`, detected conflicts | Toggle the router; adjust the chord window (hot reload); a hint to press F7 for Essential's own keys |
| AI and voice | Provider, models, voice assignment mode, streaming and early-TTS flags, credential present yes/no | Read-only in v1; restart-scoped edits arrive with the SettingsService (section 6) |
| World and intelligence | Perception mode and the `[PS]` counters | Read-only |
| Diagnostics | `DomainHost.Ready` and `Alive`, P1 availability, pipe reachability, companion reachability and build hash, Essential pin status, the last 10 reason codes | Re-check; write a diagnostics block to the RPH log |

### Native UI specifics

- **Text entry** uses GTA's on-screen keyboard (`DISPLAY_ONSCREEN_KEYBOARD`, 2–256 characters, polled with `UPDATE_ONSCREEN_KEYBOARD`). That covers names, nicknames and short memories. Biography (1,200), personality (1,200) and notes (2,400) stay in Studio.
- **Portraits** use ped headshots (`REGISTER_PEDHEADSHOT`, `GET_PEDHEADSHOT_TXD_STRING`, `UNREGISTER_PEDHEADSHOT`) for spawned characters. The runtime registers and releases them on Essential's fiber; the UI fiber only draws the texture string with `DRAW_SPRITE` beside the menu. Absent characters show initials.
- **Destructive actions** use hold-to-confirm with the name and an id suffix on screen. Unpromote stays Studio-only behind the typed CharacterId, matching `CharacterService.remove`.
- **Input overlap.** RNUI blocks game controls while visible, but Essential still polls its own keys (Talk on Mouse4 and so on). The InputRouter pauses LSA gestures while a menu is open; Essential's keys are unaffected, which the Controls page states.
- **Rough size.** On the order of 1,500 lines of C# for menus, the data client and the keyboard helper, plus view-model tests. Commands, safety and persistence already exist.

## 5. Supporting both clients with one backend

Support both, as two clients of one contract. Each operation has exactly one executor; the clients differ only in presentation and in the transport they use to reach that executor.

&#91;embedded content: LSA Enhanced architecture · 4 clients, 2 dispatch points, 1 native executor\]

Every client sends the same command envelope. Companion-owned work runs in `CharacterService` or `SettingsService`, all ped work runs only in `PromotedCharactersIntegration.Update`, and Essential's Mark and Text keys are reached only through the relay.

Compared with the diagram in the brief, the "LSA Enhanced UI/API" box becomes a contract with two dispatch points rather than one service. The loader lives inside GTA and the companion is a separate Node process, and native work must stay on Essential's fiber, so a single gateway would either add a hop to every gesture or move ped work off that fiber.

### Who executes what

| Operation family | Single executor | Native menu, gesture or console path | Web Studio path |
| --- | --- | --- | --- |
| Promote; summon; follow, wait, dismiss, despawn a promoted character; unpromote | `CharacterService` → `NativeOwnerClient` → `ControlChannel` → `PromotedCharactersIntegration.Update` | Loader `CompanionClient` → `POST /api/v1` | `POST /api/v1` |
| Profile and memory edits | `CharacterService` with `ProfileStore` | `CompanionClient` | `POST /api/v1` |
| Current-NPC facts | Runtime snapshot joined with names from `SessionProfiles` or `ProfileStore` | `DomainHost.Snapshot()` plus `current.describe` | `current.get`, served through a new read-only `current` pipe op |
| Ordinary-NPC requests ("ask") | Runtime `LocalCommandQueue` → `InputController.SendTextPrompt` inside `Update` | `DomainHost.Submit` | Not exposed in v1; it is a game-time action |
| Mark and Text | Essential's own `InputController`, reached through `EssentialKeyRelay` | Loader only | Not applicable |
| LSA settings | `SettingsService` in the companion writes; the loader hot-reloads `LSA.Enhanced.json` | `CompanionClient` → `settings.*` | `settings.*` |
| Status and diagnostics | Companion `status.get` plus the loader snapshot | Both | `status.get` |

### Shared definitions instead of shared code

- **`contracts/commands.v1.json`** lists command ids, class (read, control, lifecycle, destructive), target kind, whether a gesture may bind it, required feature flags, and reason codes with their short HUD text. Node imports it; the C# build embeds it and generates constants. A test on each side asserts the same SHA-256, so the two catalogs cannot drift.
- **`contracts/settings.v1.json`** lists each setting's id, file, JSON path, type, bounds, apply scope, visibility, editing clients and secret flag (section 6).
- **Reason vocabulary.** `FAILURE_REASONS` in `characterService.mjs` plus new codes (`essential_key_unbound`, `input_gated`, `target_changed`, `cooldown`, `companion_unavailable`, `native_host_unavailable`), mirrored in the telemetry `safeTokens` allowlist.

### Rules that keep it one system

- Clients render and submit; they never decide eligibility. The executor re-checks everything at execution time, on the right fiber.
- No client talks to Essential directly. The loader reaches Essential only through `DomainHost` (strings) and the key relay.
- Every new Essential seam is pinned in a metadata file and verified before use, as `verifyCharactersContract.mjs` does today.
- Features ship behind flags that default off (`input.enabled`, `ui.enabled` in `LSA.Enhanced.json`), like P1, P2 and PS.

## 6. Settings and configuration

Keep the files separated by owner and trust level, and unify them through one schema, one SettingsService and one set of pages. Merge nothing: each file has a different writer, load time and secret content.

### What exists today

| File | Owner and writer | When it is read | Contents | Secrets |
| --- | --- | --- | --- | --- |
| `Plugins/LosSantosAlive/LosSantosAlive.config` | Essential; its F7 controls menu | Essential start; `InputController.ReloadConfig()` exists | Language, TalkKey, TextKey, MarkPedKey, MarkedPedTalkKey, AudioVolume, TutorialComplete, ApiKey | `ApiKey` (stock Gemini credential) |
| `Plugins/LosSantosAliveServer/e1.config.json` | Companion; edited by hand or by deployment | Once at companion start (`loadConfig`, frozen) | Provider, models, voices, acting, streaming bounds, retry, playback bounds, history, observability, `persistentIdentity`, `promotedCharacters`, `intelligence` | None by design |
| `Plugins/LosSantosAliveServer/.env` | User or deployment | Once (`loadPrivateEnvironment`, 4 allowed names) | `OPENAI_*` keys | All of it |
| `Plugins/LSA.PromotedCharacters.json` | Loader; edited by hand | Loader and runtime start (≤ 4 KiB) | `enabled`, `worldProfileId`, `pipeName`, `identityPipeName`, `editorPort`, `intelligence` | None |
| `identity/characters.v1.json`, `characters/profiles.v1.json` | P1 registry, P2 `ProfileStore` | Companion start | Data, not settings | Private narrative text |
| `RAGEPluginHook.ini`, Steam Input layout | External tools | External | Console key (F4), controller mappings | None |

### Wiring that must agree across files

Six values are duplicated today and kept in sync by hand: `persistentIdentity.worldProfileId` = native `worldProfileId`; `persistentIdentity.pipeName` = native `identityPipeName`; `promotedCharacters.pipeName` = native `pipeName`; `promotedCharacters.editorPort` = native `editorPort`; and the `intelligence` mode and pipe on both sides. Treat them as **linked settings**: shown once, checked at startup with both values in Diagnostics on mismatch, and written together in one two-file transaction. `worldProfileId` stays read-only in every UI because it anchors the whole character timeline.

### Classification

| Class | Rule | Examples |
| --- | --- | --- |
| Player, hot | Editable in-game and in Studio; applies immediately | Input bindings and timing, ordinary-NPC mode, ask phrases, HUD feedback, menu key (`LSA.Enhanced.json`) |
| Player, companion restart | Editable in both; applies after the companion restarts | `ttsSpeed`, `actingEnabled`, `voiceAssignment`, `structuredStreamingEnabled`, `earlyTtsEnabled`, `maxHistoryMessages` |
| Advanced, companion restart | Studio only | `retry.*`, `providerWorkDeadlineMs`, `playbackCompletion*Ms`, `streamingMax*`, `maxOutputTokens`, `maxMicDurationMs`, observability limits, voice pools and profiles |
| Game restart | Studio only, with a warning | P2 `enabled`, `intelligence.mode`, the linked wiring |
| Developer only | Hidden unless developer mode is on | Pipe names, store paths, provider base URLs, `prepareTimeoutMs` |
| Read-only status | Shown, never edited | Diagnostics, Essential's key bindings and language, RPH console key |
| Never surfaced | Presence only, never values | `.env` keys ("OpenAI key present: yes/no" per endpoint), Essential `ApiKey` |

### Schema

One file, `contracts/settings.v1.json`, describes every setting both clients may show:

```json
{
  "id": "voice.ttsSpeed",
  "file": "companion",
  "path": "ttsSpeed",
  "type": "number",
  "min": 0.25,
  "max": 4,
  "default": 1,
  "apply": "companionRestart",
  "visibility": "player",
  "editableIn": ["native", "studio"],
  "secret": false
}
```

`file` is one of `enhanced`, `companion`, `native`, `essential` (read-only) or `env` (presence only). `apply` is `hot`, `companionRestart`, `gameRestart` or `readOnly`.

### SettingsService

- **Location.** `src/settings/settingsService.mjs` with `schema()`, `get({ visibility })` and `patch(changes, expectedRevisions)`, exposed as `settings.*` methods (section 7).
- **Validation reuses what exists.** A patch is applied to a copy of the raw file, then the whole result goes through `normalizeConfig`, `normalizeCharacterConfig`, `normalizeIdentityConfig` or `normalizePerceptionConfig`. Any `TypeError` rejects the patch with the setting id.
- **Writes.** `src/settings/atomicJsonFile.mjs`, extracted from the `ProfileStore` discipline: unique temp file, flush, replace, keep a `.bak`. Each file's revision is the SHA-256 of its bytes, and writes are compare-and-swap on that revision.
- **Boundaries.** It never reads `.env` values; Diagnostics gets only presence booleans. It never writes `LosSantosAlive.config`; Essential's F7 menu remains its editor.
- **Linked settings** are written as one transaction: both temp files first, then the replacements, rolling back from `.bak` if the second replace fails.
- **Telemetry** adds `settings_saved` and `settings_rejected` with setting ids only, never values, through the existing allowlists.

### How changes apply

- **Hot.** The loader watches `LSA.Enhanced.json` (file watcher plus a 2 s revision check), swaps an immutable `EnhancedSettings` snapshot between frames, then rebuilds and resets the gesture recognizer.
- **Companion restart.** The UI says "Saved; applies after the AI companion restarts." A developer action may call `ServerLauncher.StopServer()` then `RequestEnsureServerRunning()` through the runtime, but only if a spike shows Essential reconnects cleanly (its log prints "Connected to Node bridge"). Otherwise the instruction is to restart GTA.
- **Later.** Per-turn config epochs, where each turn reads a config snapshot at its start the way P0 snapshots turn context, would make voice and provider settings hot without changing a turn in flight.

### Eventual page structure

| Page | Native menu | Studio |
| --- | --- | --- |
| Current NPC | Yes | Yes |
| Characters | Roster, controls, short edits | Full profile and memories; portraits later |
| Controls | LSA bindings and timing; Essential keys read-only | The same plus a binding editor |
| AI and voice | Status plus player toggles | All companion settings, restart-scoped |
| World and intelligence | Perception status | The same; salience and scene controls once those systems exist |
| Developer and diagnostics | Health and recent reason codes | Full diagnostics, linked wiring, log locations |

## 7. How the Character Editor backend should evolve

Keep the domain layer (`CharacterService`, the stores, `NativeOwnerClient`) exactly as it is and replace only the transport. `editorServer.mjs` becomes a general ControlService with a method registry, an HTTP transport, static Studio assets and an endpoint file for native clients.

### Keep, extract, change

| Part | Decision | Why |
| --- | --- | --- |
| `CharacterService` | Keep; wrap as `characters.*` methods | It already serializes mutations (`#serial`), checks revisions and owns the P1/P2 sequencing |
| `ProfileStore`, P1 registry | Keep | Schema v1, bounded, atomic writes, recovery |
| `NativeOwnerClient` | Keep; add one read-only op, `current` | Transport to the native executor |
| The request `switch` in `startCharacterEditor` | Extract into `ControlService` | Every new feature would otherwise grow that switch |
| Inline `editorHtml` with `script-src 'unsafe-inline'` | Move to static files under `src/studio/`; tighten CSP to `script-src 'self'` | Testable UI code and a stricter page |
| Token embedded in the HTML | Keep for the browser; add an endpoint file for native clients | `PlayerCommands.Send` regex-scrapes `const auth="…"` today |
| Starts only when P2 is ready (`bootstrap.mjs`) | Start whenever the companion runs; register character methods only when `CharacterService.ready` | Status and settings must work with P2 off |
| Port key `promotedCharacters.editorPort` | Keep; add a `controlServer.port` alias later | No config break |

### New modules

```text
lsa-essential-e1-candidate/src/control/
  controlService.mjs      registry, dispatch, describe
  commandEnvelope.mjs     CommandEnvelope v1 validation; codes from contracts/commands.v1.json
  httpServer.mjs          evolved startCharacterEditor: GET / and /studio/*, POST /api (legacy), POST /api/v1
  endpointFile.mjs        write and remove %LOCALAPPDATA%\LSA Enhanced\control-endpoint.v1.json
  methods/characters.mjs  wraps CharacterService
  methods/current.mjs     current.get, current.describe
  methods/status.mjs      status.get
  methods/settings.mjs    wraps SettingsService
lsa-essential-e1-candidate/src/studio/
  index.html, app.js, styles.css
```

### ControlService contract

```js
export class ControlService {
  register(name, { params, mutating = false, requires = [], handler }) {}
  describe() {} // { version: 1, methods: [{ name, mutating, available }] }
  async dispatch({ method, params, id }, { principal }) {} // { id, ok, result } or { id, ok: false, error }
}
```

- `principal` is `studio` (browser token) or `native` (endpoint-file token). Both are same-user loopback clients, so it feeds telemetry and per-client rate limits, not extra rights.
- `requires` names readiness flags (`characters.ready`, `native.available`). Unavailable methods return `feature_unavailable` instead of throwing.
- Errors reuse `characterFailureReason` and the bounded `^[a-z][a-z0-9_]{0,63}$` rule already in `editorServer.mjs`.

### API v1 methods

| Method | Maps to | Notes |
| --- | --- | --- |
| `system.describe` | `ControlService.describe` | Clients enable menu items from this |
| `status.get` | Config summary, `CharacterService.ready`, native `roster` reachability, build hashes | No secrets |
| `current.get` | Native `current` op joined with `SessionProfiles` or `ProfileStore` names | Used by Studio |
| `current.describe` | Names for an `{encounterId, ownerAlias}` pair the native client already holds | Read-only lookup with no pipe call |
| `characters.list`, `characters.get` | `CharacterService.list` | Includes `runtimeStatus` |
| `characters.promote` | `CharacterService.promote` |  |
| `characters.edit` | `CharacterService.edit` | `expectedRevision` required |
| `characters.memory` | `CharacterService.memory` | Create, edit, delete |
| `characters.control` | `CharacterService.control` | Summon, follow, wait, dismiss, despawn |
| `characters.controlCurrent` | `CharacterService.controlCurrent` | Follow, wait, dismiss |
| `characters.remove` | `CharacterService.remove` | Typed confirmation; Studio only |
| `settings.schema`, `settings.get`, `settings.patch` | `SettingsService` | Section 6 |

The legacy `POST /api` keeps its `action` names and maps one-to-one onto these methods for one release, so today's page and `PlayerCommands` keep working during the migration.

### Endpoint file for native clients

Written atomically when the server listens and removed on close:

```json
{ "version": 1, "url": "http://127.0.0.1:37921", "token": "<64 hex>", "pid": 16744, "startedAtUtc": "2026-10-03T20:44:06Z" }
```

- It lives at `%LOCALAPPDATA%\LSA Enhanced\control-endpoint.v1.json`, which is per-user by default and outside the Steam library.
- The loader's `CompanionClient` reads it, sends `x-lsa-editor`, `Origin` and `content-type` exactly as the browser does, and re-reads the file after a 403 or a changed `pid`.
- The trust boundary is unchanged. Any same-user process can already `GET /` and read the token; the file grants nothing more. Binding beyond loopback stays forbidden.

### Native pipe addition

One read-only op, `current`, returns `{ pedId, encounterId, ownerAlias, owned, suspended, mode, safe }` for `GetPlayerConversationPed() ?? GetCurrentSpeakerPed()` without creating a capture ticket. It is added to the `ControlChannel` allowlist, `OWNER_OPERATIONS` and the offline parser tests. `controlCurrent` keeps its capture → inspect → operate sequence and its ownership-token check.

## 8. How native and web UIs issue commands safely

Every client emits the same CommandEnvelope v1, targets are named rather than addressed by raw handle, and every command is re-validated on Essential's Update fiber by the executor that already owns that kind of work.

### Envelope

```json
{
  "v": 1,
  "id": "0d9c2f4e-8a61-4f0b-9c7e-3b1d5a7e2c10",
  "command": "current.follow",
  "target": { "kind": "current", "expect": { "encounterId": "7a3e9b1c-5d2f-4e8a-b6c4-1f0e9d8c7b6a", "ownerAlias": null } },
  "args": {},
  "source": "chord",
  "issuedAtUtc": 1791065500000,
  "expiresAtUtc": 1791065504000
}
```

- `target.kind` is `current` (resolved at execution with `GetPlayerConversationPed() ?? GetCurrentSpeakerPed()`), `character` (a `characterId`, resolved by the existing P2 code to alias, encounter and ownership token), or `none`.
- `expect` holds what the player saw when issuing the command. The executor rejects with `target_changed` if the current NPC differs, mirroring P0's time-of-use reference checks in `validateStockDecision`.
- Expiry is at most 5 s after issue, as `NativeSafetyPolicy.Fresh` already enforces, and `id` is a UUID de-duplicated by its executor (`OperationAdmission` natively, the ControlService in the companion).
- `source` (chord, menu, studio, console) is used only for telemetry and rate limits.

### Rules

1. Clients never send ped handles. `pedId` values in snapshots are for display and diagnostics only.
2. All ped work runs in `PromotedCharactersIntegration.Update` within the existing per-tick budget (4 today); the new local queue and the pipe share it.
3. P2 commands keep the ownership-token check (`NativeSafetyPolicy.Current`) and the `Safe()` gates. Nothing here adds a second path to them.
4. Commands have classes: read, control (follow, wait, ask), lifecycle (promote, summon, dismiss) and destructive (despawn, unpromote, memory delete). Gestures may bind only read and control commands; lifecycle needs a menu confirmation; destructive needs hold-to-confirm in-game or the typed CharacterId in Studio, as today.
5. One outstanding command per class per client, plus cooldowns: 750 ms for a repeated command, and 3 s per NPC for asks because each ask costs a model call and TTS.
6. Results use the fixed reason vocabulary. HUD text comes from the catalog, never from model or profile text.
7. Telemetry adds `control_command_requested`, `control_command_completed` and `control_command_rejected` with command id, source and reason only, through the allowlists in `eventContract.mjs`.
8. None of this becomes a model tool. Promotion and management stay player-only, as P2 specifies.
9. Commands that need a ticking game expire instead of queueing; on `native_stale` while paused, clients say the game must be running.

### Promoted versus ordinary NPCs

| Command | Promoted (P2-owned) | Ordinary NPC | Executor |
| --- | --- | --- | --- |
| Promote | Not applicable | Yes, explicit only | `CharacterService.promote` |
| Follow | Direct `NpcActions.FollowTarget` with focus and vehicle flags | Ask: `SendTextPrompt(ped, "Follow me.")`; the model and stock validation decide | P2 pipe, or `LocalCommandQueue` for asks |
| Wait | Direct `NpcActions.WaitHere` | Ask: "Wait here." | Same |
| Dismiss | Direct release via `ReleaseExclusiveControlForExternalSystem` | Optional ask, for example "That's all, you can go." | Same |
| Summon | Yes, for an absent character at a safe outdoor spot | No | `CharacterService.control` |
| Despawn | Only peds the addon created | No | `CharacterService.control` |
| Mark, Text, Talk | Essential | Essential | Mark and Text through the relay; Talk stays a direct key |

**Why "ask" is the default for ordinary NPCs.** `SendTextPrompt` is exactly where Essential's own text input ends (IL: `StartTextInputMode` calls `SendTextPrompt`). The request therefore passes P0 snapshots, P1 identity, the model, `validateStockDecision` (the actor's available actions and target references) and Essential's role gates, and the NPC answers in character. A forced task would skip all of that.

**Optional direct mode, off by default.** With `quickCommands.ordinaryNpc` set to `direct` (a developer setting), Follow and Wait call `FollowTarget` and `WaitHere` for an NPC that is already in Conversation runtime with the player, passes `NativeSafetyPolicy.CanControl`, `NpcRoleManager.CanUseAction(state, "followtarget")` and `!state.IsActionBlocked("followtarget")`, and is not a mission entity. It uses the same Essential seams as P2 but bypasses the companion's situational action set, which is why it stays opt-in.

### Native execution sketch

```csharp
// Runtime, Essential AppDomain. Drained only from PromotedCharactersIntegration.Update.
internal sealed class LocalCommandQueue
{
    public string Submit(string envelopeJson);       // "accepted" or a rejection code; never touches game state
    public bool TryTake(out LocalCommand command);   // expired or cancelled entries complete as native_stale
    public void Complete(LocalCommand command, string status, string reason, object result);
    public string TryTakeResult(string id);          // result JSON delivered once, retained 30 s
}

// Inside Update, after pipe requests, sharing the per-tick budget:
case "npc.ask":
    var ped = NpcTargeting.GetPlayerConversationPed() ?? NpcTargeting.GetCurrentSpeakerPed();
    if (ped == null || !NpcTargeting.IsValidHumanPed(ped)) throw new InvalidOperationException("no_current_npc");
    if (EncounterFor(ped).Id != command.ExpectedEncounterId) throw new InvalidOperationException("target_changed");
    if (Scripted() || NpcStateStore.TryGetState(ped)?.InDirectedInteraction == true) throw new InvalidOperationException("scripted_state");
    InputController.SendTextPrompt(ped, command.Phrase); // the same call Essential's text input makes
    break;
```

Phrases come from `LSA.Enhanced.json` (1–120 characters, no control characters), so the player's own language and wording are used.

## 9. Model preview: let GTA render it

Use GTA itself as the renderer: a short-lived preview session with the real ped, a scripted camera and the existing appearance validation, driven first from the native menu and later from Studio. Do not build WebGL model conversion.

### Comparison

| Criterion | WebGL with converted models | GTA-rendered preview |
| --- | --- | --- |
| Fidelity | Shader, skinning, cloth and head-blend gaps; P2 already notes head blend, face features and tattoos are not captured | Exact: the same model, components, props and lighting |
| Asset pipeline | Extract and convert drawables and textures from encrypted game archives for every model and variation | None; reuses the natives `Restore()` already calls (`SET_PED_COMPONENT_VARIATION`, `SET_PED_PROP_INDEX`) |
| Asset handling | Converted Rockstar assets must stay on the player's machine; caching and licensing questions | Nothing leaves the game |
| Works with GTA closed | Yes | No |
| Effort | Very large | Medium; mostly existing seams |
| Fit with "Essential authoritative" | Neutral | Needs the same mission, cutscene and ownership guards as P2 `spawn` |

### Recommended design

- **Preview session, owned by the runtime.** `preview.begin` with a `characterId` or `current`. A spawned character is framed as-is. An absent one gets a temporary ped built with `Restore()`-validated appearance under the same checks as `spawn`: player alive, on foot, outdoors, valid ground, nothing scripted.
- **Preview peds are not characters.** They are never registered with P1, never receive an ownership token, are frozen and invincible, and are deleted on `preview.end`, after 60 s idle, or when any guard trips. Ped work stays in `Update`.
- **Camera, owned by the loader UI fiber.** The camera is presentation, not NPC state: `CREATE_CAM_WITH_PARAMS`, `POINT_CAM_AT_ENTITY`, `RENDER_SCRIPT_CAMS`, with orbit and zoom driven every frame by the right stick or mouse through the InputRouter. The gameplay camera is always restored on end, failure or unload.
- **Appearance edits.** `preview.applyAppearance` takes `{components, props}` checked by the existing `ValidateAppearance` and `NativeSafetyPolicy.VariationAvailable`. `preview.save` stores it through a new `characters.setAppearance` method with `expectedRevision`; the real character picks it up at its next summon. Owned live peds are not re-dressed in v1.
- **Portraits.** Ped headshots (`REGISTER_PEDHEADSHOT`) serve the native menu. A web portrait needs a capture pipeline (for example Windows Graphics Capture of the game window), which is an open research item.
- **Studio as the control surface.** Studio calls `preview.*` methods that the companion forwards as new pipe ops (`preview_begin`, `preview_apply`, `preview_end`); the player watches GTA on a second monitor or behind an overlay. Studio controls, GTA renders.
- **Guards.** End the session on a cutscene, mission flag, player switch, vehicle entry, or the player moving more than 10 m away.

## 10. Dependencies, risks and open unknowns

Phases 0–5 add no new third-party dependency: RAGENativeUI 1.9.3, the pinned RPH SDK and .NET Framework 4.8.1 are already in use. The biggest risk is not technical novelty but the three diverging native-host lines, followed by four in-game unknowns that a one-evening spike can settle.

| Item | Kind | Impact | Mitigation or spike |
| --- | --- | --- | --- |
| `main` (PS0/PS1), `origin/diagnostics/ps-update-lifecycle` and local unpushed `86d02eb` diverge in `EntryPoint`, `RuntimeEntry`, `PromotedCharactersIntegration`, `SessionIdentityIntegration` | Risk | High: every UX phase edits these files | Phase 0 merges them first and re-runs all native harnesses and the companion suite |
| Steam Input could not emit F13–F24 (November 2025 feature request) | Constraint | Medium: router keys must come from F1–F12 or other spare keys | Pick verified-free keys; config validation refuses any key equal to an Essential binding |
| `SendInput` relay is seen by Essential's `GetAsyncKeyState` poll | Unknown | High for the chord design | Spike S2; fallback for Text is calling `TextInputService.StartTextInputMode()` from the runtime |
| Essential's poll cadence | Unknown | Medium: relay pulse length | `[PS] host_status` shows about 35–38 integration Update calls per second (for example 596 → 947 in 10 s). If Essential's input poll runs at a similar rate, an 80 ms pulse spans at least two polls; measure in S2 |
| RAGENativeUI 1.9.3 on Enhanced | Unknown | Medium | Essential's F7 menu initializes on Enhanced, but RNUI's last release (1.9.3) predates Enhanced; use plain menu items only and verify in S3 |
| Essential binary drift | Risk | High if Essential updates | New seams get a `--controls` metadata pin and a verifier; drift fails closed, as P1/P2/PS do |
| Fiber affinity | Risk | High: P1 owner-thread failures and the PS fiber fix show it matters | All Essential and ped calls happen in `Update`; the loader never references Essential types |
| Cross-domain calls | Risk | Medium | Strings only across `DomainHost`; exceptions caught inside the runtime; the UI rebuilds after an RPH plugin reload |
| Console command registration | Known quirk | Medium | `86d02eb`: explicit `Game.AddConsoleCommands` duplicated commands. New commands stay attributed methods in the loader only, and the loader assembly is never loaded into another domain |
| GTA "Pause Game On Focus Loss" | Constraint | Medium for web clients | Studio labels live controls; setup notes recommend turning the option off for second-screen play |
| Steam overlay under RPH, `steam_api64.dll` in-process, pause behavior | Unknown | Decides A1 | Spike S5 |
| WebView2 overlay window | Later dependency | Only for A2 | Borderless windowed only; z-order, DPI, frame pacing and controller routing need a prototype |
| Companion restart through `ServerLauncher` | Unknown | Low; developer convenience | Spike S6; never offered to players unless reconnect is proven |
| API cost of "ask" commands | Risk | Low to medium | 3 s per-NPC cooldown, one in flight, a visible "asking" HUD line |
| Concurrent edits to `LosSantosAlive.config` by Essential's F7 menu | Risk | Low | Read-only parsing with retry and a file watcher; never write it |
| Preview cameras and peds vs. Essential and other plugins (Smart Vehicle Entry is loaded) | Risk | Medium | Guards, idle timeout, always restore the gameplay camera |
| Same-user trust boundary | Unchanged | Low | Loopback only, per-run token, per-user endpoint file; no LAN |
| Frame cost | Risk | Low | Snapshots built only while a menu is open, target under 0.5 ms per Update; RNUI cost is per frame on the loader fiber; measure with counters like the existing `update_us` |
| No automated GTA tests | Gap | Medium | Each phase ships a physical acceptance checklist, as the P0/P1/P2 docs do |

### Spikes before committing (one evening, throwaway build)

- **S1, router keys:** with Steam Input mapping L4/R4 to two candidate keys, a loader fiber logs `GetAsyncKeyState` edges only while GTA is foreground. Pass: clean edges, no GTA or RPH reaction to those keys.
- **S2, relay:** pulsing F9 and Mouse5 with `SendInput` makes Essential mark a ped (its log records marking) and open text input exactly once per pulse. Record the shortest reliable pulse.
- **S3, RNUI:** a loader-domain `UIMenu` with three items renders and navigates on a controller on Enhanced, coexists with Essential's F7 menu, and survives an RPH plugin reload.
- **S4, bridge:** a `DomainHost.Submit` string reaches `Update` and `SendTextPrompt` produces a normal typed turn in the E1 run log.
- **S5, Steam overlay:** report whether `steam_api64.dll` and `gameoverlayrenderer64.dll` are loaded in `GTA5_Enhanced.exe` under RPH, and whether `ActivateGameOverlayToWebPage` opens `http://127.0.0.1:37921`.
- **S6, companion restart:** `StopServer` then `RequestEnsureServerRunning` reconnects the bridge without breaking the next turn.

## 11. Staged implementation plan

Eight small phases, each one PR with offline tests and a physical GTA gate, ordered so every phase is usable on its own. Phases 0–2 deliver the chord feature; 3–5 deliver the unified UI and settings; 6–7 are optional enrichments.

&#91;embedded content: roadmap · 8 phases, each closed by a GTA gate; dashed = optional\]

Read left to right, top row first. Each diamond is the physical GTA gate that closes the phase; P6 and P7 are optional and can be reordered or dropped.

### Phase 0: consolidate the native host (no features)

> Status (October 3, 2026): done on `main`; gate diagnostics and verification on `feature/ux-phase0-1-command-bridge`. See [UX phase 0–1 status](../UX-phase0-1-status.md).

**Goal:** one `main` containing PS0/PS1, the fiber-access fix and `86d02eb`.

- Push `fix/p2-command-assembly-isolation` (`86d02eb`) unchanged, then rebase it onto `main` (`f533942`).
- `RuntimeEntry.cs`: keep `86d02eb`'s single-owner `startClaim`, `Prepare()` before `IntegrationManager.Register`, and `RequestShutdown()`; keep `main`'s optional `IntelligenceIntegration` hosting and `OwnerRetired` wiring.
- `PromotedCharactersIntegration.cs`: keep `IsReady`, `Prepare`, `RequestShutdown`, `ResetForClockDiscontinuity`; keep `main`'s `PerceptionRoster` and make the clock-reset path raise `OwnerRetired` for every retired registration, as `Retire()` already does.
- `SessionIdentityIntegration.cs`: keep `InstallDeferred` and the staged diagnostics.
- Merge `origin/diagnostics/ps-update-lifecycle` on top and reconcile it with the deferred-initialization order.
- `buildCharactersAddon.mjs`: package `LSA.PromotedCharacters.Bootstrap.dll` (already started in `86d02eb`).
- **Tests:** `node tools/runTests.mjs`; native `OfflineTests`, `ControlChannelTests`, `HostTests`, `lifecycle-tests`, `runtime-tests`, intelligence unit and integration tests.
- **Gate:** exactly seven canonical `LSA*` commands with no numbered aliases, `essential_host_ready`, a successful `LSAPromote`, healthy `[PS] host_status`, then spikes S1–S6 (section 10).

### Phase 1: command bridge and contracts (no visible change)

> Status (October 3, 2026): implemented and verified offline on `feature/ux-phase0-1-command-bridge`; GTA gate pending. See [UX phase 0–1 status](../UX-phase0-1-status.md) for the deliberate differences from this section.

**Goal:** a string-only path from the loader into `Update`, a read-only current-NPC view, and an API handshake that no longer scrapes HTML.

- **Bootstrap** `DomainHost.cs`: add `string Submit(string envelopeJson)`, `string TryTakeResult(string id)`, `string Snapshot()` and `void RequestSnapshots(int forMs)`. They reflect into `RuntimeEntry` like `Ready` and `Alive`, accept at most 8 KiB and return at most 16 KiB.
- **Runtime** `RuntimeEntry.cs`: static pass-throughs to the integration.
- **New** `native/promoted-characters/LocalCommandQueue.cs`: capacity 16, `OperationAdmission` with a run-local epoch, results kept 30 s (at most 64).
- **New** `native/promoted-characters/NativeCommands.cs`: `current.inspect` (read-only), `npc.ask` (section 8 sketch), `gates.read` (`TextInputService.IsOpen`, `LsaControlsMenu.BlocksLsaInput`, cutscene, switch, mission, loading screen).
- `PromotedCharactersIntegration.Update`: drain the local queue after the pipe within one shared budget of 4 per tick; rebuild the snapshot every 250 ms while snapshot interest is active.
- `ControlChannel.cs` and `nativeOwnerClient.mjs`: add the read-only `current` op (section 7).
- **Pins:** `tools/native-metadata/Program.cs` gets a `--controls` mode covering `InputController.SendTextPrompt`, `TextInputService.get_IsOpen`, `LsaControlsMenu.get_BlocksLsaInput`, `NpcTargeting.IsValidHumanPed`, `NpcRoleManager.GetRoleName` and `CanUseAction`, and `NpcState.IsActionBlocked`. Add `docs/controls-native-metadata.json`, `tools/verifyControlsContract.mjs` and a `controlsContract` entry in the build manifest.
- **Companion:** `src/control/endpointFile.mjs`, written after the editor starts and removed on close.
- **Loader:** `PlayerCommands.Send` reads the endpoint file instead of `GET /` plus regex; the `/api` body is unchanged.
- **Tests:** queue admission (bad UUID, expired, duplicate, full), size caps, result expiry; a reflection test that every public `DomainHost` member uses only `string`, `int` or `bool`; companion tests for the endpoint file and the `current` op.
- **Gate:** S4 in GTA, and the existing seven console commands behave exactly as before.

### Phase 2: InputRouter and chord MVP

> Status (October 4, 2026): implemented and verified offline on `feature/ux-phase2-3-router-menu`; GTA gate pending. See [UX phase 2–3 status](../UX-phase2-3-status.md) and [controller setup](../controller-setup.md).

**Goal:** L4 = Mark, R4 = Text, L4+R4 = Follow current NPC, with real suppression.

- **New** `contracts/commands.v1.json` with `essential.mark`, `essential.text`, `current.follow`, `current.wait`, `current.dismiss`, `current.promote`, `npc.ask`.
- **New, compiled into the loader** (`native/enhanced/`): `Input/LogicalKey.cs`, `GestureBinding.cs`, `GestureTiming.cs`, `GestureRecognizer.cs` (pure); `Input/Win32KeySource.cs` (`GetAsyncKeyState`, foreground check); `Input/EssentialBindings.cs` (reads `LosSantosAlive.config` with a watcher and never keeps `ApiKey`); `Input/EssentialKeyRelay.cs` (`SendInput`, keyboard and XBUTTON); `Input/InputGates.cs`; `Input/InputRouter.cs` (per-frame GameFiber); `Commands/CommandEnvelope.cs`, `CommandCatalog.cs` (generated from the contract), `LoaderDispatcher.cs`; `Companion/CompanionClient.cs` (moved out of `PlayerCommands`); `Settings/EnhancedSettings.cs` (`LSA.Enhanced.json`, input disabled by default); `Feedback/Hud.cs`.
- `EntryPoint.Main` starts the router fiber when `input.enabled` is true and stops it in `Shutdown`.
- **`current.follow` flow:** read the latest `DomainHost.Snapshot()`. If the current NPC is owned, POST `control_current` to the companion. If it is ordinary and `ordinaryNpc` is `ask`, `Submit` an `npc.ask` with the expected encounter. Otherwise show "Promote first".
- **Docs:** `docs/controller-setup.md` covers the Steam Input layout (L4 and R4 to router keys; Talk and Marked Talk stay direct) and a rollback note.
- **Tests:** `native/enhanced/input-tests` with the gesture matrix, the bindings parser, a relay stub and settings validation.
- **Gate:** 20 taps each give 20 marks and 20 text prompts; 20 chords in both orders give zero marks, zero text prompts and 20 follows or asks; a 5 s chord hold gives one follow; nothing fires with text input, the F7 menu or the console open; alt-tab mid-chord leaves nothing stuck.

### Phase 3: native menu v1

> Status (October 4, 2026): implemented and verified offline on `feature/ux-phase2-3-router-menu`; GTA gate pending. See [UX phase 2–3 status](../UX-phase2-3-status.md) for the deliberate differences from this section (select twice instead of hold-to-confirm, one host fiber, `LSAMenu`).

**Goal:** Current NPC, Characters, Controls and Diagnostics pages in RNUI.

- `Loader.csproj` references RAGENativeUI as a compile-only, hash-pinned reference (`LSA_RNUI_REFERENCE`); `buildCharactersAddon.mjs` verifies the hash. The DLL is never packaged.
- **New** `native/enhanced/Ui/`: `UiHost.cs` (fiber and `MenuPool`), `Menus/CurrentNpcMenu.cs`, `CharactersMenu.cs`, `CharacterDetailMenu.cs`, `ControlsMenu.cs`, `AiVoiceMenu.cs` (read-only), `DiagnosticsMenu.cs`, `OnscreenKeyboard.cs`, and pure `ViewModels/*.cs`.
- Bindings `ui.mainMenu` (keyboard) and `ui.quickMenu` (L4+R4 hold) are added to the catalog.
- **Companion:** `current.describe` as a legacy `/api` action until Phase 4.
- **Tests:** view-model mapping from snapshot and API JSON, including companion-offline and host-unavailable states.
- **Gate:** open and close by key and chord-hold; Follow, Wait and Dismiss from the menu; roster Summon and Dismiss; rename via the keyboard; memory selection toggle; graceful pages with the companion or native host down.

### Phase 4: ControlService v1 and Studio

- `src/control/*` and `src/studio/*` as in section 7. `bootstrap.mjs` starts the server whenever the companion runs. Legacy `/api` maps onto v1; `CompanionClient` moves to `/api/v1`.
- **Tests:** registry, unavailable methods, error codes; every existing security test in `p2-editor.test.mjs` ported, plus a CSP check for `script-src 'self'`; an Acorn parse of `studio/app.js`.
- **Gate:** Studio has parity with today's editor plus Current NPC and Diagnostics panels; the native menu is unaffected.

### Phase 5: settings

- `contracts/settings.v1.json`; `src/settings/settingsSchema.mjs`, `settingsService.mjs`, `atomicJsonFile.mjs`, `linkedSettings.mjs`; `methods/settings.mjs`; Studio pages generated from the schema; the native Controls page edits hot settings and the AI page edits restart-scoped player toggles.
- `eventContract.mjs` gains `settings_saved` and `settings_rejected`.
- **Tests:** validation through the existing normalizers, revision conflicts, linked two-file rollback, no secret ever returned, `LosSantosAlive.config` never written.
- **Gate:** the chord window changes live in-game; toggling early TTS in Studio shows a restart badge; a deliberate wiring mismatch appears in Diagnostics.

### Phase 6: in-game web (optional)

- If S5 passed: `native/enhanced/Web/SteamOverlay.cs` calls the Steamworks flat API (`ActivateGameOverlayToWebPage`) from an "Open Studio" menu item.
- Otherwise: an A2 prototype in `tools/overlay-host/` (.NET 8, WebView2) behind a developer flag.
- **Gate:** open and close in-game; edits persist; GTA's behavior while open is documented.

### Phase 7: preview and portraits (optional)

- Runtime `PreviewSession.cs`; loader `PreviewCamera.cs`; pipe ops `preview_begin`, `preview_apply`, `preview_end`; API `preview.*` and `characters.setAppearance`; headshot acquire and release.
- **Gate:** begin, orbit, apply, save and end; every guard aborts cleanly; no leaked peds or cameras after 20 cycles.

## 12. Highest payoff for the least complexity

Phase 2, the chord MVP, built on Phase 0 and the bridge half of Phase 1 (`DomainHost.Submit`, `npc.ask`, the endpoint file). It is used every minute of play, needs no UI framework or new dependency, and reuses two paths that already work: P2 `control_current` for promoted characters and Essential's own typed turn for everyone else.

- **For the player:** L4 and R4 behave exactly as today; pressing both makes the current companion follow, or asks an ordinary NPC to follow, with a one-line HUD confirmation.
- **Rough size:** under 1,500 lines of C#, most of it the gesture recognizer and its tests; the companion only gains the endpoint file.
- **Thinnest possible slice** if the bridge slips: promoted-only Follow through the existing `PlayerCommands.Send("follow")` path plus the relay, with no runtime change. Ordinary NPCs show "Promote first" until `npc.ask` lands.
- **Next best payoff:** the Current NPC page from Phase 3, opened by holding the chord. It puts Promote, Follow, Wait, Dismiss and status one gesture away without a browser.

## 13. What should wait for later roadmap systems

Anything that would display or steer semantics the runtime does not have yet should wait; building UI first would invent behavior the native layer cannot honor.

| Item | Wait for | Why |
| --- | --- | --- |
| Perception views beyond counters (witnesses, awareness, memories of events) | PS2+ | PS1 publishes primitive facts only; its witness and awareness capabilities are false |
| "What this NPC cares about" tuning | SALIENCE | No ranking exists yet |
| Initiative, scene and multi-NPC orders | SCENE\_DIRECTOR | These must run through Essential's directed interactions and native turn scheduling, not hotkeys |
| Custom actions and activities editor | CUSTOM ACTIONS / ACTIVITIES (`NpcActionRegistry.Register`) | Depends on the action catalog work on `research/essential-action-completion-audit-20261003` |
| Relationship graph and memory timeline | Automatic memory and event writers | Today a relationship is one state plus text per character, and memories are manual |
| Hot-reload of provider, model and voice settings | Per-turn config epochs | `normalizeConfig` is read once and captured by long-lived modules |
| In-game voice audition | Not through the native audio path | Essential authorizes PCM only for exact turns; audition belongs in the browser |
| WebGL preview, in-process browser | Rejected | Sections 3 and 9 |
| LAN or phone second screen | Its own security design | Today's boundary is same-user loopback |
| Portraits in Studio | A capture pipeline | No native texture export exists |
| Destructive gestures | Never | Gestures bind only read and control commands |

## Appendix: file and symbol index

Repository links point at `main` commit `f533942`. `86d02eb` exists only in the local checkout at `C:\Users\Chris.COMRADE\Documents\Codex\repos\LSA-Enhanced-essential-fork` and has no link.

| Area | File | Symbols used in this plan |
| --- | --- | --- |
| Loader | [EntryPoint.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/EntryPoint.cs) | `Main`, `Shutdown`, 100 ms supervision loop |
| Loader | [PlayerCommands.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/PlayerCommands.cs) | Seven `[ConsoleCommand]` methods, `Send`, `const auth=` scrape, single `pending` flag |
| Bootstrap | [DomainHost.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/DomainHost.cs) | `Start`, `Ready`, `Alive`, `Stop`, `CoreStatus` hash pin |
| Bootstrap | [ClrDomains.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/ClrDomains.cs) | `FindEssential`, read-only domain enumeration |
| Runtime | [RuntimeEntry.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/RuntimeEntry.cs) | `Start`, host lifetime fiber, `IntegrationManager.Register` |
| Runtime | [PromotedCharactersIntegration.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/PromotedCharactersIntegration.cs) | `Update` (4 per tick), `Handle`, `Safe`, `Scripted`, `Suspend`, `Retire`, `EncounterFor`, `Appearance`, `Restore`, `ValidateAppearance` |
| Runtime | [ControlChannel.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/ControlChannel.cs) | Pipe ACL, op allowlist, watchdog, `TryTake` |
| Runtime | [NativeSafetyPolicy.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/NativeSafetyPolicy.cs) | `CanControl`, `Current`, `Fresh`, `VariationAvailable`, `OperationAdmission` |
| Runtime | [IntelligenceIntegration.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/intelligence/IntelligenceIntegration.cs) | `[PS]` counters for Diagnostics |
| Runtime | [SessionIdentityIntegration.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/session-identity/SessionIdentityIntegration.cs) | Owner registration used by P2 |
| Config | [LSA.PromotedCharacters.example.json](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/native/promoted-characters/LSA.PromotedCharacters.example.json) | Native wiring keys |
| Companion | [characterService.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/characters/characterService.mjs) | `CharacterService` methods, `#serial`, `FAILURE_REASONS`, `normalizeCharacterConfig` |
| Companion | [editorServer.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/characters/editorServer.mjs) | `startCharacterEditor`, `editorHtml`, headers, action switch |
| Companion | [nativeOwnerClient.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/characters/nativeOwnerClient.mjs) | `NativeOwnerClient.request`, `OWNER_OPERATIONS` |
| Companion | [profileStore.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/characters/profileStore.mjs) | `ProfileStore`, limits, atomic writes |
| Companion | [sessionProfiles.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/characters/sessionProfiles.mjs) | Encounter names by `encounterId` |
| Companion | [bootstrap.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/bootstrap.mjs) | `createRuntimeForBundle`, editor start condition |
| Companion | [e1Config.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/config/e1Config.mjs) | `loadConfig`, `normalizeConfig` |
| Companion | [privateEnvironment.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/config/privateEnvironment.mjs) | Credential allowlist |
| Companion | [decisionValidator.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/context/decisionValidator.mjs) | `validateStockDecision` |
| Companion | [eventContract.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/src/observability/eventContract.mjs) | `EVENT_NAMES`, `safeKeys`, `safeTokens` |
| Tools | [native-metadata/Program.cs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/tools/native-metadata/Program.cs), [verifyCharactersContract.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/tools/verifyCharactersContract.mjs), [buildCharactersAddon.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/tools/buildCharactersAddon.mjs) | Seam pinning and native packaging |
| Tests | [p2-editor.test.mjs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/lsa-essential-e1-candidate/tests/p2-editor.test.mjs) | Security tests to port in Phase 4 |
| Docs | [Extension API analysis](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/docs/plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md), [P2 status](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/docs/P2-promoted-characters-status.md), [P2 native evidence](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/docs/P2-native-evidence.md), [P2 host correction](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/docs/P2-rage-host-correction.md), [ROADMAP](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/f53394213f8d7b20868e2cbee88f3cbed63c87eb/docs/ROADMAP.md) | Essential seams, P2 behavior, roadmap |
| Evidence | [RPH log, 2026-10-03](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a606bb853e64a06bf8352e562e73b8331ea4804d/acceptance-logs/RagePluginHook-fiber-fix-20261003.log) | RPH 1.132.1428, GTA 1.0.1158.16, bindings, F7 menu, AppDomains, `[PS]` counters |

Essential DLL findings (no public Mark method; `GetAsyncKeyState` owners; callers of `StartTextInputMode`, `SendTextPrompt` and `UIMenu.IsAnyMenuVisible`) come from a metadata and IL call-graph scan of the pinned `upstream/LosSantosAlive.dll` done for this plan. Method bodies are obfuscated, so only call targets, not internal logic, are claimed.

### External sources

- [Steam Input activators](https://github.com/SteamInputWiki/SteamInputWiki/blob/main/chapter-4/changing_things_up.md) and a [chord discussion](https://steamcommunity.com/app/353370/discussions/0/2974023911553323128/); [F13–F24 limitation](https://steamcommunity.com/discussions/forum/10/691994126364844678/)
- [RAGENativeUI releases](https://github.com/alexguirre/ragenativeui/releases), [RAGENativeUI site](https://ragenativeui.org/)
- [RPH Game class](https://docs.ragepluginhook.net/html/T_Rage_Game.htm), [RPH GameConsole](https://docs.ragepluginhook.net/html/T_Rage_GameConsole.htm)
- [CefSharp AppDomain support](https://github.com/cefsharp/CefSharp/issues/29), [CefSharp inside a host application](https://github.com/cefsharp/CefSharp/discussions/4480)
- [Steamworks overlay](https://partner.steamgames.com/doc/features/overlay)
- [DISPLAY\_ONSCREEN\_KEYBOARD](https://github.com/citizenfx/natives/blob/master/MISC/DisplayOnscreenKeyboard.md), [REGISTER\_PEDHEADSHOT](https://github.com/citizenfx/natives/blob/master/PED/RegisterPedheadshot.md)
- [GTA V "Pause Game On Focus Loss"](https://steamcommunity.com/app/271590/discussions/0/5188757896258158736/)
