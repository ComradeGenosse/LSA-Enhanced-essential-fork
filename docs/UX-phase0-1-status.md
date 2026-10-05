# UX phase 0–1 — consolidated host and command bridge

Updated October 5, 2026. Historical implementation branch: `feature/ux-phase0-1-command-bridge`, based on the October 3 `main` baseline. Plan: [LSA Enhanced UX plan](plans/LSA-Enhanced-UX-plan.md), section 11.

**Current status: ✅ merged to `main` and included in the later combined P2/PS/UX deployment lineage.** The original branch verification below remains the implementation evidence for this phase; it is no longer correct to read the branch ref or the original “nothing deployed” note as unfinished work. Full dedicated UX0/1 controller acceptance is still not separately closed.

## What was delivered

Phase 0 needed no merge work: `main` already contains `86d02eb`, `52f5d2d`, `046a271` and `f533942`, and `origin/diagnostics/ps-update-lifecycle` has nothing that `main` lacks. This branch adds the two diagnostics the phase gate needs and re-runs every harness.

| Plan item | Implementation |
| --- | --- |
| Phase 0 gate diagnostics | Loader logs `[UX] steam_modules steam_api64=<bool> gameoverlayrenderer64=<bool>` once at start (spike S5, module part) and `[UX] command_bridge available=<bool>` once the host is ready |
| `DomainHost` bridge | `Submit(string)`, `TryTakeResult(string)`, `Snapshot()`, `RequestSnapshots(int)`, `BridgeAvailable`. They reflect into `RuntimeEntry` like `Ready`/`Alive`, accept at most 8 KiB, return at most 16 KiB, and contain runtime failures. Only `string`, `int` and `bool` cross the domain |
| `RuntimeEntry` | Static pass-throughs; refuse work while stopping or before the integration exists |
| `LocalCommandQueue.cs` | CommandEnvelope v1 admission through `OperationAdmission` with a queue-local epoch (UUID, at most 5 s to expiry, 256-id de-duplication), 16 pending, results delivered once, kept 30 s, at most 64 |
| `NativeCommands.cs` | `current.inspect`, `gates.read`, `npc.ask` as a partial of `PromotedCharactersIntegration`; snapshots every 250 ms only while requested |
| Shared budget | `Update` runs pipe requests first, then loader commands, within the existing four per tick |
| Read-only `current` op | Added to the `OperationAdmission` allowlist (`ControlChannel`), `Handle`, and `OWNER_OPERATIONS` in `nativeOwnerClient.mjs` |
| Pins | `tools/native-metadata --controls`, `docs/controls-native-metadata.json`, `tools/verifyControlsContract.mjs`, required `controlsContract` in the addon build manifest (stage `P2+PS0+PS1+UX1`) |
| Companion endpoint file | `src/control/endpointFile.mjs`; the editor publishes it after listening and removes it on close or exit |
| Loader handshake | `PlayerCommands.Send` reads the endpoint file instead of scraping `GET /`; the `/api` body is unchanged |

### Deliberate differences from the plan

1. **Pins cover only what Phase 1 calls:** `InputController.SendTextPrompt`, `TextInputService.get_IsOpen`, `LsaControlsMenu.get_BlocksLsaInput` and `NpcTargeting.IsValidHumanPed`. `NpcRoleManager.GetRoleName`/`CanUseAction` and `NpcState.IsActionBlocked` belong to the optional direct mode and get pinned when that mode is built. The built runtime's Essential member references were checked against the union of all pinned metadata files.
2. **Two diagnostic console commands,** `LSACurrentNpc` and `LSAAskCurrent`, make spike S4 testable before the Phase 2 router exists. The console therefore lists nine `LSA*` commands. Gameplay is otherwise unchanged.
3. **The page handshake stays as a fallback.** A missing or invalid endpoint file uses the old `GET /` token, and a 403 with a file token retries once with the page token. A new loader keeps working with an older companion during rollout; the editor rejects bad tokens before doing any work, so the retry cannot repeat an operation.
4. **No companion consumer of `current` yet.** `current.get` belongs to ControlService v1 (Phase 4); Phase 1 adds only the native op and the client allowlist entry.
5. **The envelope is strict.** `target.expect` holds exactly `encounterId`; `source` is one of `console`, `chord`, `menu` or `studio`.

## Command bridge contract

```json
{ "v": 1, "id": "0d9c2f4e-8a61-4f0b-9c7e-3b1d5a7e2c10", "command": "npc.ask",
  "target": { "kind": "current", "expect": { "encounterId": "7a3e9b1c-5d2f-4e8a-b6c4-1f0e9d8c7b6a" } },
  "args": { "phrase": "Follow me." }, "source": "console",
  "issuedAtUtc": 1791065500000, "expiresAtUtc": 1791065504000 }
```

