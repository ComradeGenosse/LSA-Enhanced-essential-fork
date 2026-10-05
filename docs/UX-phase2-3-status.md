# UX phases 2–3 — input router, chord MVP and native menu

Updated October 5, 2026. Historical implementation branch: `feature/ux-phase2-3-router-menu`, originally stacked on UX0/1. Plan: [LSA Enhanced UX plan](plans/LSA-Enhanced-UX-plan.md), section 11.

**Current status: ✅ merged to `main` and included in the later combined P2/PS/UX deployment lineage; dedicated controller/menu acceptance remains incomplete.** Both features still ship inside the optional P2 loader and remain off until `Plugins/LSA.Enhanced.json` enables them. The historical offline counts below describe the implementation branch, not the exact current-main test head. Controller and keyboard setup: [controller setup](controller-setup.md).

## What was delivered

### Phase 2: InputRouter and chord MVP

| Plan item | Implementation |
| --- | --- |
| Command contract | `contracts/commands.v1.json`: 19 commands in six classes (`read`, `control`, `lifecycle`, `destructive`, `profile`, `ui`), one executor each, and fixed player-facing reason texts. Embedded in the loader as `LSA.Enhanced.commands.v1.json`; `CommandCatalog.ContractSha256` and the companion's `COMMANDS_CONTRACT_SHA256` pin the same SHA-256, and the loader refuses to start the router on a mismatch |
| Settings | `Settings/EnhancedSettings.cs` reads `Plugins/LSA.Enhanced.json` (at most 16 KiB, strict schema, errors name the setting). Input and menu default off. Polled once a second for hot reload; a rejected file keeps the previous settings and logs `[UX] settings_rejected <setting>: <problem>`. `LSA.Enhanced.example.json` is packaged |
| Gestures | `Input/GestureRecognizer.cs` (pure): tap, chord, hold, chord-hold and double-tap per key group. The chord window counts from the first key's press; a tap fires on release or when the window ends; a chord fires on press unless a chord-hold is bound, then on release; every output waits for a full release, so nothing repeats while held and a late second key is swallowed |
| Essential's keys | `Input/EssentialBindings.cs` reads only `TalkKey`, `TextKey`, `MarkPedKey` and `MarkedPedTalkKey` from `Plugins/LosSantosAlive/LosSantosAlive.config` (numeric codes first, as Essential does). Every other line, `ApiKey` included, is skipped while reading and never becomes a string; the file is never written. Reloaded when it changes; a file locked mid-write keeps the previous keys and is retried a second later |
| Relay | `Input/EssentialKeyRelay.cs`: one `SendInput` pulse (keyboard, or XBUTTON for Mouse4/Mouse5) of Essential's own Mark or Text key. The key-up is scheduled from the router fiber (`relayPulseMs`, 80 ms) and forced on focus loss, settings changes and shutdown. A quick tap of the other key inside a pulse waits in a one-slot queue |
| Gates | `Input/InputGates.cs`: nothing fires without game focus, with the RPH console open, while paused, while an LSA menu is open, with Essential's text input or F7 menu open, or during loading, cutscenes and player switches. The last three come from the runtime snapshot (the P2 bridge); when it is stale or unavailable they do not block relays, because a relayed key is exactly what the player could press. A router key held while settings reload waits for its release |
| Router | `Input/InputRouter.cs` polls the router keys with `GetAsyncKeyState` once per frame on the loader fiber, keeps snapshot interest alive while focused, suspends with `Input paused: F6 is also Essential's MarkPedKey` when a router key equals an Essential key, and logs `[UX] input_latency` per key |
| Dispatcher | `Commands/LoaderDispatcher.cs`: relay → Essential's key; `current.*` → P2 `control_current` for a promoted NPC, otherwise `npc.ask` with the expected encounter when `ordinaryNpc` is `ask`, otherwise `Promote this NPC first`; `npc.ask` → bridge; `character.*` and `current.promote` → the companion API. `control_current` and `promote` name the encounter the player saw (`expectedEncounterId`), and the companion refuses a different current NPC with `target_changed`. Gesture repeats inside 750 ms are dropped; one outstanding job per class; HUD text only from the catalog; the last 10 failures are kept for Diagnostics |
| Companion client | `Companion/CompanionClient.cs`, moved out of `PlayerCommands`: endpoint-file token, page fallback, one retry after a 403, bounded bodies and error codes. A success whose body exceeds the caller's limit stays a success without the body; only a failed connection counts as "AI companion is unavailable". `PlayerCommands` now uses it and the shared `CommandEnvelope`; console output and behavior are unchanged |
| Host and HUD | `EnhancedHost.cs` runs the router and the menu on one GameFiber (`LSA Enhanced input and menu`), started by `EntryPoint` after `PlayerCommands.Initialize` and stopped in `Shutdown`. It idles at 10 Hz while input and menu are off. HUD lines are notifications, subtitles or off (`feedback.hud`), with repeats inside 1.5 s suppressed |

