# PS6 speech admission with compatible NPC activities

**Scope:** Native C-06 admission only. PS2 witness evidence, PS3 grants, ACT physical execution, player priority, audio limits and opt-in settings are unchanged. This changes neither the ACT engine nor the stock Essential speech path.

## What changed

The existing native P2 owner proof now exposes one **read-only**, incarnation-matched live ACT capability, and only when the StepRunner has verified an established mode (not lost) or progress on an accepted approach/walk-away. The C-06 owner policy permits independent speech during:

- Native P2: idle, follow, wait, sit.
- Native ACT with current step proof: hold_position, follow_person, sit_on_ground, resume_ambient, stop_and_face, begin_driving; approach_person/walk_away_from only after accepted physical progress.

A P2 or ACT mode does **not** authorize speech by itself. Stale, terminal, pre-dispatch, not-yet-established, wrong-incarnation and unknown steps supply no qualifying ACT proof. The ACT step is not paused, canceled, dispatched again or treated as physically completed by speech. Explicit player commands retain priority.

Still **blocked**: essential_residual/unknown/foreign behavior; P2 suspension; ACT cover, scenario playback, vehicle entry/exit transitions, item commands and unlisted capabilities; script/cutscene/mission, reflex or directed interaction; non-idle player microphone/text/controls, an executing player/Core turn or queued audio; missing source/owner/PS3 evidence. Native proof revisions also prevent binding an old reservation after the owner changes. ACT transitions must requalify before the next unsolicited turn.

## Remaining limits

This does **not** make Director speech continuous or automatically reactive to routine events. Existing 13a event allowlist, PS3 urgency/grants, 2s urgent and 10s routine candidate freshness, cooldowns, rate limit, one global turn, and native/backend priority handoff are unchanged. After ACT boarding completes, an actor classified as essential_residual/unknown is **not** granted speech just for sitting in a vehicle; active P2 follow or a separately verified compatible ACT driving mode can speak. Future passive-passenger evidence would need its own real owner proof, not a permissive fallback.

## Verification

- Native C-06 contract tests: positive P2 modes and ACT allowlist, negative suspended/residual/unsafe capabilities, full C-06 admission still required.
- Full native production compile and Windows native tests: GitHub Actions `LSA v1 Offline Verification`.
- **GTA validation not yet performed**: Enable current experimental PS6 on a matching build. During an accepted ACT hold/follow/sit or P2 wait, trigger one qualified gunfire event while text, mic and audio are idle; verify original PS2/PS3 response, native C-06 ticket, real playback and unchanged ongoing ACT step. Repeat during ACT take_cover, boarding, script state, active mic and already-speaking NPC; verify native veto and no task interference. Record `director_gate`/`director_admission_veto`, native `[PS]` logs and source/build hashes.
