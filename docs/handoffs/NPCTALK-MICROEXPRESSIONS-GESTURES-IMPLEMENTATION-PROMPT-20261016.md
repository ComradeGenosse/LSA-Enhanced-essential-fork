# LSA implementation task — NPCTalk-inspired NPC microexpressions and gestures

**Repo:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Target:** latest PR #138 (`integration/memory-k-production-20261012`)  
**Plan:** `docs/plans/npctalk-microexpressions-gestures-implementation-20261016.md`  
**Pinned upstream:** `docs/research/vendor/npctalk-gestures-20261016/` (`NpcActions.cs`, `ActionCatalog.cs`, `Jev.cs`, MIT `LICENSE`)  
**Work style:** one small, testable gameplay slice; no architecture rewrite or thousand-test campaign.

### Goal

LSA NPCs occasionally perform a small, relevant visible reaction *while speaking*: a facepalm, dismissive hand gesture, or a safe subtle facial expression. Keep ACT/P2/Essential actions, speech, gaze and Memory K unchanged.

### Instructions

1. From latest #138 head, create a **separate feature branch + draft PR**. First inspect LSA's real native playback/turn binding, Essential gesture/task ownership and any existing animation path. Test NPCTalk's animation candidates against GTA **Enhanced** (not Legacy) when available. Write a brief source/IL-grounded audit. The copied files are for reference: **do not compile/copy their runtime wholesale**.
2. Adapt only a **tiny closed cosmetic animation catalog**: start with `facepalm` and `middle_finger` if their exact animation dictionaries, upper-body flags and task-preserving behavior are verified; otherwise use safe verified facial-only clips or report the blocker. NPCTalk's `Restore` clears all ped tasks and changes weapons: **never port that**. No attack, kiss, hug, run, undress, kneel, teleport, forced heading, or player animation.
3. Choose at most **one rare, contextual gesture per validated NPC line**, defaulting to `none`; favor high-precision, deterministic cues over speculative emotions. Don't follow orders just because player text asks for an action. Do not add Jev/TypeSafe, extra Luna calls, or a new `gesture` field to LSA's strict `{dialogue, command}` response. A dialogue turn with a normal Essential command should generally suppress cosmetics.
4. Anchor execution to **matching native playback** and the exact live speaker/turn/generation/run epoch; validate ped lifetimes and task state on native Core owner fiber. Fail closed on stale ped, interruptions, mission/combat/vehicle conflicts or animation slot ownership. No new ped task scheduler; overlay finite, scoped only to our own animation, with short overall and ~60s repeat cooldowns.
5. Default-off setting, optional `shadow`, plus limited traces without transcript text. For facial-only clips, yield to Essential's face behavior and future voice-presence PR #198 mouth animation; do not run independent facial loops that fight over `PLAY_FACIAL_ANIM` or CGE gaze.
6. Run focused scoped tests for turn fencing, no-gesture/repeats, no physical task clearing, reset/interrupt and disabled/shadow. Verify in Enhanced in-game (ordinary/promoted, female/male, follow/wait/sit, death, vehicle, combat) if GTA is available; otherwise state the GTA gate is open and keep `on` unverified.
7. Push the code as a draft PR against **current #138** with succinct source-audit results, test outcomes, and any blockers. **Do not merge before review.**

### Pass condition

Natural NPC dialogue sometimes triggers a compatible animation with no new LLM request, no forced compliance, no phantom action history, no altered Memory K, no duplicate voice or player-task disruption. Disabling the flag restores exact previous behavior.
