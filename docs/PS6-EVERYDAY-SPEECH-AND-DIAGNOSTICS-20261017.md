# PS6 everyday speech and source-to-playback diagnostics

## Scope

This is a **bounded extension of existing PS2 → PS3 → C-11 → native Essential stock speech**. It does not create a timer-driven chat generator, activity engine, provider, scheduler, synthetic witness, or independent player turn. All existing owner, microphone, Core playback, C-06, player-turn, script, PS3 ledger and native grant checks remain mandatory.

### Opt-in behavior

- `spontaneousSpeech.mode: "off"`: prior PS3 routine classification remains unchanged. Nothing new is submitted.
- `spontaneousSpeech.mode: "shadow"`: creates additional PS3 routine scene grants and observes selection but **never speaks**.
- `spontaneousSpeech.mode: "experimental"`: attempts real speech through the **original Director / native owner / Essential scheduler** when the complete native/companion permission chain is healthy. Same existing config; no new setting is required.

Eligible source-backed everyday cues are **`character_present`, `location_changed`, `activity_changed` and `vehicle_transition`**. PS2 must have successfully stored an **original direct self/visual supported presence/location claim** with a current owned observer and live local player. A report, conversation transcript, radio track, uncertain claim, empty scene, or unverified native signal is never silently upgraded. PS3 labels such cues as context candidate / speech eligible / no new memory. No cue authorizes physical actions.

Everyday cues have a separate **90-second attempted-speech interval per promoted NPC** (and retain the regular 20-second speaker cooldown, 8-second scene gap, 4 attempts/minute, one global flight). Verified PS3 danger always wins selection against routine scene cues. Deferrals from the ambient interval do not consume a source decision. Actual attempted source keys and native owner transitions are still one shot. No spontaneous talk is generated in the absence of a fresh native cue, even after 90 seconds. Existing PS3 original-source and native challenge/receipt rules effectively demand a rapid handoff (native original PS3 receipt is younger than 2 seconds).

### Diagnostics: how to interpret a quiet session

`perception_trace` covers firing, damage, death, body-discovery, vehicle damage and the four new everyday source signals. It records a **one-way signal trace code**, signal kind, producer, number of native/owned witness receipts, PS2 result, and best owned PS3 decision/first reason. Traces remain bounded to 20 owned and 6 other signals per 10 seconds. They contain **no NPC names, transcripts, raw event signals, capture refs or position data**.

The existing companion PS summary exposes `ps3.ownedByEvent` (each closed event type: decisions/none/eligible/urgent), plus `ps3.ownedReasons` (closed PS3 reasons, including `ambient_direct_witness`, `routine_low_relevance`, `evidence_uncertain`, `repetition_suppressed` and `suppression_capacity`). These distinguish "native never emitted an event", "event arrived without Nathan witnessing", and "PS3 declined" from "PS3 granted but Director/native/C-06/playback vetoed".

`director_gate` diagnostic `deferred_ambient_cadence` means a qualifying routine event was rate-deferred; `director_candidate` still reports the native reserve/submit/delivery outcome. A `no_ps3_response_candidate` means there was **no current granted candidate**, not evidence that C-06 was busy. Previously vague `non_13a_event` now reports `unsupported_director_event` for categories outside both allowlists.

### GTA validation

Deploy both companion and native assets from the same `main` build. Free roam with Nathan P2-owned, source sensing/PS3 enabled, `spontaneousSpeech.mode: "experimental"` and native Director experimental. Start with verified scene change (nearby visually witnessed arrival, player/NPC location change, activity change), microphone/text idle, and wait for a naturally available source event—no artificial timer or fake signal. Compare PS3 `ownedByEvent`, `perception_trace`, `director_gate`, `director_candidate`, native `[PS]` admission and original Core playback receipts. Verify one ordinary remark and that subsequent ambient attempts respect 90 seconds. Repeat with gunfire within that period: danger should not inherit ambient suppression. Repeat without an observer, during player mic activity and with a scene script/cutscene: there should be **no** new spontaneous turn. GTA results remain unverified until tested on installed build.

This change is **not** full memory-backed PS6/13b, generalized NPC social initiative, or chatter about arbitrary radio/music/weather. Those require distinct verified source/selection and relevance features.
