# GM0 — F11 gameplay action inventory (2026-10-18)

Baseline: `main` at `2b9eaa12c0651e9326a94939c57723c31eb3bc05`. This is a **source audit**, not physical GTA acceptance. Later merges must revalidate this baseline. Target GM1–GM6: the Essential-based loader; GM7 is a separate standalone cutover.

## Sources and ownership

* `native/enhanced/Ui/NativeMenu.cs` and `Ui/ViewModels/MenuModels.cs`: current RAGENativeUI hierarchy and view-model action eligibility.
* `native/enhanced/Commands/LoaderDispatcher.cs`, `CommandCatalog.cs`, `contracts/commands.v2.json`: shared menu/gesture dispatch, catalog/reasons, callbacks.
* `lsa-essential-e1-candidate/src/characters/editorServer.mjs` and `characterService.mjs`: browser POST /api handlers; serialized character/native authority.
* `lsa-essential-e1-candidate/src/activities/contracts.mjs`, `act5Dialogue.mjs`, `docs/ACT6-status.md`: ACT2–ACT6 intents and strict slot/capability contracts.
* `native/promoted-characters/PlayerCommands.cs`: legacy RPH console commands; `native/promoted-characters/ActivityCommands.cs`: ACT owner-fiber adapter.
* `native/enhanced/input-tests/Program.Dispatch.cs`, `Program.Ui.cs`, `lsa-essential-e1-candidate/tests/activities-act6.test.mjs`: offline evidence only.

**Status legend:** source-implemented / GTA-unverified means a pathway and offline tests exist but the intended world effect has not been independently verified from current runtime evidence. Unsupported means no safe existing executor or contract was identified. Accepted, queued, started, completed, physical arrived and speech delivered are different evidence states.

## Action matrix

| Action | Existing executor / prerequisite | F11 on baseline | Source state / GTA evidence |
| --- | --- | --- | --- |
| Mark NPC / typed input | Essential key relay, input free | Controller/gestures; not dedicated page | Implemented / current GTA effect unverified here |
| Talk highlight / clear | UX4 talk router, fresh snapshot | Current NPC clear; selection via UX4 gestures | Implemented / unverified here |
| Promote selected ambient | companion `promote`, fresh expected encounter, human and safe | Current NPC | Implemented / unverified here |
| Summon absent saved character | companion `control:summon`, persisted ID, valid world | My Characters → Character | Implemented / unverified here |
| Follow / wait selected owned | companion `control_current`, current owned encounter | Current NPC | Implemented / unverified here |
| Follow / wait saved character | companion `control`, character ID, live/suspended | Character | Implemented / unverified here |
| Dismiss selected / character | `control_current` or `control:dismiss`, ownership | Current NPC / Character with confirmation | Implemented / unverified here |
| Despawn addon-spawned character | `control:despawn` + native ownership fence | Character with confirmation | Implemented / unverified; adopted ped must be refused |
| Release adopted ambient ped | `control:dismiss` releases control, does **not** delete ped or profile | Dismiss; no named scene-removal semantics | Implemented / unverified here |
| Delete saved character | editor `remove` with ID + revision + explicit confirmation | Not present (intentionally browser-first destructive persistent administration) | Implemented browser only |
| Rename, relationship, availability, short memory toggle/add | companion `edit` / `memory` with revision | Character | Implemented F11; full custom editing browser-first |
| ACT2 assign follow / hold / sit / resume | companion `activity:assign`, owned currently selected, mode=on | Current NPC → Assign Activity (4 choices) | Implemented / unverified here |
| Activity status / history | companion `activity:status/history`, owned currently selected | Current NPC | Implemented; reports engine state, not physical proof |
| Activity pause / resume / cancel | companion `activity:pause/resume/cancel`, owned current | Current NPC | Implemented / unverified here |
| ACT3 approach, board, exit, cover, scenario, free driving | `activity:assign` intents + native probes, actor/vehicle preflight, capability opt-in | Missing (only ACT2 choices listed) | Existing engine; F11 gap, behavior unverified |
| ACT6 walk to waypoint | `activity:assign` `go_to_place`, `place.kind=waypoint` plus explicit walk_to eligibility | Missing | Existing engine/source; physical arrival unverified |
| ACT6 drive to waypoint | `activity:assign` `vehicle_trip`, `place.kind=waypoint`, verified driver/vehicle/native readiness | Missing | Existing engine/source; failed real gameplay tests, physical arrival not proven |
| ACT6 travel to fixed landmark | native allowlisted named destinations, owner and probe checks | Missing | Existing ACT6 parser path; no F11 destination picker |
| Navigation progress / arrived | activity facts, native world-strong receipts, current `activity:status` | Generic status only | Underlying telemetry exists; never infer arrival from command acceptance |
| Manual Director social scene | browser `director_social_manual` → native director, safety/cooldowns | Missing | Implemented browser path; queued is not admitted/delivered |
| Director admission status | browser `director_social_status`, nativeResult | Missing | Implemented browser path; read only; not speech playback proof |
| Director scene editing/free scene choreography | No general safe player-facing executor established | Missing | Unsupported; do not fabricate an operation |
| Diagnostics / logs | loader recent failures and native snapshots | Diagnostics page | Implemented; missing standardized per-action admission/terminal IDs |
| AI, profiles, memory, cloud-spend configuration | loopback editor | Browser link / limited F11 controls | Intentionally browser-first; not gameplay parity scope |