| Command | Target | Args | Result |
| --- | --- | --- | --- |
| `current.inspect` | `{kind:"current"}` | `{}` | `{present:false}` or `{present, pedId, encounterId, ownerAlias, owned, suspended, mode, human, safe}` |
| `gates.read` | `{kind:"none"}` | `{}` | `{textInputOpen, controlsMenuOpen, cutscene, playerSwitch, mission, online, loading, inputFree, scripted}` |
| `npc.ask` | `{kind:"current", expect:{encounterId}}` | `{phrase}` (1–120 characters, no control characters) | `{status:"asked", encounterId}` |

The current NPC is `NpcTargeting.GetPlayerConversationPed() ?? GetCurrentSpeakerPed()`, the same selection P2 capture uses. `encounterId` is P2's existing handle-bound encounter UUID; `pedId` is for display only and clients never send handles.

`npc.ask` runs on Essential's Update fiber and refuses, in order: Essential's text input or F7 controls menu open (`input_busy`); loading screen, cutscene, player switch, mission flag or online session (`scripted_state`); no valid live human current NPC (`no_current_npc`); a different current NPC than the player saw (`target_changed`); a directed interaction (`scripted_state`); a second ask to the same NPC within 3 s (`ask_cooldown`). It then calls `InputController.SendTextPrompt(ped, phrase)`, exactly what Essential's own text input calls, so P0 context, P1 identity, the model, `validateStockDecision` and Essential's role gates all still apply. It creates no capture ticket, ownership, task or session.

`Submit` returns `accepted` or one of `invalid_envelope`, `envelope_too_large`, `unsupported_command`, `invalid_target`, `invalid_arguments`, `native_stale`, `duplicate_request`, `queue_full`, `native_unavailable`, `native_operation_failed`. Results are `{v, id, command, status:"ok"|"failed", reason, result}`; failure reasons are bounded codes and carry no payload. Expired commands complete as `native_stale` instead of waiting for a paused game. A game-clock reset completes pending commands as `native_stale`; shutdown completes them as `native_unavailable`. A failing command is contained and never reaches P2's update failure handler.

## Console commands

| Command | Output |
| --- | --- |
| `LSACurrentNpc` | `Current NPC: ped <id>, encounter <8 hex>, not promoted \| promoted (<mode>), human, P2 control allowed now.` plus `Input gates: text input …, controls menu …, scripted state ….` |
| `LSAAskCurrent "<request>"` | Inspects, then asks with the inspected encounter as the expectation. Prints `Sent your request to the current NPC through Essential's text input.` or a fixed-catalog reason such as `Wait a moment before asking this NPC again.` |

One bridge request runs at a time and times out after 6 s per step. Console text comes from a fixed catalog, never from model or profile content.

## Endpoint file

`%LOCALAPPDATA%\LSA Enhanced\control-endpoint.v1.json`, written atomically when the editor listens:

```json
{"version":1,"url":"http://127.0.0.1:37921","token":"<64 hex>","pid":16744,"startedAtUtc":"2026-10-03T20:44:06.000Z"}
```

Only `http://127.0.0.1:<port>` URLs are written or accepted, and the loader requires the URL to match its configured `editorPort`. The file is removed on editor close or process exit, but only while it still holds this server's token and pid, so an older companion never deletes a newer one's file. A killed companion can leave a stale file; the next start overwrites it, and the loader's 403 retry covers the gap. The trust boundary is unchanged: any same-user process can already read the token from `GET /`. Tests pass `controlEndpointPath` (or `null`) and never touch the real location.

## Offline verification

Run on this branch after rebasing onto `b13b027`; the only later change on `main` (`b45f682`) is `docs/ROADMAP.md`.

| Check | Result |
| --- | --- |
| Companion suite (`node tools/runTests.mjs`) | **349 passed**, 0 failed (338 on `main` + 11 new in `control-endpoint.test.mjs`, `controls-contract.test.mjs`) |
| `p2-bridge` (new, Mono) | **241 assertions**: queue admission, caps, retention and concurrency; `DomainHost` surface (string/int/bool only) and bootstrap purity; the real `DomainHost` in a separate `LosSantosAlive_AppDomain` with the pinned Essential DLL loaded but never executed, driving the production runtime sources against game substitutes (gates, cooldown, target changes, shared pipe/loader budget, failing reads and Essential calls, snapshots, clock reset, shutdown); the real `PlayerCommands` through that bridge and against a loopback HTTP server |
| `p2-offline` (.NET 10) | 39 assertions (+6 for `current` and local admission) |
| `p2-runtime` (Mono) | 34 assertions (+5 bridge pass-through) |
| `p1-offline`, `ps-host` | 19 assertions; `ps-host` 10/7/7/11 across its four scenarios, unchanged |
| Fault injection | 20 deliberate faults in the queue, gates, budget, reset, shutdown, failure containment, snapshots, `DomainHost`, `RuntimeEntry` and the loader handshake: 18 failed `p2-bridge`. The two survivors are redundant guards: `DomainHost`'s id-length pre-check (the runtime validates the id again) and `ServeLocal`'s outer catch (command execution and snapshot building already contain their failures) |
| Builds | `buildCharactersAddon` with the pinned RPH 1.124.0 SDK, net481 references and pinned DamageTrackerLib; `buildCandidate` |

