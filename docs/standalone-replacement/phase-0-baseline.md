# Phase 0 — evidence-based baseline and dependency inventory

**Status:** IN PROGRESS (source audit started; runtime baseline and exhaustive call-site closure pending).  
**Frozen comparison point:** `main` `79a0aa6eb5f6b655afde65993d5d68cba269bca7`, captured 2026-10-11.  
**Scope of this branch:** documentation and inventory; **no native code, deployment tooling, settings, DLLs or runtime behavior changed**. Later `main` commits must be evaluated separately.

## 0A. Reproducible source/asset baseline

| Evidence | Frozen value or disposition |
| --- | --- |
| Original Essential Hotfix #3 `LosSantosAlive.dll` | SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` (repo build reference; matched supplied DLL); ~2.4 MB |
| Original Essential `server.bundle.mjs` | SHA-256 `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |
| E1 build tool pinned native metadata | SHA-256 `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23` |
| Current build composition | `lsa-essential-e1-candidate/tools/buildCandidate.mjs` imports and AST-patches stock server; `expectedPatchCount = 70` |
| Native loading seam | `native/promoted-characters/EntryPoint.cs` locates an existing Essential AppDomain; `DomainHost.cs` requires exactly one matching Essential assembly |
| Production managed assembly | `native/promoted-characters/PromotedCharacters.csproj` directly references upstream `LosSantosAlive.dll` |
| Legacy metadata inventory | 651 types, 5,588 methods in pinned DLL; not a count of methods we must replace |
| Action catalog | 65 native registered canonical actions, 70 catalog rows, 11 documented latent capabilities; not a required parity checklist |
| Source inventory for this snapshot | 75 production `native/**/*.cs` excluding test subtrees, 98 companion `src/**/*.mjs` modules, 76 Node `tests/*.test.mjs` files; **counts are descriptive, not proof of independence** |
| Test infrastructure | .NET stub/fiber/host/bridge/ACT/Director suites; Node tests and Windows native↔Node named-pipe interop tooling |
| Installed GTA payload / backup | **NOT CAPTURED** in this repository snapshot; hashes/configs must be gathered locally before Phase 0 closes |
| Feature branches | #32 radio, #35 contextual ballistics, #37 C-01/proximity were open draft PRs during this audit; `main` inventory does **not** include them |

**Evidence:** [current main roadmap](../ROADMAP.md); [action catalog](../research/domains/essential/essential-action-catalog.json); [DLL/native activity evidence](../research/domains/activities/activity-native-evidence.json); [Essential API inventory](../plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md); [native project](../../native/promoted-characters/PromotedCharacters.csproj); [build patch tool](../../lsa-essential-e1-candidate/tools/buildCandidate.mjs); [CI suite](../../.github/workflows/lsa-v1-offline.yml).

## 0B. Actual authority / reuse boundary

The current [system ownership matrix](../research/system-ownership-matrix.md) is correct for **the existing Essential-based production runtime**. The standalone design must replace that authority *only within a new mutually exclusive runtime*, not run a second task/session owner alongside Essential. Keep the current D-001/D-012/D-016 locks unchanged while the new implementation remains experimental.

| Concern | Today's authority | Existing candidate code to retain | Independent replacement work |
| --- | --- | --- | --- |
| GTA world / physical entity validity | Essential + GTA/RAGE | `native/intelligence/EntityAnchors.cs`, `native/session-identity/*` semantics | Game-owned actor resolver, incarnation/release fences and RAGE adapter |
| NPC state and mode updates | `NpcStateStore` / behaviors / Essential tick | ACT `StepMachine` / `StepRunner` and policy | Truthful actor state and one task lease per actor |
| Conversation partner and source PTT | `NpcTargeting`, `InputController` | UX4 `TalkTargetPolicy`, `TalkPttSession`, controls | Source-time input lifecycle and targeting owner |
| Session / turn / generation | Stock Essential server + native audio protocol v3 | `openaiConnection.mjs`, turn validation, telemetry | Owned turn allocator, cancellation and exact identity protocol |
| Actor/world context and hydration | Essential `ActorContextProvider` / coordinator | `context/*`, PS knowledge projection, P0/P1/P2 | Native snapshot/context producer and explicit transport |
| NPC speech admission / playback | `NpcPlaybackCoordinator`, stock server bridge | STT / provider / TTS chunks / `nativeDelivery.mjs` observer semantics | Game audio output, buffer/voice emitter, lip sync, terminal receipts |
| NPC commands and results | `NpcActionRegistry`, `NpcActionQueue` and concrete behaviors | `native/activities/*` capability/admission/step logic | Authoritative native dispatch + family-specific physical postconditions |
| Perception snapshots / game events | `PerceptionSystem` + GTA/RAGE/DamageTracker | `native/intelligence/SensorAdapters.cs` and PS0–PS4 logic | Native evidence producers; preserve witness-relative authorization |
| Director spontaneous turns | Stock `SpecialGeminiTurnScheduler` / original-turn arbitration | `DirectorAdmission`, PS3 grant logic, companion Director policy | Single independent speech scheduler that yields to player input |
| Persistent characters | P1/P2 layered on Essential ped ownership | Profile store, world/identity contracts, editor, summon policies | Ownership of create/adopt/release without Essential API |
| Controller/menu | Own `EnhancedHost` but relays into Essential | `native/enhanced/Input/*`, menus, gesture tests | Change Essential bindings to standalone host |
| Appearance/gaze/reflexes/vehicles | Essential behavior classes | Some existing P2/ACT intent/policy | GTA-specific task/animation priorities; do not claim offline physical parity |

**Observed hard dependencies, with source pins:** 
- `EntryPoint.StartHost` looks up Essential CLR domain; `DomainHost.CoreStatus` rejects missing/mismatched native assembly and marshals `RuntimeEntry` into it.
- `RuntimeEntry.Start` registers our integrations via `LosSantosAlive.Integrations.IntegrationManager.Register`.
- `TalkTargetSelector` calls `NpcTargeting.SetPlayerConversationPed` / `InputController.SendMicStart`; `EssentialMicState` uses a private-field-derived active mic and `SendMicStop`.
- `PromotedCharactersIntegration` calls `NpcStateStore`, `NpcActions.FollowTarget` / `WaitHere`, `NpcFocus` and safe release helpers.
- `IntelligenceIntegration` observes `NpcPlaybackCoordinator` start/end events, uses `PerceptionSystem.TryGetSnapshot` and special-turn original-turn state; `DirectorSchedulerIntake` submits to Essential's scheduler.
- `buildCandidate.mjs` patches the original Essential Node runtime rather than replacing its session/transport core; `src/integration/essentialGlue.mjs` and `nativeDelivery.mjs` depend on the stock lifecycle.
- Open #37 introduces pinned Harmony-based start/stop mic observation; it is a **draft branch feature**, not a `main` or real-game-accepted seam.

These are **identified high-value seams, not an exhaustive method/call graph**. Phase 0 cannot be marked complete until direct/static references and reflective/protocol dependencies are systematically inventoried and categorized.

## 0C. Source ownership decisions

- **Keep/reuse:** existing provider clients, STT/TTS, speech profile/identity policy, P2 data/editor, PS facts/episodes/salience/knowledge rules, ACT planner/supercession policies, Director intent rules, UX gesture/menu logic, telemetry/retry code.
- **Replace:** core plugin bootstrapping, current Essential-domain remoting, original bundle patches, turn and PCM protocol ownership, microphone source and audio output, GTA native executor, per-ped state/reflex/task arbitration, actor/world snapshot provider, special turn scheduler.
- **Omit by default:** stock Gemini transport, optional PR/LSPDFR/hostage functionality unless user explicitly selects it, unused internal activity queue/destination placeholders, unnecessary legacy action aliases, unrequested store/UI surfaces. Omission requires a recorded user-visible impact and no hidden dependency.
- **Investigate / spike:** independent spatial emitter/NAudio vs other appropriate API and lip sync, real RAGE script/task ownership coexistence, native host assembly binding, voice capture device, streaming latency under actual GTA execution, mission/vehicle/combat behavior.

## 0D. Physical baseline: preserve before first standalone GTA deployment

Gather and store as sanitized **local acceptance artifacts**, not GitHub secrets or personal/private files:

1. Known-good GTA V Enhanced, RAGE Plugin Hook, and selected support-library versions; hash the installed Essential DLL, stock-bundle-derived server, P1/P2 add-ons and user-selected JSON configuration (redacted/sanitized).
2. One normal typed turn, player mic turn, NPC TTS playback with exact `PlaybackStarted`/`PlaybackEnded` and history result; spontaneous Director speech when enabled.
3. One promoted NPC summon/follow/wait, NPC entering/exiting a vehicle, combat/reflex interruption, GTA reload/reset and disconnect/reconnect. Capture matching console/server/companion logs with correlation IDs.
4. Keep independent backup/restore of original files, game configuration, and P2 profile data. Do **not** copy user secrets or stock proprietary files into PR.
5. Record environmental constraints (game-fiber identity, audio output and mic device, available Rage/NAudio SDK references). **No same-process double controller** during standalone test.

The source code supports many expected capabilities, but a baseline is only GTA-proven for the exact payload and tests documented. [Roadmap GTA acceptance table](../ROADMAP.md) identifies currently unresolved PS4/PS6/ACT gates. Do not backfill those with offline assertions.

## 0E. Phase-1 handoff hypothesis (not implementation)

Begin by isolating contracts `IGameClock`, `IActorResolver`, `IGameWorld`, `IInputSource`, `IAudioOutput`, `IActionExecutor` and defining a testable immutable reference envelope `{hostRunId, worldEpoch, actorRef, incarnation, conversationId, turnId, generationId, source}`. These are proposed interface names/shape, **not** an existing wire schema. Retire stale envelopes on disconnect/world reset, and require exact matching owner before each side effect. Start with a one-actor, typed-turn simulation; live spatial playback is the main Phase 5 go/no-go.

**Open Phase 0 items are tracked in [phase-0-acceptance.md](phase-0-acceptance.md); [feature-parity-matrix.md](feature-parity-matrix.md) is the feature-level scoping record.**