### Phase 3: native menu v1

| Plan item | Implementation |
| --- | --- |
| RAGENativeUI | Compile-only reference to the NuGet RAGENativeUI 1.9.3 `lib/net472` DLL, SHA-256 `d2607481b206e7907c9c1f2cabf15797654aacaaf1746ea202740dcdd5eb8bbb`, passed as `LSA_RNUI_REFERENCE` and verified by `buildCharactersAddon.mjs`. It is never packaged; Essential's payload installs RAGENativeUI. At runtime `Ui/UiBridge.cs` requires assembly version 1.9.3.0 before creating any menu |
| Isolation | `UiBridge` and `EnhancedHost` name no RNUI type. `Ui/NativeMenu.cs` holds every RNUI reference and is created through a non-inlined factory only after the guard passes. If RNUI is missing, a different version, or the menu fails ten frames in a row, the log says `[UX] menu_unavailable reason=…`, the `ui.*` bindings are dropped and gestures and console commands keep working |
| Pages | Main menu, Current NPC, Characters, Character, Controls, AI and voice, Diagnostics (below). Pure view models in `Ui/ViewModels/MenuModels.cs`; companion data in `Ui/MenuData.cs`, applied on the loader fiber |
| Text entry | GTA's on-screen keyboard (`Ui/OnscreenKeyboard.cs`, natives by hash) for names (80 characters) and short memories (256). The menu hides while typing; longer text stays in the character editor |
| Companion | Legacy `/api` action `current_describe` (`src/control/currentDescribe.mjs`): names for the Current NPC page. Read-only (`SessionProfiles.peek` never assigns a name), returns display fields only (`kind`, `name`, `characterId`, `relationship`, `status`, `voice`, up to three role facts) and validates both ids. `promote` and `control_current` accept an optional `expectedEncounterId`; callers without it (console, editor) are unchanged |
| Opening | The menu key (`ui.mainMenu`, F11), the chord-hold (`ui.quickMenu`, Current NPC page; Back closes it) and the new console command `LSAMenu`. It does not open over another plugin's RNUI menu (RNUI's cross-plugin `IsAnyMenuVisible`), closes itself when the runtime snapshot shows Essential's text input or F7 menu, stays hidden while the game is paused, and stops reading its keyboard if Essential's text input opens |

| Page | Content | Actions |
| --- | --- | --- |
| Main menu | Links to the pages; the character editor address | — |
| Current NPC | Name and role or voice (`current_describe`), promoted or not, Following/Waiting, relationship, scripted-state block, companion and host availability | Promoted: Follow, Wait, Dismiss (confirm), Character details. Ordinary: Promote (confirm), Ask to follow, Ask to wait |
| Characters | Roster from the companion's `list`, with In world / Suspended / Absent / Dead / Retired; refreshed every 10 s while open | Open a character; Refresh |
| Character | Status, relationship, availability, memories with their dialogue selection | Summon, Follow, Wait, Dismiss (confirm), Despawn (confirm, addon-created peds only), Rename (keyboard), Relationship and Availability (choose, then select to save), memory checkboxes, Add a short memory (keyboard) |
| Controls | Gestures on/off, chord window, router state, router keys, active bindings, Essential's four keys, conflicts | Pause or resume gestures and change the chord window for this session |
| AI and voice | Provider, models, voice and assignment, speed, acting, streaming, early speech, identity, promoted characters and perception mode from `e1.config.json`; whether the `.env` credential file exists (its contents are never read) | Read-only |
| Diagnostics | Native host and bridge, snapshot age, companion reachability and endpoint file, router state, settings revision, catalog hash, pending requests, the last 10 failures | Re-check; write one `[UX] diagnostics` line to the RPH log |

Every edit sends the profile's `revision`, so a change made in the editor at the same time is refused with `Character changed elsewhere; refresh` and the roster reloads.

### Deliberate differences from the plan

