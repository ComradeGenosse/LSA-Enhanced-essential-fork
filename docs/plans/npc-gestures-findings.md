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

## Facial expressions: skipped (verdict: blocked)

The G1 feasibility audit is in [npc-facial-acting-g1-verdict.md](npc-facial-acting-g1-verdict.md). Summary: ownership of the face cannot be proven (Essential `NpcLipSync` exposes no state, the #215 overlay's state is private), no mood clip is verified on Enhanced, and `PLAY_FACIAL_ANIM` has a single slot. Nothing facial was added beyond a read-only dictionary-existence probe.

Original rationale: No facial-expression clip could be verified for Enhanced, and Essential lip-sync and PR #198 own the face while an NPC speaks. A facial layer that cannot be verified and that competes with mouth animation would be exactly the "continuous overwrite" the task forbids, so none was added. If Enhanced facial dictionaries are confirmed later, a facial reaction can be added as another catalog entry with a catalog-only change, but it must yield to lip-sync (apply only outside speech, or not at all).

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

## Completion after #204 (plan #222: G0, G1, G2, G3)

Status legend: **code** = implemented and covered by offline tests, **CI** = to be confirmed by the PR's checks, **GTA** = needs GTA V Enhanced and is **OPEN** for everything below.

| #222 item | Result | Code | GTA |
|---|---|---|---|
| G0 diagnostics: dictionary exists / loaded, winning clip, duration, clip-scoped stop | `reactions.diagnostics: true` adds `[RX] probe …` (once per reaction and gender) and names the winning clip and duration on `[RX] played`. Reads only; catalog constants only, never dialogue. | done | OPEN |
| G0 matrix on Enhanced (facepalm, middle finger) | Checklist below. Cannot be produced without the game. | n/a | **OPEN** |
| G1 facial feasibility | Verdict **blocked**, no facial code. See the verdict doc. | n/a | OPEN (experiments listed there) |
| G2 natural body language | `nod` and `shrug` added as **opt-in** reactions. Not facepalm-style defaults: both configs must list them in `reactions.enabled`. `square_up` and pointing stay out of scope as #222 requires. | done | **OPEN** |
| G2 ElevenLabs / personality | The turn's trusted delivery value can only **veto** a contradicting gesture (see below). No second model call, no schema change, no M8 personality inference. | done | OPEN |
| G3 config agreement, docs, checklist | Both example configs updated; this section; checklist below. | done | OPEN |

### What changed in the code

| Where | Change |
|---|---|
| `native/reactions/ReactionCatalog.cs` | `nod` and `shrug` specs (opt-in, own start window, short ceilings) and the facial probe dictionary list (existence only). |
| `native/reactions/ReactionPolicy.cs` | `ReactionOptions.Enabled` / `Diagnostics`; admission refuses opt-in reactions that are not listed (`reaction_not_enabled`); per-spec start windows (`ReactionTiming.StartDelayMs(key, spec)`; default window unchanged). |
| `native/reactions/ReactionExecutor.cs` | Uses the per-spec window; diagnostics probe; clip name on the `played` log when diagnostics is on. No new native is called. |
| `native/promoted-characters/RuntimeEntry.cs` | Parses `reactions.enabled` and `reactions.diagnostics` (literal `true` only). Compile-only stubs in `runtime-tests`, `ps-host-tests` and `bridge-tests` follow the new members. |
| `lsa-essential-e1-candidate/src/reactions/*` | `nod`/`shrug` names; `reactions.enabled` in config (opt-in names only); cue sets and the generalised selector; `deliveryAllows` veto table; service `delivery(value)` hook. |
| `lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs` | Two more try/catch hooks, one after each `expressiveDelivery.forSegment` call, passing only the delivery *value*. The turn is unchanged whether the hook is absent, on, or throwing (tested). |

### nod and shrug

| Reaction | Candidates (male; female replaces the dictionary, then falls back to male) | Start window | Ceiling | Status |
|---|---|---|---|---|
| nod | `gestures@m@standing@casual` / `gesture_nod_yes_soft`, `gesture_nod_yes_hard` (female `gestures@f@standing@casual`) | 250–699 ms into the line | 1.4 s | **UNVERIFIED on Enhanced** |
| shrug | `gestures@m@standing@casual` / `gesture_shrug_soft`, `gesture_shrug_hard` (female `gestures@f@standing@casual`) | 400–899 ms | 1.8 s | **UNVERIFIED on Enhanced** |

They use the same fenced pipeline as the other two: exact `playback_started` for the turn, native speaker/identity check, the same preflight table re-checked every tick, finite upper-body secondary-slot clip, clip-scoped stop, same cooldowns (global 12 s, per ped 20 s, same reaction 60 s). Candidates are resolved at runtime, so a missing dictionary is a quiet `no_clip` skip, not a fault.

**Cues (NPC's validated reply only, never the player's words):**

- `nod`: a strong agreement phrase ("you got it", "sounds good", "fair enough", "that's right", "you're right", "I agree") or two weak ones (a sentence-opening "yeah/sure/okay/right," plus "got it", "exactly", "makes sense"). A bare "yeah" or "sure" stays `none`. A cue inside a question, a negation, reported speech or quotes is ignored.
- `shrug`: "I don't know", "no idea", "beats me", "who knows", "I can't tell you", or two weak ones ("whatever", "I guess", "maybe", "not sure", "don't care"). Negation is part of these cues, so only quoting and reported speech suppress them.
- Playful lines (`haha`, `just kidding`), command-bearing turns, non-player sources and two competing reactions all resolve to `none`. A disabled opt-in reaction is not even scanned, so it cannot change the result for facepalm or middle finger.

### Delivery intent: veto only

When the speech resolver attaches trusted delivery values to the turn's segments (ElevenLabs experimental delivery only), **any** contradicting segment can veto a gesture. Neutral or matching earlier segments do not conceal a later veto; the service waits for validated dialogue and native playback before sending a frame:

| Reaction | Vetoed by |
|---|---|
| facepalm | whisper, fearful |
| middle_finger | whisper, fearful, sad, amused, concerned, excited |
| nod | sarcastic, angry, fearful |
| shrug | fearful, excited, angry |

`neutral`, a missing value and any untrusted or unknown value never veto. A delivery value **never selects or strengthens** a gesture: a tone hint is not witnessed emotion and not consent. Without ElevenLabs delivery, behavior is exactly the text-only selection.

### Configuration additions

Companion `e1.config.json`:

```json
"reactions": { "mode": "off", "pipeName": "LSA.Reactions.v1", "enabled": [] }
```

Native `LSA.PromotedCharacters.json`:

```json
"reactions": { "mode": "off", "pipeName": "LSA.Reactions.v1", "disabled": [], "enabled": [], "allowDuringOwnedBehavior": false, "diagnostics": false }
```

- `enabled` accepts only `nod` and `shrug`. It must be set in **both** files. Companion-side it controls what is selected; native-side it controls what may animate. A one-sided setting never produces motion (native answers `reaction_not_enabled`).
- `diagnostics` needs the literal `true` and only adds log lines.
- Nothing is enabled by installing or upgrading: defaults are unchanged and `mode` stays `off`.

### Offline verification (this PR)

- Native: `dotnet run --project native/reactions/tests/ReactionTests.csproj` — 41 tests (32 before). New: catalog, opt-in admission, per-spec timing, nod and shrug playback for both sexes, female-to-male fallback, quiet `no_clip`, shadow and unlisted refusals, clip-scoped stop, diagnostics (off by default, once per session, no dialogue, read-only in shadow).
- Companion: `node --test lsa-essential-e1-candidate/tests/reactions*.test.mjs` — 38 tests (23 before), including production-runner tests with a real ElevenLabs delivery value, and a throwing delivery hook.
- Compile-only checks of `RuntimeEntry.cs` against the three stub sets pass; their executables run in Windows CI.
- **Not done:** the production `net481` build against the genuine installed RPH and Essential references (not available here), and **everything in GTA**.

### GTA V Enhanced checklist (all OPEN)

Report offline tests, production build and physical GTA results separately. Suggested order:

1. Set native `reactions.mode: "shadow"`, `diagnostics: true`, `enabled: ["nod", "shrug"]` (and the same `enabled` in `e1.config.json`). Talk to a male and a female ordinary NPC. Read the `[RX] probe …` lines: which dictionaries exist on Enhanced? Record them in the matrix.
2. Switch to `on` with `"disabled": ["middle_finger", "shrug"]` and test **facepalm** and **nod** alone, then enable the rest one at a time.
3. For each reaction and sex (ordinary and promoted), record: clip that won, visual quality, upper-body only (legs and path unchanged), timing against the line, and whether the NPC's own look-at or Essential's turn-to-listener visibly fights a nod or shrug.
4. States to exercise: idle, mid-sentence barge-in, walking, follow/wait/sit, scenario, vehicle, combat/flee, mission/cutscene, interrupted TTS, actor despawn, handle reuse, world reset, rapid turns. Any state that misbehaves means that reaction stays off for it.
5. With ElevenLabs experimental delivery on, confirm a sarcastic or amused line does not nod or flip a finger when the words alone would.
6. Fill in this matrix and keep any reaction that did not pass in `disabled` (or out of `enabled`):

| Reaction | Male clip that played | Female clip that played | Upper body only | Coexists with look-at/turn | Barge-in stop clean | Verdict |
|---|---|---|---|---|---|---|
| facepalm | | | | | | |
| middle_finger | | | | | | |
| nod | | | | | | |
| shrug | | | | | | |

Rollback: set native `reactions.mode` to `off` (or remove the name from `enabled`) and restart the host. No other state is involved.
