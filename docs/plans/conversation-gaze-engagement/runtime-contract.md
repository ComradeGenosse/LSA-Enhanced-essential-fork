# CGE runtime contract

Status: implementation plan; no runtime behavior is claimed by this document.

## 1. Ownership

CGE owns only **supplemental head/eye gaze commands that Essential is not currently owning**. It never owns whole-body orientation.

CGE never owns the dialogue session, selected-NPC identity, P2 identity, activity goals, action queues, locomotion, vehicle driving, scenarios, combat/flee tasks, playback, or model output. Essential remains authoritative for all of those.

## 2. Target identity

Resolve the active physical target on the Essential Core fiber in this order:

1. NpcTargeting.GetPlayerConversationPed()
2. NpcTargeting.GetCurrentSpeakerPed()
3. no target

Admit only a non-null, existing, living valid human ped that is not the player. Retain Ped, handle, and MemoryAddress. A target change, handle reuse with address mismatch, death, or disappearance invalidates the old epoch before another native command.

~~~csharp
sealed class ConversationAttentionTarget
{
    public Ped Ped;
    public uint Handle;
    public IntPtr Address;
    public long Epoch;
    public long AcquiredAtMs;
}
~~~

No ped handle is persistent identity.

## 3. Lifecycle signals

CGE needs four logical signals:

| Signal | Required source |
| --- | --- |
| conversation target acquired/changed | current NpcTargeting state |
| player speech started | source-time Essential input lifecycle |
| player speech ended | source-time Essential input lifecycle |
| NPC speech started/ended | NpcPlaybackCoordinator events |

NPC playback is already a proven public seam.

Player-speech start/end comes from the shared **C-01 UtteranceLifecycle** contract. If C-01 is not implemented yet, CGE stays at probe/planning status rather than creating its own approximate detector.

Do not derive "player is speaking" from post-STT completion. Typed input follows C-01's zero-duration utterance semantics.

## 4. State model

~~~text
Inactive
   |
   | valid target + conversation activity
   v
Acquiring
   |
   | first successful gaze command
   v
Engaged
   |
   | conversation becomes inactive
   v
Releasing
   |
   | release hold expires
   v
Inactive
~~~

Blocked conditions are a reason overlay, not a separate long-lived state.

## 5. Speech role

~~~csharp
enum ConversationSpeechRole
{
    None,
    PlayerSpeaking,
    NpcSpeaking
}
~~~

CGE1 only needs active engagement. CGE3 may use stronger continuous gaze and faster reacquisition while the player speaks, stable gaze with bounded micro-breaks while the NPC speaks, and a short hold between turns. No model call decides this role.

## 6. Native gaze policy

CGE0 pins the exact native/RAGE mechanism before CGE1 active mode.

Candidate mechanisms include Essential's existing `ConversationLookBehavior`, safe `NpcFocus` behavior, and only if necessary a GTA look-at primitive. The probe must determine whether the mechanism is head/eye-only, steals the primary task, coexists with walking/scenarios/vehicles, requires refresh, churns tasks, clamps extreme angles, and expires cleanly.

**Arbitration rule:** while Essential's own conversation look behavior is active for the current turn/mic/playback lifecycle, CGE yields and issues no competing gaze refresh. CGE is only a supplemental overlay.

Preferred CGE1 property: finite-duration look-at refreshed before expiry.

CGE1 must not call ClearPedTasks or ClearPedTasksImmediately. If a specific look-at clear native is considered, CGE0 must prove that it does not erase unrelated ownership. Otherwise release means stop refresh and allow finite gaze to expire.

Do not change persistent IK flags unless CGE0 proves they are required and safely reversible.

## 7. Starting tuning values

| Setting | Initial value |
| --- | ---: |
| gaze refresh | 150 ms |
| gaze native duration | 650 ms |
| max engage distance | 12 m |
| lost-target grace | 500 ms |
| release hold | 900 ms |

The gaze native duration exceeds refresh interval so one delayed tick does not visibly flicker.

## 8. Body reorientation contract

Whole-body reorientation is outside CGE.

If conversational behavior requires a physical face/turn, it must go through ACT3's `stop_and_face` capability and ACT's physical lease/arbitration. CGE never sets heading, never starts a body-turn task, and never clears ACT/Essential tasks to obtain orientation.

## 9. Vehicles

- Driver: head/look only if proven non-disruptive; never body-turn.
- Passenger: head/look only if live GTA proves it; never body-turn.
- Entering/exiting: block CGE native commands.
- A failed vehicle probe disables vehicle gaze without disabling on-foot CGE.

## 10. Safety gates

At minimum block native attention for invalid/dead/reused targets, invalid/dead player, existing scripted-state gates, ragdoll, unsafe vehicle transitions, excessive distance, and any state where the chosen native would steal critical behavior.

Combat/fleeing policy is conservative: CGE yields. Disable supplemental look-at whenever the GTA probe or Essential ownership indicates interference.

## 11. Release semantics

Normal release: enter Releasing, hold attention for releaseHoldMs, stop refresh, allow the finite native to expire, then discard transient state.

Forced release skips the hold for death, entity reuse, world reset, shutdown, or target replacement.

Shutdown must leave no long-duration CGE task behind.

## 12. Telemetry

No transcript/model content.

Required events/counters:

- cge_target_acquired
- cge_target_changed
- cge_target_invalidated
- cge_player_speech_started / ended
- cge_npc_speech_started / ended
- cge_gaze_started
- cge_gaze_blocked with bounded reason
- cge_body_turn_requested / settled
- cge_release_started / released
- cge_failsafe

Do not log each refresh line. Aggregate refresh counts in periodic diagnostics.

## 13. Failure behavior

All CGE failures fail soft: stop issuing new gaze/body commands, release transient state, log one bounded failure, and leave Essential dialogue/playback, P2, perception, and actions running. CGE failure must never unload or shut down P2/PS.
