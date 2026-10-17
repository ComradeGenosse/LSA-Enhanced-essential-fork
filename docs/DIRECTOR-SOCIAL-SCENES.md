# Director social scenes

The existing Director now admits two **independent initiation sources**: PS3 reactive
perception and authenticated native social scenes. Both route into the original
Core/Essential special-turn scheduler, Luna dialogue generation, TTS and native
playback completion. Neither scene evidence nor a model prompt grants native
turn ownership. C-06, Core player-turn and mic/playback safety remain mandatory.

## Enable

In the existing companion config, keep:
```json
{
  "intelligence": {"mode": "shadow"},
  "spontaneousSpeech": {"mode": "experimental", "preset": "normal"}
}
```

The native promoted-character add-on must be rebuilt and deployed from this
branch alongside the matching companion. Both must negotiate the existing
`directorRequestVersion: 1` channel. If native experimental Director
authorization or the original Core backend quiet proof is unavailable, social
opportunities are not permitted to speak. Existing `off` / `shadow` modes
cannot produce social speech.

**No separate social engine, AI provider, model API, dialogue templates, or
ACT executor is introduced.**

## Scene behavior

- **Shared car** — detect exact current P2-owned actor + local player in the
  same GTA vehicle; qualify after settling (~0.7 seconds). Brief re-entry
  into the same car is deduplicated. Driving/passenger role is observed rather
  than inferred from dialogue.
- **Reunion** — within 16 m, after the pair have joined for ~1.2 seconds.
  Native owner lifetime and last greeting limit repetition.
- **Shared idle** — after ~40 seconds without meaningful movement or a
  shared vehicle, limited to once per ~2 minutes.
- **Travel** — first opportunity after ~45 seconds of the same trip, then
  no sooner than ~2.5 minutes later.
- **Activity transition** — meaningful follow/wait mode changes, no more
  often than ~90 seconds.
- **Manual** — open the local **Characters** editor, select a promoted NPC
  in GTA with Essential, and choose **NPC: start a conversation**. This queues
  a source-verified native social opportunity, not a normal player question.
  The editor deliberately distinguishes "queued" from a native acceptance or
  completed speech. Player conversation, unsafe behavior and audio playback
  continue to veto admission.

These windows are bounded default native heuristics, not a timed dialogue
tree. Luna chooses its words using its existing character/personality/context
pipeline. Social frames are source-fenced to P2 incarnation, current
observer/player refs and host/world; repeated wire snapshots reuse the same
scene GUID, and social turns cannot reuse PS3 authority.

## Diagnostics and troubleshooting

On the companion:
- `director_candidate` now includes `source: social` and `sceneType`
  for native scene candidates. Follow the outcome from selection, pacing and
  native reserve/submit to real playback completion.
- `spontaneousSpeechStatus()` reports whether experimental execution is
  available; mere social scene receipt does not establish it.
- `director_social_manual_result` is a native owner-fiber acknowledgment:
  `opportunity_created` vs `selected_promoted_npc_unavailable`.
  Neither means the speech played.
- Existing `no_ps3_response_candidate` reports concern only the reactive
  lane; these alone must never suppress a valid social lane.

If the NPC remains silent: verify matching deployed native/companion builds;
Native/Essential experimental capability; an observed P2-owned speaker near
the player; unchanged host/world and owner revision; no player microphone/
input, active conversation, player turn, playback or critical task; and
Director's native reservation and stock scheduling diagnostics.

Native scene facts carry only scene IDs, role and source-bound lifetime refs,
not arbitrary transcript, memory content or scripts. The model must not invent
shared memories: existing verified Memory K recall is the only factual source.

## Validation

Run `node --test tests/director-social-scenes.test.mjs` in
`lsa-essential-e1-candidate`, the existing Director/PS6 tests, and the
Windows production native build `node tools/native-sdk/compileProductionNative.mjs`.
The PR's `director-social-scenes.yml` workflow runs both suites.

Gameplay acceptance (still requires an installed GTA test): with an available
promoted Nathan, enter a car together, allow both to settle, and confirm
Nathan starts a natural Luna line without a player prompt or significant PS3
event. Then test brief car reentry, long travel, reunion, idle, and speaking/
loading interruptions to ensure no duplicates or overlapping speech.
