# LSA — Conversational microexpressions and gestures

**Prepared:** 2026-10-16  
**Integration target:** PR #138, `integration/memory-k-production-20261012`; the research PR began from `158c5884d0c6befc0bdc35539c952ea9f5e06556`.  
**Source reference:** [pinned NPCTalk gesture sources](../research/vendor/npctalk-gestures-20261016/README.md) (MIT; GTA V Legacy).  
**Deliverable:** optional, lightweight nonverbal reactions from the *same* NPC already delivering a real validated line. Neither a replacement for Essential actions nor a new independent NPC agent.

## User-visible result

While a nearby NPC responds, it can occasionally **facepalm**, make a quick dismissive hand gesture, or show a subtle nonverbal reaction, *where the actual Enhanced animation is verified*. Gestures should feel like seasoning, not a canned emote on every line. The NPC continues its existing normal behavior when the animation ends. NPCs are free not to perform a gesture despite the player's request.

## Source and present LSA reality

**NPCTalk strengths worth adopting**
- `NpcActions.cs`: named candidates and animation fallbacks (`facepalm`, `middle_finger`, `square_up`); `Resolve()` tests `DOES_ANIM_DICT_EXIST`, `HAS_ANIM_DICT_LOADED` and animation duration; bounded playback; `OnPick()` suppresses repeating the same automatic action for 60 seconds.
- `ActionCatalog.cs`: closed list of actions with a `none` option and per-action selection thresholds, separating spontaneous reactions from explicit orders.
- `Jev.cs`: distinct remote TypeSafe/Jev inference call for action selection; **not a dependency** to introduce into LSA. The probability thresholds are vendor-specific model outputs and do **not** validate an LSA deterministic heuristic or imply our own confidence scores.
- **Bad fit:** `NpcActions.Restore()` disarms and calls `ped.Task.ClearAll()` after the gesture. Other upstream behaviors force facing, position, attack, target interactions, or clothing edits. Do not port any of these into cosmetic gestures.