Not runnable in this Linux environment because they need Windows named-pipe ACLs or `ICorRuntimeHost`: `p2-facts` (now also covers the `current` op), `p2-host` (now expects nine commands), `p2-lifecycle` (its first two scenarios pass under Mono), `ps-unit`, `ps-integration` and `p1-facts`. Run them on Windows from the repository root:

```powershell
$fw = $env:LSA_IDENTITY_FRAMEWORK_ROOT
foreach ($p in 'promoted-characters/facts-tests/ControlChannelTests','promoted-characters/host-tests/HostTests','promoted-characters/lifecycle-tests/LifecycleTests','promoted-characters/bridge-tests/BridgeTests','promoted-characters/runtime-tests/RuntimeTests','promoted-characters/ps-host-tests/PSHostTests','intelligence/tests/IntelligenceTests','intelligence/integration-tests/IntegrationTests','session-identity/facts-tests/OwnerFactsTests') {
  dotnet build "native/$p.csproj" -c Release --verbosity quiet "-p:TargetFrameworkRootPath=$fw"
  $exe = Get-ChildItem "native/$(Split-Path $p)/bin/Release/net481/*.exe" | Select-Object -First 1
  & $exe.FullName; if ($LASTEXITCODE) { Write-Warning "$p exited $LASTEXITCODE" }
}
dotnet run --project native/promoted-characters/tests/OfflineTests.csproj --verbosity quiet
```

`host-tests` takes the loader and bootstrap DLL paths as optional arguments for its reference checks, as before.

## GTA acceptance checklist

Build both packages as usual (`node tools/buildCharactersAddon.mjs`, `node tools/buildCandidate.mjs`) and deploy only through the existing controlled procedure. Then:

Phase 0 gate

- [ ] `RagePluginHook.log` shows one `[P2] console_frontend_domain=… loader_instances=1`, then `[P2] essential_host_ready` and `[UX] command_bridge available=True`.
- [ ] Record the `[UX] steam_modules steam_api64=… gameoverlayrenderer64=…` values (S5, module part).
- [ ] The console lists exactly nine `LSA*` commands and no numbered aliases.
- [ ] With PS shadow enabled, `[PS] host_status` stays healthy (about 35–38 Update calls per second).

Phase 1 gate

- [ ] The companion prints `[P2] Character editor: http://127.0.0.1:37921`; `%LOCALAPPDATA%\LSA Enhanced\control-endpoint.v1.json` exists with that URL; there is no `[UX] Control endpoint file unavailable` warning.
- [ ] The seven existing commands behave as before: `LSACharacters` prints the URL; `LSAPromote` promotes the selected NPC; follow/wait/dismiss act on a promoted NPC; summon/despawn work by CharacterId.
- [ ] Rename the endpoint file while the companion runs; `LSAPromote` still completes through the page handshake. Restore it.
- [ ] `LSACurrentNpc` with nobody selected prints `No current NPC. Mark or talk to an NPC first.`
- [ ] Mark or talk to an ordinary NPC; `LSACurrentNpc` prints `Current NPC: … not promoted, human, …` and `Input gates: text input closed, controls menu closed, scripted state none.`
- [ ] **S4:** `LSAAskCurrent "Follow me."`, then close the console. The console confirms the request, the NPC answers in character as for typed input, and the E1 run log shows a normal typed turn for that ped. The NPC follows only if the model and stock validation choose it.
- [ ] Repeat within 3 s: `Wait a moment before asking this NPC again.`
- [ ] On a promoted character, `LSACurrentNpc` reports `promoted (follow)` or `promoted (wait)`.
- [ ] Optional: during a mission or cutscene, `LSAAskCurrent` reports the scripted-state message and starts no turn.
- [ ] Optional: unload and reload the loader through RAGE. Commands appear once with no numbered aliases. As with P2 before this phase, the runtime's single owner cannot restart in the same GTA session: the log shows `essential_host_rejected_runtime_rejected` and the bridge reports the host unavailable until GTA restarts.

If the game pauses while the console is open, requests expire with `The LSA request expired. The game must be running, not paused.`; that is the intended behavior.

## Spikes

| Spike | Status |
| --- | --- |
| S4 bridge | Covered by `LSAAskCurrent` (checklist above) |
| S5 Steam overlay | Module presence is logged; opening `ActivateGameOverlayToWebPage` remains a throwaway spike |
| S1 router keys, S2 `SendInput` relay | Throwaway spikes before Phase 2; not part of this branch |
| S3 RAGENativeUI on Enhanced | Throwaway spike before Phase 3 |
| S6 companion restart | Optional developer spike |

## Next

Phase 2 (InputRouter and chord MVP) can build on this bridge directly: the router submits `current.inspect` and `npc.ask` envelopes with `source: "chord"`, and the HUD reads `Snapshot()` while `RequestSnapshots` keeps interest alive. S1 and S2 should run first.

Phases 2 and 3 are now on `feature/ux-phase2-3-router-menu`: see [UX phase 2–3 status](UX-phase2-3-status.md).