## Risks and gates for GM1–GM6

1. **Selection fence:** `LoaderDispatcher.Current` and `Activity` reread *current* at click-time; menu currently confirms the same encounter only on two-tap confirmation. A non-confirmed F11 action can retarget after a UI refresh, so GM1 must capture and validate the initial encounter. Character IDs identify profiles, not live incarnations; `characterService.control` does native `inspect` then sends `ownershipToken`, but menu must not silently reselect an incarnation.
2. **Activity parity is not utterance parity:** `LoaderDispatcher.Activity` only allows four ACT2 intents; ACT3/6 have stricter capability/probe/slot/policy rules. Do not mark disabled or unverified actions as operational.
3. **Outcome wording:** loader callbacks currently treat HTTP 200 as success. For `director_social_manual`, JSON `queued` is only transport acceptance; later native `nativeResult` is admission, not speech delivery. `activity.assign` is likewise not arrival.
4. **Current-vs-character mismatch:** `characterService.activity` only addresses the captured current encounter; to operate on a roster character, either prove it is the same selected actor or add a verified character-ID/native-incarnation route. Never use a different NPC's current selection as fallback.
5. **Safety:** only native owner-fiber decisions may mutate peds; Essential F7, cutscenes, mission ownership, player switches and input gating must continue blocking unsafe operations.
6. **Release criteria:** offline .NET/Node tests, packaging and CI, then GTA physical acceptance for each enabled action, followed by regression checks on F11/controller, F7 and legacy browser/voice/console. Until GTA evidence exists, label unverified rather than complete.

## GM1–GM6 required acceptance evidence

| Scenario | Prove beyond dispatcher ACK |
| --- | --- |
| Summon/banish/adopted release | Actor appears or disappears as specified, correct stable profile and ownership, no persistent-profile deletion |
| Follow, wait, sit, vehicle entry | Native task/seat and visually observed state; exact incarnation |
| Waypoint driving/walking | Owner/vehicle preflight, task established, movement, progress, arrival from world-strong evidence |
| Director manual start | Request queued, native admitted/rejected, eventually delivered or interrupted speech receipt |
| Mid-command actor change | Stale request refused without controlling replacement actor |
| Cutscene/F7/controller interruption | Safe cancellation, no sticky busy or lost input |
| Legacy editor/voice/console | Existing routes execute and continue sharing native fences |

Review this inventory at each phase; do not merge GM4/GM5 as gameplay-verified from unit tests alone.