**Existing LSA boundaries**
- `lsa-essential-e1-candidate/src/context/essentialDecision.mjs` enforces exactly `{dialogue,command}` (or the existing strict E5 streaming envelope). No `gesture` or emotion field is currently authorized. **Do not modify the response schema or ask Luna for a second gesture judgment.**
- `lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs`: dialogue/action validation is completed before final `output_transcript`; native audio authorization/playback is a separate exact-turn lifecycle. Early TTS may start before the final response, so **do not schedule physical reactions from a speculative model delta**.
- `native/promoted-characters/PromotedCharactersIntegration.cs`, `ActivityDispatch.cs`, and `native/activities/StepRunner.cs`: P2, Essential and ACT retain action, movement, follow/wait/sit and directed-interaction authority. An expression must never create another physical task owner.
- `docs/plans/conversation-gaze-engagement/runtime-contract.md`: CGE intends to own only supplemental head/eye gaze when Essential is not using it. Avoid competing gaze/head turn.
- [Voice-presence reference PR #198](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/198) separately plans NPC mouth animation; facial reactions must **yield to any active mouth-animation owner**, and vice versa, rather than having two systems continually overwrite `PLAY_FACIAL_ANIM`.
- CharacterService voice acting instructions reflect **personality/cadence**, not a verified turn-specific emotion classification. Do not falsely label them as a runtime "angry/happy" state.

## Phase 0 — quick Enhanced animation/ownership audit

1. Inspect pinned Essential DLL/public SDK for an existing gesture/emote/facial API, task/animation owners, action preemption rules, and the native source of active NPC audio. Prefer reusing a safe built-in cosmetic seam if it exists.
2. In a small local native debug command (not a permanent new UI), test NPCTalk's `facepalm` and `middle_finger` dictionaries/clips on ordinary male/female GTA Enhanced peds. Log whether dictionaries exist, clip durations, usable upper-body animation flags, and whether playing them steals walking/following, gun/combat, enter-car, or scenario tasks.
3. Probe candidate *facial-only* animation clips for mild expressions (e.g. smile/frown) independently; **NPCTalk does not provide a verified microexpression facial catalog**. Do not invent working facial names, assume Legacy clip parity, or run mouth and expression natives concurrently without arbitration.
4. Write a short evidence note distinguishing: safe facial overlay / safe upper-body-only gesture / blocks primary task / unavailable clip. If nothing is safe, stop at the audit and document why. This does not require a giant test framework.

## Phase 1 — minimal cosmetic reaction slice

**Recommended first allowlist:** `none`, `facepalm` and `middle_finger` **only if Phase 0 proves task preservation**; otherwise `none` plus verified facial-only expressions. `square_up` is a future optional action-heavy case, not default. No hugs, kisses, intimidation, punches, shots, kneeling, running, clothing swaps, teleports, or participant/player animation in this slice.

- Select **at most one** brief reaction for each *completed and validated NPC line* using a compact deterministic, **high-precision** cue policy over the actually spoken line and immediate NPC/dialogue context (when available); `none` is the overwhelmingly common result. A player saying "give me a hug" is **not** permission to act; insults are not automatic aggression. Don't infer emotions from arbitrary profanity or M8 opinions alone. If cues are insufficient, choose `none`. No second remote service, cloud classifier, prompt change, or model-generated extra action. Make the cue policy replaceable if genuine structured acting signals become available later.
- Separate the small pure selector (`lsa-essential-e1-candidate/src/...` or native, whichever best matches an existing **turn-scoped** seam) from the native executor; do **not** create a second activity scheduler or recurrent LLM loop.
- Only accept a **validated, final line bound to a current native actor/turn**, ideally attach right as the matching *native playback actually starts*. A line that fails or never plays must not produce a gesture. Keep model content out of a native config-driven arbitrary animation path: transmit a closed reaction name, not an arbitrary anim dictionary, duration, or target.
- In native Core/owner-fiber Update: verify the actual live ped, handle + `MemoryAddress`/incarnation as available, matching turn/generation/session, host/run epoch; reject an old A start/end after B starts. Don't use a stale `Ped.Handle` as durable identity. Support ordinary as well as promoted NPCs only when equivalent exact actor evidence exists.
- **Preflight:** dead/ragdoll, scripted/mission/cutscene, directed interactions, combat, flee, unsafe vehicle transitions, occupied primary animation slot, other native gesture, unknown owner. Gesture yields rather than overriding. Follow/wait/sit must remain intact; if the chosen anim is upper-body-only and demonstrated to coexist with walking, it may run while moving; otherwise only while safely idle.
- A finite, bounded action once per admitted turn. One overlay per ped, a short global cooldown (e.g. 12–20 s) and same-gesture cooldown around NPCTalk's 60 s. Keep bounded RAM state only. No memory persistence, SQLite journal writes, AI facts, ACT receipts or knowledge claims for cosmetic expressions.
- On playback end, interruption, retirement, replacement, host/world reset or shutdown, stop *only our own* animation if a verified **clip-scoped** stop exists; otherwise let a finite clip expire. **Never** call `Task.ClearAll`, `CLEAR_PED_TASKS`, `ClearSecondaryTask` without proven ownership, change ped heading, weapon loadout, component variations, or player animation. Never stop Essential audio or look behavior. Do not assert gestures succeeded merely because a task native accepted a call.
- Feature switch default `off`, optional `shadow`, explicit `on` only after safety probe; if capability absent, automatic opt-out with a single reason. Keep logging compact: reaction name, whether rejected and why, elapsed duration; **no transcripts** or user text.

## Phase 2 — subtle facial expressions, separately gated

If Phase 0 identifies safe facial-only clips, add a small expression overlay with at most 2–3 moods. Coordinate with PR #198's potential mouth driver, stock Essential conversation facial behavior, and CGE head/eyes. Prefer time-boxed onset at a natural point in audible dialogue; when competing native facial owners cannot be detected/arbitrated, **defer facial expressions** rather than overwrite mouth synchronization. No speculative per-phoneme emotion inference.

## Out of scope and pitfalls

- No TypeSafe/Jev key, separate classifier inference, OpenAI output schema edit, new persona/Memory K prompts, new action planner, or mandatory conversion of all conversation turns to commands.
- No force-compliance, no "NPC must obey player action request", no equating facial gestures with ACT's `PHYSICALLY_COMPLETED`, and no pretending an old accepted action implies a fresh safe animation.
- No fixed male-only assumptions: verify each candidate for male/female archetypes and skip gracefully when invalid.
- Do not conflict with PR #198; both PRs should remain independent until common facial-ownership needs are explicitly reviewed. Do not silently integrate either into #138.

## Verification and exit

**Focused offline checks:** at most one reaction per actual playback turn; default off/shadow cannot mutate; no reaction from unplayed/cancelled/invalid or command-bearing turns; strong `none` preference; cooldown and actor lifecycle fencing; preemption, failed anim load, death and reset. In CI, use existing targeted native/companion tests and build; no unnecessary blanket suite.

**Actual Enhanced GTA test:** ordinary and promoted male/female ped; one facepalm and dismissive gesture each; natural conversations with **no** gesture; follow/wait/sit and locomotion unchanged before/during/after; interrupted TTS, player switches/UX4, vehicle transition, combat, scripted state, and facial/mouth/gaze conflicts. Record video or detailed runtime observation. If GTA unavailable, explicitly mark the feature "offline-only / GTA unverified", default-off.

**Acceptance:** Gestures are visibly relevant but rare, do not disrupt speech or primary ped behavior, cease by finite lifetime, never generate an extra provider request, do not change the AI prompt, ACT, Memory K or identity source, and can be fully disabled. Deliver **implementation in a separate draft PR against latest #138**, with a short audit and targeted evidence; review before merge.