1. **Select twice instead of hold-to-confirm.** Promote, Dismiss and Despawn change to `Confirm: …` with the target's name (and id suffix for characters); a second select within 4 s runs the action, while moving away, waiting or a change of the current NPC cancels it. RNUI 1.9.3 activates items when Select is released, so timing a held Select would need disabled-control polling that differs between keyboard and controller and cannot be tested offline.
2. **Promote is confirmed too,** like the other lifecycle actions.
3. **Menu selections skip the gesture cooldown.** The 750 ms cooldown is for repeated gestures; an explicit menu selection (for example several memory checkboxes) is never dropped silently. One outstanding job per class still applies and is shown on the HUD.
4. **File layout.** One host fiber (`EnhancedHost.cs`) serves the router and the menu instead of separate fibers; all pages live in `NativeMenu.cs` over pure view models instead of one class per page; `UiBridge.cs` replaces `UiHost.cs`; the HUD is part of the host. `CommandEnvelope` is in `Commands/Contracts.cs` and bindings and timing in `Input/Gestures.cs`.
5. **The router needs the P2 loader,** like the phase 1 bridge: it starts only when `LSA.PromotedCharacters.json` is enabled.
6. **Out of scope here:** portraits (phase 7) and a separate World and intelligence page; the perception mode is a line on the AI page.
7. **`LSAMenu`** opens the menu from the console, so the menu can be tested without gestures. The console now lists ten `LSA*` commands.
8. **More reason texts.** The catalog also covers the companion's and runtime's own failure codes (`invalid_capture`, `evidence_unavailable`, `profile_store_limit`, `invalid_target`, `duplicate_request` and others), so the HUD never shows a raw code for a known failure.

## LSA.Enhanced.json

```json
{
  "version": 1,
  "input": {
    "enabled": false,
    "keys": { "L4": "F6", "R4": "F8", "Menu": "F11" },
    "timing": { "chordWindowMs": 120, "holdMs": 600, "doubleTapMs": 250, "relayPulseMs": 80, "commandCooldownMs": 750 },
    "bindings": [
      { "id": "mark", "gesture": "tap", "keys": ["L4"], "command": "essential.mark" },
      { "id": "text", "gesture": "tap", "keys": ["R4"], "command": "essential.text" },
      { "id": "follow", "gesture": "chord", "keys": ["L4", "R4"], "command": "current.follow" },
      { "id": "quickMenu", "gesture": "chordHold", "keys": ["L4", "R4"], "command": "ui.quickMenu" },
      { "id": "menu", "gesture": "tap", "keys": ["Menu"], "command": "ui.mainMenu" }
    ]
  },
  "quickCommands": { "ordinaryNpc": "ask", "phrases": { "follow": "Follow me.", "wait": "Wait here.", "dismiss": "That's all, you can go." } },
  "ui": { "enabled": false },
  "feedback": { "hud": "notification" }
}
```

| Setting | Values |
| --- | --- |
| `input.keys` | 1–8 logical keys mapped to key names; reserved keys (F4, F7, F12, Escape, Enter, Tab, Space, left/right/middle mouse) and duplicates are refused |
| `input.timing` | `chordWindowMs` 40–250, `holdMs` 300–3000 and at least the window + 100, `doubleTapMs` 100–500, `relayPulseMs` 30–200, `commandCooldownMs` 250–3000 |
| `input.bindings` | Up to 16; gestures `tap`, `chord`, `hold`, `chordHold`, `doubleTap`; only commands the catalog marks as gestures (`essential.mark`, `essential.text`, `current.follow`, `current.wait`, `ui.mainMenu`, `ui.quickMenu`). Omit the array for the defaults |
| `quickCommands` | `ordinaryNpc` `ask` or `off`; phrases of 1–120 characters (`dismiss` may be empty to turn that ask off) |
| `ui.enabled`, `feedback.hud` | Menu on/off; `notification`, `subtitle` or `off` |

## Offline verification

| Check | Result |
| --- | --- |
| Companion suite (`node tools/runTests.mjs`) | **361 passed**, 0 failed (+12: `current-describe.test.mjs`, `commands-contract.test.mjs`) |
| `ux-input` (new, Mono) | **364 assertions**: catalog and settings validation, the gesture matrix, Essential's config parser (streamed, locked files), relay pulses and the one-slot queue, dispatcher routing, expectations and reasons, the router against the phase 2 gate (20 taps, 20 chords in both orders, a 5 s chord hold, every gate, alt-tab mid-chord and mid-pulse, keys held across a reload, conflicts), view models for every page, the companion data client, the real loopback client (size limits, error codes, no server), the RNUI guard and failure handling, session overrides and the packaged example |
| `p2-bridge` (Mono) | **242 assertions** (+`LSAMenu`); the console frontend still runs the endpoint-file, page-fallback and 403-retry handshake against a loopback server through the shared client |
| `p2-offline`, `p2-runtime`, `p1-offline`, `ps-host` | 39, 34, 19 assertions; `ps-host` unchanged |
| Fault injection | 36 deliberate faults in the recognizer, gates, router, relay, Essential's config reader, dispatcher, loopback client, settings, UI bridge, data client, view models and envelope: 35 failed `ux-input` (some only after tests were added for them). The survivor is redundant: the recognizer's "wait for full release" state is also enforced by the rule that a key already down never starts a gesture |
| Independent review | A separate review of the RNUI layer against the RNUI 1.9.3 IL, the AppDomain and type-loading boundary, input safety and the companion API found no high-severity defects. Its findings were fixed: oversized replies no longer read as "companion down", confirmations and companion requests are bound to the NPC the player saw, no reopening over another plugin's menu, reload and keyboard edge cases, game-thread blocking in config reads, and parsing moved off the game fiber |
| Builds | `buildCharactersAddon` (stage `P2+PS0+PS1+UX1+UX2+UX3`, `uxContract` in the manifest) with the pinned RPH 1.124.0 SDK, RNUI 1.9.3 reference, net481 references and DamageTrackerLib; `buildCandidate`. The loader references `RAGENativeUI` and embeds the contract; RNUI types appear only in `NativeMenu` |

