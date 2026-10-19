# ASTRA-002 · 01 — Current LSA capability audit for an AI Game Master

> **Status:** research audit, 2026-10-19. Read-only. **No GTA process was launched, no production code was changed, nothing was deployed.** Every "works" below is a source/document statement with its evidence tier; GTA runtime truth must come from the experiments in [05](05-falsifiable-experiment-ladder.md).

## 0. Pins, scope and method

| Item | Value |
| --- | --- |
| Latest `main` audited | `cd6bb4e80a7d6537344ac66b7fd61b58e66f26ca` (2026-10-18 17:55 −04:00, PR #284) — read through a separate worktree, **not merged** into this branch |
| Research base | `research/next-gen-gameplay-experiences-20261018` @ `09c0df2960e84ceff37ac8a1e79765959b65cc00` (merge-base with main `c390840aba02f6e20480421f5a2a9872772890fc`) |
| This branch | `research/astra-002-ai-game-master-20261019`, created from the research base. The only main commit not on the base (`cd6bb4e8`) touches `essentialDecision.mjs`, `knowledgeDelivery.mjs`, `runSequentialTurn.mjs`, one test and one workflow — **none of the files cited below**, so every line reference resolves identically on this branch and on main. |
| Branches scanned | all 317 non-backup remote refs listed; relevant ones (`feature/director-social-scenes-20261017`, `feature/act5-*`, `feature/act6-native-navigation-20261017`, `fix/act6-*`, `feature/gm0…gm6-*`, `research/genesis-runtime-opportunities-20261006`, `analysis/rph-1132-investigation-opus55`) are either merged into main or read at their tip. **No ACT7, PS7 or PS8 implementation branch exists.** |
| External pins reused | GTA native DB `alloc8or/gta5-nativedb-data@424fb51` (`natives_gen9.json`, same pin as ASTRA-001); RPH SDK 1.124.0 NuGet (sha256 `b48e24aa…`, identical to the owner's file in the RPH 1.132 report) — XML documentation only, no decompilation. |
| Owner runtime facts | GTA V Enhanced 1.0.1158.16, RPH 1.132.1428.17748; plugins loaded in 162 logged sessions: Essential 151, Smart Vehicle Entry 151, Promoted Characters 117, LSA Standalone 2, **LSPDFR 0** (`analysis/rph-1132-investigation-opus55:docs/standalone-replacement/rph-1132-investigation/REPORT.md` §A). |

**Naming collision.** The repository already uses **GM0–GM6** for the *F11 Gameplay Menu* consolidation ([`docs/gm-menu-consolidation/`](../../../docs/gm-menu-consolidation/GM0-action-inventory.md)). This dossier calls the AI Game Master **AGM** to keep the two apart.

**Evidence tiers** (used throughout ASTRA-002 and in [`offline-experiments/gea/capability_catalog.json`](offline-experiments/gea/capability_catalog.json)):

| Tier | Meaning |
| --- | --- |
| **A** | Observed in the owner's GTA V Enhanced runtime through LSA at some point (historical; not a current-main acceptance). |
| **B** | Production-path LSA source exists on main; exact-build GTA acceptance not established. |
| **C** | A native exists in the gen9 native DB or a member is documented in the RPH SDK; **no LSA source uses it**; Enhanced/RPH 1.132 behaviour unverified. |
| **D** | Exists inside Essential (obfuscated Hotfix #3) per CLR metadata/IL audit; reachable only through Essential APIs; unused by LSA. |
| **X** | Known unavailable on the owner's install, or blocked by architecture. |

## 1. Ten findings that shape the Game Master

Other documents cite these as F1–F10 (item *n* = F*n*).

1. **The Scene Director is a speech-only admission shell — by contract, not by accident.** `validProposal` accepts only `kind === 'speech'` with no `activity` or `command` ([`sceneDirectorAdmission.mjs:29-35`](../../../lsa-essential-e1-candidate/src/perception/sceneDirectorAdmission.mjs)); selection consumes only fresh PS3 entitlements for six threat events and four ambient cues ([`sceneDirector.mjs:39-46,57-122`](../../../lsa-essential-e1-candidate/src/perception/sceneDirector.mjs)); dispatch is `faceListener:false, interruptExisting:false` ([`sceneDirectorOrchestrator.mjs:116-120`](../../../lsa-essential-e1-candidate/src/perception/sceneDirectorOrchestrator.mjs)). The original design says "PS6 is passive speech/warnings only. Movement/combat initiative remains a later, separately validated capability" and "neither mode promotes or spawns characters" (`docs/research/archive/perception/perception-salience-scene-director-architecture-20261004.md:274,346`). **Its value to the AGM is its admission/ticket/playback-proof shell for narration beats, not scene authorship.**
2. **ACT is the right execution substrate for companions, and the wrong one for anything else.** It has leases, receipts with explicit evidence strength, interrupt/resume policy and truthful terminal states ([`activities/contracts.mjs:16-61`](../../../lsa-essential-e1-candidate/src/activities/contracts.mjs)). But admission accepts only `player_ux` or consented `player_dialogue` ([`activityValidator.mjs:9-18`](../../../lsa-essential-e1-candidate/src/activities/activityValidator.mjs)); targets resolve only to the player, the player's vehicle or a place ([`intentTemplates.mjs:51-54`](../../../lsa-essential-e1-candidate/src/activities/intentTemplates.mjs)); at most four live activities and four characters ([`activityEngine.mjs:91`](../../../lsa-essential-e1-candidate/src/activities/activityEngine.mjs), `contracts.mjs:58`); and the registry *excludes* `attack`, `aim_at`, `flee_from`, `fire_once`, weapons, hands-up, accomplice, policing and hostage verbs, with `chase_person` in phase `never` ([`contracts/activity-capabilities.v1.json`](../../../contracts/activity-capabilities.v1.json) `excluded`, row `chase_person`).
3. **LSA has exactly one spawn path, and it is not a stage.** P2 can spawn a *promoted* character at a fixed (2.5 m, 2.5 m) offset from the player (~3.5 m), only when the player is on foot, outdoors, on the ground and not in a scripted state ([`PromotedCharactersIntegration.cs:418-440`](../../../native/promoted-characters/PromotedCharactersIntegration.cs)); it refuses to delete adopted peds (`:452`). No LSA code spawns vehicles, props, pickups, blips, relationship groups or non-promoted actors, and no LSA code tasks a non-promoted ped (inventory in §2.5).
4. **ACT6 is the operational precedent for a narrow reading of D-001.** It issues raw `TASK_FOLLOW_NAV_MESH_TO_COORD` / `TASK_VEHICLE_DRIVE_TO_COORD_LONGRANGE` / `TASK_SHUFFLE_TO_NEXT_VEHICLE_SEAT` / `TASK_STAND_STILL` on ACT-leased promoted actors after making Essential yield through `NpcState` flags ([`ActivityDispatch.cs:340-393,444-455`](../../../native/promoted-characters/ActivityDispatch.cs)). It is unverified in GTA and the F11 acceptance notes report that "current real gameplay has reported failed navigation" ([`GM6-acceptance-gates.md`](../../../docs/gm-menu-consolidation/GM6-acceptance-gates.md)).
5. **Perception already samples most world facts an adjudicator needs — for NPC knowledge, not adjudication.** Native PS discovers anchored entities within 100 m from Essential's `PerceptionSnapshot`, at most 32 per tick under a ~1 ms budget, with ≤256 anchors and ≤16 observers ([`IntelligenceIntegration.cs:542-569`](../../../native/intelligence/IntelligenceIntegration.cs), [`EntityAnchors.cs:27`](../../../native/intelligence/EntityAnchors.cs)); it samples shooting at 50 ms, state at 200 ms, damage callbacks, collisions, deaths, later body discovery, wanted level and Wasted/Busted (M9, gated build) (`IntelligenceIntegration.cs:580-596`, [`IntelligenceIntegration.M9.cs:99-101`](../../../native/intelligence/IntelligenceIntegration.M9.cs)). Every one of these is shaped as *observer-qualified evidence* (D-004); none is a world-level "did the objective happen?" service.
6. **Memory K can remember an adventure only as what a promoted character witnessed or heard.** Records are per promoted character, verbatim, timeline-scoped ([`timelineGuard.mjs`](../../../lsa-shared-brain/src/characters/timelineGuard.mjs), approved decisions D-018–D-023); ambient NPCs are never memory owners; "no invented observations" ([`approved-decisions.md`](../../../docs/plans/promoted-npc-memory/approved-decisions.md)). **There is no world/experience ledger.** D-003 makes P2 the single durable *character* store; ASTRA-001 already asked the owner for a separate non-character World State Store.
7. **Essential (upstream, proprietary) already contains three Game-Master-like mechanisms.** (a) A **generated-callout orchestrator** in the stock server: an LLM (`gemini-3.1-flash-lite`) writes a compact JSON scene grounded in a real location's activity points, with a closed action enum, unnoticed/noticed behaviour branches and per-participant secrets; the server validates it, regenerates once with a "MANDATORY CORRECTION" prompt, applies deterministic repairs, then expands it (`lsa-essential-e1-candidate/upstream/server.bundle.mjs` functions `oJ`, `iJ`, `HJ`, `dN`; rule text "Never invent rooms, doors, counters, aisles, objects, parking spaces, or coordinates"). (b) A **hostage-scene phase machine** with police, negotiator, SWAT and casualty tracking. (c) A **LocationRegistry** of places with activity points such as `RobCashRegister`, `RobSafe`, `UseAtm`, with access tags and "illegal if unauthorized" flags ([`LosSantosAlive_Hotfix3_Extension_API_Analysis.md:1183-1310,1386-1476`](../../../docs/plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md)). The callout consumer is `LspdfrDynamicDisturbanceCallout` in PRBridge and needs LSPDFR — **loaded in 0 of 162 owner sessions**, so it is unavailable today (tier X); the hostage controller's dependencies are unknown (D).
8. **The GTA mission flag is a trap.** P2's `Scripted()` treats `GET_MISSION_FLAG` as scripted state and refuses spawn/follow/wait ([`PromotedCharactersIntegration.cs:198,421`](../../../native/promoted-characters/PromotedCharactersIntegration.cs)); so do native commands, the talk selector, reactions and the intelligence host (`NativeCommands.cs:126`, `TalkTargetSelector.cs:473`, `ReactionExecutor.cs:483`, `IntelligenceIntegration.cs:807`). `SET_MISSION_FLAG(true)` also blocks saving ("If true, the player can't save the game", native DB). **An AGM that set the flag to protect an experience from mid-mission saves would silence and freeze Nathan.**
9. **Runtime reliability, not imagination, is the binding constraint today.** The 2026-10-18 real-session triage records owner stalls (5 × 1.5–1.8 s), 4 of 5 Director candidates rejected (unsafe / missing receipt), P2 `native_operation_failed`/`owner_unavailable` and no demonstrated ACT vehicle/waypoint operation ([`OBS2-SESSION-TRIAGE-20261018-192709.md`](../../../docs/observability/OBS2-SESSION-TRIAGE-20261018-192709.md)).
10. **The architecture anticipated this and deferred it on purpose.** The master plan rejects a second planner ("Reuse ACT5/PS6/ACT7 path; no second planner") and defers "AI callouts, patrol/free-driving, investigations" because "a generated incident is not witnessed evidence; spawning/callout ownership and institutional authority need separate explicit contracts" ([`UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md:567,572`](../../../docs/research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md)). **The AGM is precisely that missing contract set.** It must not become a second planner for companions; it is a different authority (scene staging + world-level adjudication).

### 1.1 Findings mapped to the five visions

| Finding | #20 Game Master | #23 Missions | #3 Adventures | #6 Action scenes | #72 Immersive | Effect |
| --- | :-: | :-: | :-: | :-: | :-: | --- |
| F1 Director is speech-only | ● | ● | ● | ● | ● | Narration and offers only; no scene authorship |
| F2 ACT serves companions only | | ● | ● | ● | | Nathan can join; scene actors need another executor |
| F3 One spawn path, not a stage | ● | ● | ● | ● | ● | Blocks every experience with its own actors, vehicles or props |
| F4 ACT6 narrow-D-001 precedent (unverified) | | ● | ● | ● | | Model for a Stage Executor's coexistence with Essential |
| F5 Perception samples most needed facts | ● | ● | ● | ● | ● | Monitors can reuse samplers; adjudication needs its own read model |
| F6 Memory only for witnessed/told facts | ● | ● | ● | | ● | Consequences need a world/experience ledger |
| F7 Essential has callouts, hostage scenes, locations | | ● | | ● | ● | Design prior art and optional tier-D compositions; callouts unavailable without LSPDFR |
| F8 Mission flag silences Nathan, blocks saving | ● | ● | ● | ● | ● | The AGM must never set it and must yield to Rockstar missions |
| F9 Runtime reliability issues | ● | ● | ● | ● | ● | Every GTA experiment depends on stable owner/Director/P2 paths |
| F10 Callouts/spawning deferred pending contracts | ● | ● | ● | ● | ● | The AGM contract set (doc 04) is the missing piece |

## 2. System-by-system audit

### 2.1 Scene Director / PS6

| Element | Source | State | AGM relevance |
| --- | --- | --- | --- |
| Deterministic selection `selectDirectorIntent` | `perception/sceneDirector.mjs:57-122` | B (main); spontaneous gunfire/crash lines user-observed historically (A) | Reusable *policy boundary* (master plan §11.5 `selectIntent(...)`), but it selects among PS3-granted observations only. |
| Limits: 1 in flight, 4 attempts/min, 20 s/5 s speaker cooldowns, 8 s scene gap, 2 s urgent / 10 s routine TTL, 32 tickets × 2 s | `sceneDirector.mjs:4-16` | B | AGM beats must share these budgets or receive their own explicitly reviewed budget. |
| Event allowlists: threats `firing_burst, vehicle_impact, injury, death_seen, body_found, threat`; ambient `character_present, location_changed, activity_changed, vehicle_transition` | `sceneDirector.mjs:39-46` | B | An AGM beat is a *new source* (`agm_beat`), not a PS3 event; needs its own admission rule. |
| C-11 reservation shell: reserve → native reserve → consume → submit → hydration/publication gates → bind tuple → finish only on `playback_ended{completed, hadAudio, !interrupted}` | `sceneDirectorAdmission.mjs:43-207`, `sceneDirectorOrchestrator.mjs:57-140` | B; OBS2 shows 1 delivered of 5 candidates | **Directly reusable** for narration ("Nathan: 'that's our courier'"), with the same playback proof. |
| Social scenes: `shared_vehicle_entry`, `reunion`, `shared_idle`, `travel`, `activity_transition`, `manual` | [`DirectorSocialScenes.cs:120-160`](../../../native/intelligence/DirectorSocialScenes.cs), [`DIRECTOR-SOCIAL-SCENES.md`](../../../docs/DIRECTOR-SOCIAL-SCENES.md) | B | Proven pattern for *native-detected opportunity windows* (idle, travel) — exactly where an AGM should **offer** an experience. |
| Player interruption / priority | `essentialTurnPriority.mjs`, `PlayerPriorityEpoch.cs`, C-06 policy `DirectorC06Policy.cs` | B | Must veto AGM offers and AGM speech the same way. |
| Evidence gating | `originalGrantCurrent` re-checked at every boundary (`sceneDirectorOrchestrator.mjs:33-51`) | B | Template for AGM "experience still current?" checks at every async boundary. |

**What it cannot do and should not be stretched to do:** choose physical actions, spawn, task actors, track objectives, persist experiences. Turning it into a Game Master would violate its own invariants (speech-only proposals, no world scan, no provider call in selection).

### 2.2 ACT0–ACT7

| Phase | Implemented / integrated | Evidence | Notes for AGM |
| --- | --- | --- | --- |
| ACT0/1 contracts, shadow observer | yes / yes (PR #18) | A (Oct 6 smoke) | Vocabulary of receipts and evidence strengths (`RECEIPT_STATES`, `EVIDENCE_KINDS`, `PREDICATES`) is the right language for objective evidence. |
| ACT2 hold/follow/sit/resume | yes / yes | A (smoke) + player use | Companion participation in adventures (follow, wait). |
| ACT3 ten short-range capabilities (stop_and_face, approach_person, walk_away_from, exit_vehicle, enter_vehicle_seat, begin_driving, scenario_here, take_cover, grab_item, clear_held_item) | yes / yes (PR #237), **default off**, per-capability opt-in | B | Companion can board the getaway car, take cover, wait in a scenario. Targets only player/player vehicle. |
| ACT4 activity-aware dialogue | yes / yes | B | Nathan can truthfully say what he is doing — needed so he doesn't narrate fake progress. |
| ACT5 consented Luna proposals over ACT2/ACT3 plans | yes / yes (#238), default off | B | **The consent pattern the AGM should copy**: Nathan *pitches*, an exact player turn accepts, the engine executes; 90 s expiry, 5 min repeat suppression. |
| ACT6 walk_to / drive_to / move_to_and_hold, 5 landmarks + waypoint + near-player | yes / yes (#239, #246, #254), default off | B; GM6 notes report failed real navigation | Travel legs of adventures; **unproven**. Landmarks: LSIA, Del Perro Pier, Vespucci Beach, Sandy Shores Airfield, Paleto Bay (`ActivityDispatch.cs:44-52`). |
| ACT7 directed interaction + commitments | **no** — registry row `directed_interaction` phase ACT7 with empty sources | — | NPC↔NPC scene beats need ACT7 or an AGM-owned equivalent for scene actors. |

Replanning/recovery today: `RECOVERY_ACTIONS` includes `retry_once, alternative, replan, defer, ask_player, abandon` and interrupt policies (`intentTemplates.mjs:25-34`), but plans are closed templates and **no model-authored step lists are allowed** (ACT5 status). That is the correct posture; the AGM must compile its own scene plans rather than push free-form steps into ACT.

### 2.3 PS0–PS8 world perception

| Layer | State | What the AGM can use | Boundary |
| --- | --- | --- | --- |
| PS0/1 anchors, producers, transport | B (shadow A, Oct 5) | `captureRef` handles with lifetime validation; host run / world epoch fences | Anchors are run-local; never persisted (identifier taxonomy rows 7, 14). |
| PS2 observations/episodes (≤4 claims, witness receipts) | B | 14 event types incl. `firing_burst, injury, death_seen, body_found, vehicle_impact, vehicle_transition, location_changed` (`perception/contracts.mjs:10`) | Observer-qualified; an AGM adjudicator needs world-level reads, not witness claims. |
| PS3 salience | B | Urgency signals for pacing (an intensity model) | Grant ≠ consumption (C-03). |
| PS4 TurnKnowledgeFrame | B; one prior real playback (A) | **The only door** for experience context into Luna (C-04 lane items) | AGM may not write prompts directly (D-008). |
| M9 incidents `vehicle_crash, rollover, airborne_stunt, water, wanted_level_changed, wasted, busted` (`contracts.mjs:14`) | B, native producer gated from default build | Failure/consequence predicates for missions (Wasted, Busted, wanted ≥ n) | Must be compiled in and accepted. |
| PS7 social routing | design only | — | Multi-NPC conversation in scenes waits for C-12. |
| PS8 broader sensing (explosions, sirens, theft…) | vocabulary/plan only | — | One sensor at a time. |

### 2.4 Memory K / P2

* **Reusable:** SQLite store with `timelines`, TimelineGuard that suspends writes on clock regression or timeline change and refuses to guess save lineage (`timelineGuard.mjs:4-28`); scene-local `SubjectRef` kinds (`stranger`, `vehicle`, `unresolved_player` scoped by `sceneId`) (`:29-37`) — the right shape for AGM-spawned strangers who never become durable identities.
* **Not reusable as-is:** personal memory tables (`memory_records`, journals) belong to promoted characters and accept only witnessed/accepted evidence. An adventure's *world consequences* ("the docks crew now hates us", "the ledger is in the safehouse") have no home.
* **Consequence path that already works by design:** if Nathan witnesses the heist (PS2 observations) and the player talks about it (accepted D-022 input), Memory K journals it. The AGM may *offer* a memory ("remember this?" → M5 explicit command) but must never write it.

### 2.5 Native and GTA interfaces

**What LSA native code calls today** (full scan of `native/**/*.cs`, tests excluded): cutscene/switch/mission-flag/session checks, vehicle seat and occupancy reads, interior reads, LOS (`HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT`), `IS_PED_SHOOTING`, wanted level and arrest reads (M9), waypoint blip reads, ground Z, appearance variation natives, `PLAY_FACIAL_ANIM`, anim dict requests, and the four ACT6 TASK natives. **One** `new Ped(...)` (P2 spawn). **No** `new Vehicle`, `new Rage.Object`, `Blip`, `RelationshipGroup`, `TaskSequence`, pickups or combat tasks.

**What the platform documents** (desk census; tier C until E0):

| Need | Native DB gen9 (signatures verified present) | RPH 1.124 managed API (XML docs) |
| --- | --- | --- |
| Spawn / persist / release | `CREATE_PED`, `CREATE_VEHICLE`, `CREATE_OBJECT`, `CREATE_PED_INSIDE_VEHICLE`, `SET_ENTITY_AS_MISSION_ENTITY` ("makes … persistent"), `SET_*_AS_NO_LONGER_NEEDED`, `DELETE_*` | `new Ped/Vehicle/Object`, `Entity.IsPersistent`, `Dismiss`, `Delete`, `CleanupManager` |
| Hostility & combat | `ADD_RELATIONSHIP_GROUP`, `SET_RELATIONSHIP_BETWEEN_GROUPS` (0 companion … 5 hate), `TASK_COMBAT_PED`, `TASK_COMBAT_HATED_TARGETS_AROUND_PED`, `SET_PED_COMBAT_ATTRIBUTES`, `GIVE_WEAPON_TO_PED`, `TASK_SEEK_COVER_FROM_PED` | `RelationshipGroup.SetRelationshipWith`, `Ped.RelationshipGroup`, `Ped.IsInCombat`, `BlockPermanentEvents`, `KeepTasks` |
| Pursuit / flight / escort | `TASK_VEHICLE_CHASE`, `TASK_VEHICLE_MISSION_PED_TARGET`, `TASK_VEHICLE_ESCORT`, `TASK_VEHICLE_FOLLOW`, `TASK_SMART_FLEE_PED`, `TASK_REACT_AND_FLEE_PED` | `Ped.IsFleeing`, `TaskInvoker.DriveToPosition/CruiseWithVehicle` |
| Multi-step behaviour | `OPEN_SEQUENCE_TASK`, `TASK_PERFORM_SEQUENCE`, `GET_SEQUENCE_PROGRESS` | `TaskSequence` |
| Objective predicates | `IS_ENTITY_IN_AREA`, `IS_ENTITY_IN_ANGLED_AREA`, `IS_ENTITY_AT_COORD/ENTITY`, `HAS_PICKUP_BEEN_COLLECTED`, `HAS_ENTITY_BEEN_DAMAGED_BY_ENTITY`, `GET_PED_SOURCE_OF_DEATH`, `IS_VEHICLE_DRIVEABLE`, `DOOR_SYSTEM_GET_DOOR_STATE` | `World.PedShot`/`PedRunOver` events, `Entity.HasBeenDamagedBy` |
| Spawn-out-of-view | `IS_ENTITY_ON_SCREEN`, `IS_SPHERE_VISIBLE`, `GET_SAFE_COORD_FOR_PED`, `GET_NTH_CLOSEST_VEHICLE_NODE_WITH_HEADING` | `World.GetNextPositionOnStreet` (used by ACT6) |
| Guidance & atmosphere | `ADD_BLIP_FOR_COORD/ENTITY/RADIUS`, `SET_BLIP_ROUTE`, `CREATE_CHECKPOINT`, `SET_WEATHER_TYPE_*`, `SET_CLOCK_TIME`, `SET_TIMECYCLE_MODIFIER`, `START_AUDIO_SCENE`, `TRIGGER_MUSIC_EVENT`, `BEGIN_TEXT_COMMAND_DISPLAY_HELP` | `Blip.EnableRoute`, `World.TransitionToWeather`, `World.TimeOfDay` |
| Population & police | `ADD_SCENARIO_BLOCKING_AREA`, `SET_PED_DENSITY_MULTIPLIER_THIS_FRAME`, `CLEAR_AREA_OF_PEDS`, `SET_PLAYER_WANTED_LEVEL`, `SET_MAX_WANTED_LEVEL`, `SET_DISPATCH_COPS_FOR_PLAYER` | `World.AddSpeedZone`, `World.CleanWorld` |
| Pool budgets | — | **`World.PedCapacity`, `VehicleCapacity`, `ObjectCapacity`** (lets E0 read real Enhanced pools) |

A native's presence in the DB says nothing about stability under Enhanced, task persistence under Essential, or cleanup; ASTRA-001 already found that only 6 RPH members are proven by execution on the owner's runtime.

### 2.6 Essential internals relevant to an AGM (tier D unless stated)

| Mechanism | Evidence | Use / risk |
| --- | --- | --- |
| 70 canonical actions; 32 `HANDLER_ONLY`, 26 `COMPUTED_HANDLER` completion | [`essential-action-catalog.json`](../../../docs/research/domains/essential/essential-action-catalog.json) | Combat/compliance verbs (attack with weapon, intimidate, flee, hands up, kneel) exist and are *model-visible to stock Luna*, but "handler acceptance is not physical completion" (D-017). |
| Reflex system (17 event types → hands up / flee / walk away / chase / attack / intimidate) | Extension analysis §5 | **Will act on AGM-spawned peds near the player** unless suppressed; `DirectedInteractionManager.ShouldSuppressAuthoredSetupReflex` shows Essential has an "authored setup" notion. |
| `NpcState` flags (`StayUnderLsaControl`, `BlockPhysicalReflexActions`, `BlockAction`, `RuntimeMode`) | §4 | Coordination levers, already used by ACT6 for promoted actors. |
| Roles (Civilian, Accomplice, PoliceShowUnit, Negotiator, SwatShowUnit, StoreClerk, TaxiDriver, Paramedic, GangMember) | §13 | Casting vocabulary for scene actors that Essential will talk with. |
| LocationRegistry + ActivityPoints (`RobCashRegister`, `RobSafe`, `OpenSafe`, `UseAtm`, `UseCashRegister`, `PayForItems`, `TalkToOccupant`), access tags, "illegal if unauthorized" | §12 | **Grounded affordance atlas** for robberies/heists already curated upstream; readable through public static registries. |
| Hostage scene controller (phases InitialResponse → … → Resolved; police/negotiator/SWAT/helicopter/snipers) | §14 | A complete authored mechanic the AGM could *compose* ("the store robbery turns into a standoff") — if it runs without LSPDFR. Unknown. |
| Generated callouts (`generateCallout` → `calloutGenerated`; PRBridge `LspdfrDynamicDisturbanceCallout`) | server bundle + Appendix C | Closest prior art for "LLM → grounded scene spec → validator → runtime". **X on this install (needs LSPDFR).** Proprietary code: study the *design*, never copy it. |

### 2.7 Architectural constraints the AGM must preserve (or explicitly propose to change)

| Constraint | AGM consequence |
| --- | --- |
| **D-001** Essential sole native executor (LOCKED) | Scene staging needs either (a) the narrow reading already practised by ACT6 (LSA tasks entities it owns, Essential made to yield) extended to *scene-owned* entities, or (b) hosting in the standalone native core. **Owner decision.** |
| **D-004** facts ≠ knowledge ≠ action authority (LOCKED) | The AGM is omniscient for adjudication; NPCs learn only through witness/report. AGM truth never enters a prompt except as a typed PS4 lane item about what the character was *told*. |
| **D-008/C-04** single knowledge writer | AGM contributes `SITUATION.experience` lane items; no prompt blocks. |
| **D-013/C-11** Director proposes, ACT executes | AGM → companion actions only as ACT proposals with `source:'game_master'` and player consent; AGM → speech only through C-11 tickets. |
| **D-017** no broad task clears; acceptance ≠ completion | Objective completion only from world evidence (§5 of [04](04-gameplay-generation-execution-contract.md)). |
| **C-06** one truthful owner token | Extend `owner` with `agm_stage` for scene actors; never task an actor owned by P2/ACT/Essential residual. |
| **C-07/C-15** TimelineGuard, SubjectRef | Experience ledger rows are timeline-scoped; strangers are scene-local SubjectRefs. |
| **C-13** host run / world epoch | Every AGM lease, objective and evidence sample carries both; epoch change ends RAM state. |
| Master plan §12 "no second planner" | The AGM must not plan companion behaviour; it plans *scenes* and asks ACT. |

## 3. Capability matrix — what the AGM can reuse, build, or must research

Legend: **R** reuse (tier shown) · **E** ordinary engineering · **★** breakthrough research. Columns map to the five visions (#20 Game Master, #23 missions, #3 adventures, #6 action scenes, #72 immersive experiences).

| AGM capability | Today | Classification | #20 | #23 | #3 | #6 | #72 |
| --- | --- | --- | :-: | :-: | :-: | :-: | :-: |
| Opportunity windows (idle, travel, reunion) | Social-scene detectors (B) | R + E (new consumer) | ● | | ● | ● | |
| Player intent capture ("let's do something crazy") | Accepted STT input (D-022, A); ACT5 consent pattern (B) | R + E | ● | ● | ● | | ● |
| Situation model (player/companion state, nearby entities, intensity) | PS anchors/samplers (B), M9 (B) | E (world-level read model) | ● | ● | ● | ● | ● |
| Location affordance atlas | ACT6 5 landmarks (B); Essential LocationRegistry (D) | E (LSA-owned data file) + R (D bridge, optional) | ● | ● | ● | ● | ● |
| Scene staging (spawn/persist/cleanup peds, vehicles, props, pickups) | none (C) | **E + authority decision** | ● | ● | ● | ● | ● |
| Scene-actor behaviour (guard, chase, flee, fight, drive) | none (C); Essential actions (D) | **E + coexistence research (★ if Essential fights it)** | ● | ● | | ● | ● |
| Companion participation | ACT2/3/6 (A/B) with consent | R | ● | ● | ● | ● | ● |
| Objective algebra over observable fluents | sensors scattered (A/B/C) | ★ (representation + verification contract) | ● | ● | ● | ● | ● |
| Feasibility validation before staging | none | ★ (abstract model + critics; X-2/X-3 offline) | ● | ● | ● | ● | ● |
| Runtime objective monitors with evidence ladder | ACT receipt semantics (B) | E (design proven offline, X-5) | ● | ● | ● | ● | ● |
| Adaptation / accommodation | ACT recovery enums only | ★ (bounded accommodation, X-4) | ● | ● | ● | ● | ● |
| Narration beats | C-11 speech tickets (A/B) | R (new source) | ● | ● | ● | ● | ● |
| Knowledge projection to NPCs | PS4 lanes (B) | R + E (lane item) | ● | ● | ● | | ● |
| Mystery/clue logic | none | ★ (solver, X-6) | | | ● | | ● |
| Pacing / intensity | PS3 urgency (B), L4D-style model absent | E + ★ (fun evaluation) | ● | | ● | ● | ● |
| Persistent consequences | Memory K (B) for witnessed; no world ledger | E (ledger) + owner decision | ● | ● | ● | | ● |
| Save/reload continuation | TimelineGuard (B), no save hook (PROVEN) | ★ (re-staging from verified checkpoints) | ● | ● | ● | | ● |
| Multi-experience / multi-actor arbitration | C-06 owner token (B), ACT ≤4 | E + ★ (Essential coexistence) | ● | | | ● | |
| Novelty measurement | none | ★ (X-3 metric; human evaluation) | ● | ● | ● | ● | ● |

## 4. How much gameplay is composable today? (offline X-1)

Using the catalog above and the algebra generator ([`x1_capability_census.py`](offline-experiments/x1_capability_census.py), results [`x1_capability_census.json`](offline-experiments/results/x1_capability_census.json)), 300 generated experience specifications were compiled under each evidence policy:

| Compile policy | Allowed tiers | Valid of 300 | Mechanically distinct (unique signatures) |
| --- | --- | --- | --- |
| `accepted` | A only | **0** | 0 |
| `play` | ≤ B (LSA source exists) | **7** | **2** |
| `lab` | ≤ C (+ a stage executor calling documented natives) | **208** | **171** |
| `bridge` | ≤ D (+ Essential internals) | 208 | 171 |

A separate generator restricted to places and the companion (no scene actors) produced 91/100 valid specs in `play` mode but only **14 distinct mechanics** — variations of "get somewhere / stay somewhere with Nathan before a timer". The most frequent blockers in `play` mode were: spawning a scene ped (595 occurrences), arming it (486), spawning a vehicle (341), the `holding` and `interacted` fluents (165, 154), `gm_guard_area` (154), spawning props (154), `gm_vehicle_chase` (149), `vehicle_driveable` (146), spawning items (112), `gm_drive_to` (100), `gm_combat` (95).

**The census splits sharply between seeing and doing.** 21 of the 31 catalogued fluents are already tier A/B — LSA's perception, M9 incidents, vehicle-seat reads and Wasted/Busted sensing can observe most of what an objective needs — but only 8 of 28 actor policies (all companion activities) and 1 of 17 staging capabilities (P2's promoted spawn) are A/B. **LSA can largely see what a Game Master must verify; it cannot yet make scene events happen.**

**Interpretation (bounded):** with today's verified or merged surface, essentially no mechanically interesting experience can be compiled; everything beyond companion outings needs a *scene stage executor* (≈5 staging operations, ≈7 actor policies and ≈4 fluents). This is a ranking of what E0 must test first, **not** evidence that those natives behave in Enhanced. (Numbers are from run 2 of the offline experiments; run 1, before two world-model bugs were fixed, gave 211/174 in `lab` — see [offline-experiments/README.md](offline-experiments/README.md#revision-log).)

## 5. The five visions against today's LSA

| Vision | Already possible (with existing opt-ins) | Missing for a first fun slice |
| --- | --- | --- |
| **#20 AI Game Master** | Opportunity windows (social scenes), speech beats, PS3 urgency | Stage executor, objective monitors, experience ledger, offer/consent policy, pacing model |
| **#23 Improvised missions** | Companion boards/drives (ACT3/ACT6, unproven), Wasted/Busted/wanted sensing (M9, gated) | Scene actors (courier, guards, chasers), items/props, objective algebra, validation, accommodation |
| **#3 Adventures** | Landmark travel with Nathan (ACT6, unproven), natural speech, memory of witnessed events | Clue props/informants, reveal mechanics, travel reliability, graceful conclusion |
| **#6 Action scenes** | Nathan takes cover (ACT3), gunfire perception | Hostile scene actors with combat/pursuit tasks, relationship groups, Essential reflex coexistence, latency-free adaptation |
| **#72 Immersive experiences** | Weather/time natives exist (C), speech | Atmosphere staging, clue logic solver, interaction sensor, horror pacing, opt-in boundaries |

## 6. Unverified assumptions carried into ASTRA-002

| ID | Assumption | Why it matters | Resolved by |
| --- | --- | --- | --- |
| U-01 | Scene peds spawned by an LSA plugin keep RPH/GTA tasks under Essential (no reflex/conversation hijack) | Whole stage executor | E0.2 |
| U-02 | `SET_ENTITY_AS_MISSION_ENTITY`/`IsPersistent` keeps scene entities alive through streaming at 100–400 m | Long objectives | E0.3 |
| U-03 | Relationship groups + `TASK_COMBAT_PED` produce controllable hostility in Enhanced | #6 action scenes | E0.4 |
| U-04 | `HAS_PICKUP_BEEN_COLLECTED`, area tests and vehicle driveability are reliable at 4 Hz | Objective verification | E0.5 |
| U-05 | `World.PedCapacity/VehicleCapacity/ObjectCapacity` and real headroom allow ≥ 12 scene peds + 6 vehicles near the player | Budgets | E0.8 |
| U-06 | Essential's `PerceptionSnapshot` and reflex system tolerate extra scene peds without behavioural side effects | Coexistence | E0.2/E0.6 |
| U-07 | ACT6 navigation works for travel legs | #3/#23 | ACT6 GTA acceptance (existing gate) |
| U-08 | The hostage controller and LocationRegistry can be driven without LSPDFR | Optional D-tier composition | E0.9 |
| U-09 | Despawn/cleanup leaves no orphaned persistent entities after crash/reload | Safety | E0.7, E7 |
| U-10 | A provider model can emit IR specs at a useful validity rate within latency budgets | Architecture F's designer role | E1, E2 (validity, latency); E6 (novelty) |
