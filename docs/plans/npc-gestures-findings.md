# NPC conversational gestures — findings and status

Branch `feature/npc-gestures-impl-20261016`, based on `integration/memory-k-production-20261012` (#138). Implements the plan in PR #199 (left untouched). Default **off**. Nothing here has run in GTA V Enhanced.

## What was built

A small closed gesture system for the NPC that is currently speaking an Essential line:

- `facepalm` when the NPC's validated reply is genuinely exasperated.
- `middle_finger` when the NPC's validated reply is a clear dismissal or insult.
- Otherwise nothing. Ambiguity, quotes, negation, jokes ("haha", "just kidding"), questions, commands and non-player sources all resolve to *no gesture*.

Pieces:

| Where | What |
|---|---|
| `lsa-essential-e1-candidate/src/reactions/reactionSelector.mjs` | Pure, deterministic phrase scoring over the NPC's **validated reply only** (never the player's input). No LLM, no network, no schema change. |
| `.../reactionService.mjs`, `reactionClient.mjs`, `reactionConfig.mjs`, `reactionCatalog.mjs` | Per-turn gate: sends at most one frame per turn, only after the exact `playback_started` for that turn is seen and the turn is still current. Optional pipe client with reconnect. |
| `.../openai/runSequentialTurn.mjs` | Four small try/catch hooks (open, native event, validated decision, release). Turn outcome is unchanged whether the hook is absent, on, or throwing (tested). |
| `native/reactions/ReactionCatalog.cs` | The only place dictionaries, clips, flags and durations are chosen. |
| `native/reactions/ReactionPolicy.cs`, `ReactionFrame.cs` | Pure admission, cooldowns, timing, run lifecycle, preflight table, frame codec. |
| `native/reactions/ReactionExecutor.cs` | Game-thread executor: preflight → resolve clip → one finite upper-body clip → verify → clean up. |
| `native/reactions/ReactionChannel.cs`, `ReactionIntegration.cs` | Dedicated current-user pipe `LSA.Reactions.v1` and the Essential `IIntegration` tick. |

### Configuration (all default off)

Companion `e1.config.json`:

```json
"reactions": { "mode": "off", "pipeName": "LSA.Reactions.v1" }
```

Native `LSA.PromotedCharacters.json`:

```json
"reactions": { "mode": "off", "pipeName": "LSA.Reactions.v1", "disabled": [], "allowDuringOwnedBehavior": false }
```

- `off` — nothing is created: no pipe, no subscription, no thread.
- `shadow` — selection, admission, cooldowns, preflight and clip *existence* checks run and are reported as `would_play`; **no** request, task or stop native is called.
- `on` — native config only; the only mode that animates. The companion side cannot turn animation on by itself.
- `disabled` — reaction names to switch off individually.
- `allowDuringOwnedBehavior` — literal `true` lets a gesture play while P2/ACT follow/wait/sit/activity owns the ped. Default blocks it.

### Timing and cooldowns

- Starts 500–1199 ms into the line (FNV-1a of turn + generation, so replays are identical), never later than 4 s into it.
- Facepalm ≤ 1.8 s, middle finger ≤ 1.5 s, always finite.
- Global 12 s, same ped 20 s, same reaction on the same ped 60 s. One gesture at a time.

## Safety properties (and where each is tested)

- **No new action engine, no new ACT/Intelligence/P2 frames.** Those channels are lease/sequence/SHA-pinned; a malformed frame there can close a lease. Reactions use their own optional, one-way, current-user pipe, so the worst failure is a missed gesture.
- **Identity.** The companion waits for the exact `playback_started` of the turn. Native independently records Essential's `PlaybackStarted` for `(pedId, turnId, generationId)`, requires the frame's host run + world epoch to match, re-checks handle and `MemoryAddress`, and requires the ped to be the current conversation speaker. A frame for a line native never saw is refused after a short grace window. A late end of one turn cannot end another; a new line for the same ped supersedes the old run. (`book`, `admission`, `executor` tests; `reactions-turn-hook` tests.)
- **Never touches other systems.** The executor source is scanned in tests: only allow-listed natives appear (clip dictionary/playback/stop/remove plus read-only state checks). No `ClearAll`/`CLEAR_PED_*`, no heading, position, weapon, gaze, lip-sync or audio calls, and no teleporting.
- **Does not interrupt Essential-controlled behavior.** Preflight refuses vehicles, combat, fleeing, armed, scenarios, swimming, ragdoll/getting up/falling, melee, stunned, cutscene/mission, directed interactions, active reflexes, hands-up, kneel/sit, hostile modes, held items, running activities, and P2/ACT follow/wait/sit ownership. Unknown **promoted** ownership counts as owned. Ordinary unpromoted peds can pass only after the separate native active-speaker and safety preflight; this is repeated every tick while an animation plays.
- **Cleanup.** Interruption, death, handle reuse, despawn, world reset, callback overflow, shutdown and repeated faults all end the run. The stop is clip-scoped (`STOP_ANIM_TASK` for our own dictionary/clip, only if it is still playing) and only dictionaries *we* requested are removed. Three native faults disable the executor for the session.
- **Faces.** No facial clips are used (see below), so there is no conflict with Essential lip-sync, PR #198 mouth work, or conversation gaze. The gesture is upper-body only and issues no look/turn tasks.