As before, `p2-facts`, `p2-host` (now expects ten commands), `p2-lifecycle`, `ps-unit`, `ps-integration` and `p1-facts` need Windows named pipes or `ICorRuntimeHost`; run them on Windows as described in [UX phase 0–1 status](UX-phase0-1-status.md). The new tests run there too:

```powershell
dotnet build native/enhanced/input-tests/InputTests.csproj -c Release "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/enhanced/input-tests/bin/Release/net481/InputTests.exe
```

To build the addon, add the RNUI reference to the usual variables:

```powershell
$env:LSA_RNUI_REFERENCE = '<NuGet RAGENativeUI 1.9.3>\lib\net472\RAGENativeUI.dll'
node tools/buildCharactersAddon.mjs
```

## GTA acceptance checklist

Deploy the new loader and the companion only through the existing controlled procedure. Copy `LSA.Enhanced.example.json` to `Plugins/LSA.Enhanced.json` and set `input.enabled` (phase 2) and `ui.enabled` (phase 3). Map L4/R4 to F6/F8 as in [controller setup](controller-setup.md).

Phase 2 gate (spikes S1 router keys and S2 relay)

- [ ] `RagePluginHook.log` shows `[UX] enhanced_host_started`, `[UX] essential_keys …` with Essential's real keys, `[UX] settings_loaded … input=True`, `[UX] input_router state=ready` and `[UX] input_latency L4=120ms R4=120ms Menu=0ms`.
- [ ] 20 L4 taps give 20 marks and 20 R4 taps give 20 text prompts, exactly as Essential's own keys.
- [ ] With `ui.enabled` off: 20 chords in both orders give zero marks, zero text prompts and 20 follows (promoted) or asks (ordinary NPC: the NPC answers as for typed input). A 5 s chord hold gives one follow.
- [ ] Nothing fires with Essential's text input, the F7 menu or the RPH console open, while paused, or during a cutscene.
- [ ] Alt-tab while holding L4, or mid-chord: on return nothing fires and no key is stuck; the next tap marks normally.
- [ ] Set a router key to Essential's Mark key: the HUD shows `Input paused: …` and nothing fires. Restore it.
- [ ] Change `chordWindowMs` while playing: a new `[UX] settings_loaded` and `[UX] input_latency` line appear within a second.

Phase 3 gate (spike S3 RAGENativeUI on Enhanced)

- [ ] The log shows `[UX] menu state=ready rnui=1.9.3.0`.
- [ ] F11 opens and closes the menu; `LSAMenu` toggles it; holding both buttons opens the Current NPC page and holding them again closes it. Gestures pause while it is open.
- [ ] Open Essential's F7 menu while the LSA menu is open: the LSA menu closes and the HUD says `Essential's text input or menu is open`.
- [ ] Current NPC: an ordinary NPC shows its session name after you talked to it, Promote asks for a second select; a promoted NPC shows its name, mode and relationship, and Follow, Wait and Dismiss work.
- [ ] Characters: the roster shows each character's status; Summon an absent character, then Dismiss it.
- [ ] Character: rename with the on-screen keyboard; change relationship and availability; toggle a memory and see the change in the character editor.
- [ ] Controls: pausing gestures stops them; a new chord window shows a new `[UX] input_latency` line.
- [ ] AI and voice shows the companion's settings and `OpenAI key file: Present`; Diagnostics writes a `[UX] diagnostics` line.
- [ ] Stop the companion: Characters says `AI companion is unavailable` and companion actions are greyed out; start it again and use Refresh.
- [ ] Optional: unload and reload the loader; the menu works again in the new session (the P2 runtime's single owner still needs a GTA restart, as before).

If any menu step fails, set `ui.enabled` to false; gestures and console commands keep working. If gestures misbehave, set `input.enabled` to false. Both apply within a second without restarting GTA. An older loader ignores `LSA.Enhanced.json`.
