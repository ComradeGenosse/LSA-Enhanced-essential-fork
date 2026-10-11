# October 11 radio and spontaneous-speech GTA regression gate

This PR is based on the merged radio v2 `main`. It is a **diagnostic and
safe-idle correction**, not a physical validation receipt or new response
entitlement. Retain the existing native and companion opt-ins.

## Radio

The native radio sampler now produces bounded `[PS] radio_read_failure` lines
with the **exact failed read stage**, a closed exception class, HResult, and
cumulative failure count:

- `player`, `vehicle`, `vehicle_anchor`: player/vehicle read or anchor retention
- `station_name`: `GET_PLAYER_RADIO_STATION_NAME`
- `sound_name`: `GET_CURRENT_TRACK_SOUND_NAME`
- `track_text_id`: `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID`
- `play_time`: optional `GET_CURRENT_TRACK_PLAY_TIME` (a failure does not
  invalidate an otherwise successfully sampled song)
- `commit`: processing a sampled tuple

The first/new failure signature logs immediately. Repeating the same stage
and error class logs at most once every 10 seconds while the total counter
continues to increment. No station text, song metadata, Ped identity, exception
message, file paths, provider key or model request contents are recorded.

A native that **returns an empty station without throwing** instead emits
`[RADIO_PROBE] ... state=blank_station` while a vehicle exists. An invalid
nonempty station still logs the prior `rejected=station_grammar` fields.
The previous 10-second `[PS] shadow ... radio=samples:edges:failures`
counters remain available.

Test with Nathan in the same vehicle and a known audible song. If
`stage=track_text_id` persists, the radio call or GTA Enhanced native
compatibility needs separate repair; the code does not invent a song as a
fallback. Keep the whole `RagePluginHook.log`, companion `logs/` and
`logs/dialogue/` directories, and both native/companion radio configs.

## Director C-06

The pinned Essential Core current-speaker getter forwards to the selected
player-conversation target. Its **retained selection** must not itself count
as an active player turn after the user stops talking.

The narrow change permits a selected current P2 speaker to pass the
conversation-idle check only if (a) selection remains the same across two
Core samples and (b) a valid original/backend quiet receipt and all
independent mic, text, controls, playback, P2 owner, actor reflex and game
script safety reads independently prove idle.

A different selected NPC, an unknown or changing target, active player input,
playback, unsafe game scripting, missing authenticated original turn proof,
expired owner identity or actor activity **must still veto** a new
spontaneous speech request. All existing C-06, PS3, original-key, one-shot
and player-priority checks remain in place.

### Acceptance exercise

1. Restart in free roam with both settings already enabled. Summon Nathan.
2. Finish a normal typed/voice exchange without clearing the selected target.
3. Shoot into a safe area near Nathan and do not start a player turn; observe
   `director_admission_veto` and `director_handoff` in `RagePluginHook.log`
   and `director_gate` / `director_candidate` in companion telemetry.
4. Repeat while actively holding the mic or during playback: spontaneous
   speech must yield to player input/Essential playback.
5. Ask Nathan which song is playing while both are inside the same vehicle.
   Compare `[RADIO_PROBE]`, `[PS] shadow ... radio=`, `radio_heard`
   receipts, and the frozen radio fact in the dialogue model request.
6. Collect the same session logs and do not record these gates as physically
   accepted until the actual game results confirm them.

Automated guardrail coverage: native Director contract tests exercise
exact/stable selection and denial for stale/occupied/unknown source proofs;
native PS integration tests exercise each radio-native read stage,
failure-throttling, optional play-time errors and blank station diagnostics.
Full GTA Enhanced validation remains external.