## NPCTalk animations: what can be reused

NPCTalk (MIT) plays `middle_finger` and `facepalm` as full-body clips (`flag 0`), turns the ped toward the player with `Face()`, and ends with `Restore()` → `ped.Task.ClearAll()`. Those parts are **not reusable** here: they clear tasks, change heading and block movement, which are exactly the behaviors that must not be disturbed.

Only the dictionary/clip names were taken, as *candidates*, and are resolved at runtime (`DOES_ANIM_DICT_EXIST` → `REQUEST/HAS_ANIM_DICT_LOADED` → `GET_ANIM_DURATION > 0`); the first one that really exists is used and the rest are ignored. Nothing is guessed if none exist: the gesture is skipped.

| Reaction | Candidates, in order (male) | Female differences | Status |
|---|---|---|---|
| facepalm | `anim@mp_player_intupperface_palm/idle_a`; `anim@mp_player_intcelebrationmale@face_palm/face_palm` | tries `…female@face_palm` before the male fallback | **UNVERIFIED on Enhanced** |
| middle_finger | `anim@mp_player_intupperfinger/idle_a`, `idle_a_fp`; `anim@mp_player_intcelebrationmale@finger/finger`; `mp_player_intfinger/mp_player_int_finger`; `anim@mp_player_intselfiethe_bird/idle_a` | `…female@finger/finger` replaces the male celebration dict | **UNVERIFIED on Enhanced** |

The `anim@mp_player_intupper*` dictionaries are the upper-body variants and are tried first. The celebration/selfie variants are fallbacks that may animate more of the body; they are used with the same upper-body flag. The female dictionaries and the `selfiethe_bird` fallback are the least certain.

## Facial expressions: skipped

No facial-expression clip could be verified for Enhanced, and Essential lip-sync and PR #198 own the face while an NPC speaks. A facial layer that cannot be verified and that competes with mouth animation would be exactly the "continuous overwrite" the task forbids, so none was added. If Enhanced facial dictionaries are confirmed later, a facial reaction can be added as another catalog entry with a catalog-only change, but it must yield to lip-sync (apply only outside speech, or not at all).

## Verification

Done offline (this session):

- Companion: 22 new tests (selection, gating, ordering, cancel/interrupt/stale/released, the production turn flow with the hook absent/on/throwing, pipe handshake and exact frame shape). All pass. The full suite shows the same 13 pre-existing failures as before the change and no new ones.
- Native: 30 offline tests on .NET 10 with RAGE/Essential stubs (`native/reactions/tests`): catalog, native allow-list scan, codec, playback book, cooldowns, admission, timing, run lifecycle, preflight table, executor in off/shadow/on, interruption, death/replacement/despawn, world reset, supersession, wrong-tuple refusal, preflight refusals, missing clips, false-success guard, cooldown ordering, circuit breaker, callback flood, shutdown. All pass.
- Compile check: the executor, channel and integration compile for `net481` against the **real** `LosSantosAlive.dll` (with a stub `RagePluginHook`), which confirms Essential event, state and targeting member names and signatures match the pinned build.

**Not tested and requires GTA V Enhanced** (nothing was run in the game; nothing deployed):

1. Whether each candidate dictionary and clip exists on Enhanced, for male and female peds, and which candidate wins.
2. That `TASK_PLAY_ANIM` flags `16|32` (upper body + secondary slot) leaves following, waiting, sitting and walking visibly unchanged and does not stall the primary task.
3. That the gestures look natural and the timing (0.5–1.2 s into a line) reads well; that they are not too frequent with the default cooldowns.
4. That `IS_ENTITY_PLAYING_ANIM`, `STOP_ANIM_TASK`, `REMOVE_ANIM_DICT` and the read-only state natives (`GET_MISSION_FLAG`, `NETWORK_IS_SESSION_ACTIVE`, `IS_PED_BEING_STUNNED`, etc.) exist under these names via `CallByName` on Enhanced. A missing native throws, is counted as a fault, and after three faults the executor disables itself.
5. Interrupted TTS, vehicle/combat/death mid-line, ordinary vs promoted peds, and no interaction with PR #198 mouth animation or conversation gaze.
6. The named pipe under the real RPH host (ACL, reconnect after `WorldChanged`).

Suggested in-game order: set native `mode` to `shadow` and read the `[RX]` log lines; then `on` with `"disabled": ["middle_finger"]`; then enable both.

## Follow-up review fixes (2026-10-17)

- Native P2/ACT ownership: verified idle promoted actors and ordinary unpromoted Essential speakers are eligible for the independent game-native preflight. Retired/unknown promoted owners and active ACT/P2 activities remain blocked.
- Playing gestures recheck combat, current speaker, scenario and owner-state safety every owner-fiber update; loss of a condition ends only this clip.
- Playback START has bounded per-ped generation high-watermarks, including after END; stale/equal-generation conflicting starts cannot supersede newer playback. World resets clear the generation scope.
- Updated offline regression tests cover the previously missing paths. These do **not** constitute GTA V Enhanced acceptance.
