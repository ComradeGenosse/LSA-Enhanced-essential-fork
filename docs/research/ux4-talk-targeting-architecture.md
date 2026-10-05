# UX4 Talk Target Selector — architecture research

> **Current implementation note:** UX4 is now merged to `main`. This document preserves the source-grounded design work, but some proposed interaction details are superseded: current main uses **normal hold = direct Talk/no bracket** and **tap/cycle = explicit selector with a short-lived bracket**. Shared Essential `TalkKey` interception is implemented. See [current status](../UX4-talk-targeting-status.md).

Status: architecture for the UX4 implementation. T0A replaced the synthetic TalkKey idea with `InputController.SendMicStart(Ped)` / `SendMicStop()`. Preview and cycling do not call `SetPlayerConversationPed`.

Research base: main at bc3b2027b0b2eb6a3c1a7dcb326587f9af781696. Implementation base: main at 8c63b20492fbf6bc2e1ba98acc598259c22a57fe.

## 1. Goal

Make controller voice targeting explicit, visible and reusable instead of relying on an implicit "current NPC".

Desired player flow:

~~~text
tap Talk
  -> select the best nearby NPC
  -> show a persistent visual indicator on that NPC

tap Talk again soon
  -> cycle to the next nearby NPC
  -> move the indicator

hold Talk
  -> lock the selected target
  -> start Essential PTT to that exact NPC

release Talk
  -> release Essential PTT
  -> keep selection alive briefly for Follow / Wait / menu / another turn
~~~

The selected target must remain visually identifiable while seated in a vehicle. Selection must never silently jump to a different ped after despawn, handle reuse, death, world reset or target invalidation.

## 2. Existing seams that make this feasible

The repository's current Essential API audit records public targeting seams in LosSantosAlive.NPC.NpcTargeting:

- SetPlayerConversationPed(Ped)
- GetPlayerConversationPed()
- ClearPlayerConversationPed()
- ActivateAttention(Ped)
- GetCurrentSpeakerPed()
- GetBestConversationPed(...)
- GetNearestPed(...)
- IsValidHumanPed(Ped)

The same audit records PerceptionSystem snapshots with AllPeds and lookup helpers.

Current P2/native UX already exposes a safe same-user bridge from the loader AppDomain into PromotedCharactersIntegration.Update:

- native/promoted-characters/LocalCommandQueue.cs
- native/promoted-characters/NativeCommands.cs
- native/enhanced/Commands/NativeBridge.cs
- native/enhanced/Commands/NativeSnapshot.cs

Every game read and Essential call already happens on Core's Update fiber. That boundary should remain authoritative.

Current CurrentPed() resolution is:

~~~text
NpcTargeting.GetPlayerConversationPed()
    ?? NpcTargeting.GetCurrentSpeakerPed()
~~~

The implementation should change that to prefer a valid explicit TalkTargetSelector selection, then fall back to the existing behavior.

Current UX input handling is in:

- native/enhanced/Input/InputRouter.cs
- native/enhanced/Input/GestureRecognizer.cs
- native/enhanced/Input/EssentialKeyRelay.cs
- native/enhanced/EnhancedHost.cs

EssentialKeyRelay is pulse-oriented. PTT needs a distinct held-key lifecycle so the normal pulse relay should not be stretched into an ambiguous long-running state machine.

## 3. Hard architecture boundary

The feature is split across the existing AppDomain boundary.

### Loader / UX domain owns

- physical controller Talk-key state, either a neutral key or Essential's TalkKey under the dedicated UX4 interception lease
- tap versus hold recognition
- tap/hold recognition plus exact native PTT start/stop requests
- user-facing HUD status
- settings and diagnostics
- cancellation on focus loss, menu opening, settings reload or host shutdown

It does not own Ped objects, target lifetimes or GTA world selection.

### Essential / P2 domain owns

- nearby-ped candidate discovery
- selected Ped and exact live-lifetime validation
- candidate cycle order
- NpcTargeting mutation
- screen-space target indicator rendering
- selection expiry
- current-NPC precedence
- world reset / target retirement cleanup

It never reads the physical controller directly and does not synthesize keyboard/mouse input.

### Essential remains authoritative for

- microphone capture
- turn/session/generation creation
- conversation state
- provider lifecycle
- action validation
- playback
- native action execution

UX4 selects which valid NPC Essential should address. It does not create another conversation or microphone pipeline.

## 4. T0A offline targeting audit — completed

T0A was closed from the exact checked-in Essential DLL with ILSpy in GitHub Actions. See [UX4 T0 targeting audit](ux4-t0-targeting-audit.md).

The original assumption was wrong: pre-setting PlayerConversationPed and then synthesizing Essential's normal TalkKey would not preserve an explicit UX4 selection. Stock normal Talk recomputes GetBestConversationPed(...), calls SetPlayerConversationPed(bestConversationPed), and only then enters the microphone path.

The audit found a better supported seam:

~~~text
UX4 exact selected Ped
  -> NpcTargeting.SetPlayerConversationPed(selectedPed)
  -> InputController.SendMicStart(selectedPed)
  -> same private stock mic core used by normal/marked Talk
  -> ConversationHydrationCoordinator.BeginMicTurn(selectedPed)
  -> stock microphone/provider lifecycle

release
  -> InputController.SendMicStop()
~~~

InputController.SendMicStart(Ped) is public and passes the supplied Ped directly into the stock mic core. That core does not call GetBestConversationPed or GetPlayerConversationPed. BeginMicTurn likewise does not reselect another NPC.

SetPlayerConversationPed is not a passive preview setter: it also registers interaction context, detaches conflicting directed interaction, queues conversation warmup and sets focus. UX4 therefore calls it only at committed PTT start, never while merely previewing/cycling.

ActivateAttention is simply an alias for SetPlayerConversationPed.

Text is separate: TextInputService.StartTextInputMode recomputes GetBestConversationPed and sets that result. Explicit UX4 typed targeting is a separate follow-up.

T0B in GTA is now an acceptance smoke test, not an architecture-discovery gate. No Essential source patch is currently required.

## 5. Selection model

Add native/promoted-characters/TalkTargetSelector.cs.

Proposed runtime-only contract:

~~~text
TalkTargetSelection
  Ped Ped
  IntPtr Address
  string SelectionId          random runtime UUID
  string EncounterId?         resolved lazily for current-command expectations
  long SelectedAtMonotonicMs
  long ExpiresAtMonotonicMs
  int CycleIndex
  int CycleCount
  bool PttCommitted
~~~

Candidate entries:

~~~text
TalkTargetCandidate
  Ped Ped
  IntPtr Address
  float Distance
  float ScreenCenterError
  bool OnScreen
  bool ExistingConversation
~~~

No Ped handle, address, selection id, cycle list or PTT state is persisted.

A target is valid only if:

- Ped still exists
- Ped memory address is unchanged
- Ped is alive
- Ped is not the player
- NpcTargeting.IsValidHumanPed returns true
- it remains inside the configured retention distance
- no game-clock/world reset invalidated the selector

Invalid selection is cleared. It is never replaced automatically with a new ped. The next deliberate tap/hold may create a new selection.

## 6. Candidate discovery and ranking

Candidate discovery runs only when the player asks for selection. It is not a permanent world scan.

Default bounds:

- search radius: 15 m
- retain radius while selected: 20 m
- maximum candidates: 8
- frozen cycle list lifetime: 1.5 s
- selected-target idle lifetime: 8 s
- no LOS requirement in v1, because a vehicle body must not hide a seated occupant from the selector

Use the existing PerceptionSystem snapshot when available. Filter before scoring.

Ranking is deterministic:

1. currently selected/current conversation target if still valid and this is a continuation cycle
2. candidates that project on screen
3. smallest screen-center error
4. shortest world distance
5. stable tie break using the frozen candidate order

The first selection rebuilds and freezes the list. Repeated taps during the cycle window advance through that same frozen list and wrap at the end. Ped motion must not reshuffle the list mid-cycle.

After the cycle window expires, the next tap starts a new selection session and rebuilds the list.

A list containing one candidate simply reaffirms the same target on repeated taps.

## 7. Current-NPC precedence

CurrentView() and CurrentPed() should use:

~~~text
TalkTargetSelector.SelectedPedIfValid()
    ?? NpcTargeting.GetPlayerConversationPed()
    ?? NpcTargeting.GetCurrentSpeakerPed()
~~~

This makes the explicit selection automatically useful to existing:

- current.follow
- current.wait
- Promote
- Current NPC quick menu
- current_describe
- other commands that intentionally consume CurrentView

The exact selected encounter is still revalidated at execution. Existing expectedEncounterId / target_changed behavior remains.

T0A showed the setter is not a preview. Selecting or cycling does not call it. `CurrentPed()` prefers the valid UX4 ped, so Follow, Wait, Promote and the Current NPC page use that ped. `SetPlayerConversationPed(selectedPed)` runs only when PTT is committed.

## 8. Input state machine

Add `native/enhanced/Input/TalkTargetInput.cs`.

The physical controller Talk control may stay mapped to Essential's existing TalkKey. In shared-input mode UX4 polls the real physical key while a separate native interception lease suppresses Essential's duplicate Talk polling. A neutral router key remains supported as an alternative. Never synthesize Essential TalkKey to start the UX4 microphone lifecycle.

PTT has its own press/release state machine rather than a normal GestureRecognizer command:

~~~text
Idle
  key down -> PendingHold

PendingHold
  release before talkHoldMs
    -> select/cycle only
    -> Idle

  threshold reached
    -> send talk.ptt_start for exact selection/PTT generation
    -> StartPending

StartPending
  matching native start succeeds while key is still held
    -> Talking

  key released before reply
    -> fence generation
    -> ensure matching stop if native start crossed the boundary
    -> never treat a late success as a new press

Talking
  key released
    -> talk.ptt_stop
    -> stock InputController.SendMicStop()
    -> Idle after ownership clears

  gate closes / focus lost / settings reload / shutdown
    -> request matching native stop immediately
~~~

Suggested initial `talkHoldMs`: 220 ms, configurable 120–500 ms and tuned from GTA measurements.

On current main, a hold with no prior explicit target chooses the best candidate for that PTT only and does **not** show the selector indicator. Tap/cycle is the explicit-selection path; its bracket previews briefly and is hidden when PTT starts.

## 9. Direct stock mic lifecycle — no synthetic TalkKey

T0A removes the need for a held keyboard/mouse relay.

UX4 must not synthesize Essential TalkKey for PTT because stock Talk performs its own target selection and can overwrite the explicit UX4 target.

At committed start, the native P2-domain operation runs:

~~~csharp
NpcTargeting.SetPlayerConversationPed(selectedPed);
InputController.SendMicStart(selectedPed);
~~~

Release runs:

~~~csharp
InputController.SendMicStop();
~~~

The native side tracks a bounded UX4 PTT generation and exact selected lifetime so a late start cannot survive a player release and a stop cannot terminate an unrelated stock/MarkedTalk turn.

This preserves Essential's stock microphone hydration, provider and release lifecycle without creating a second conversation pipeline.

## 10. Native bridge operations

Extend LocalCommandQueue with internal talk-target operations. These are not model commands and do not grant new NPC action authority.

Recommended commands:

- talk.select_first
- talk.select_next
- talk.ptt_start
- talk.ptt_stop
- talk.clear
- talk.inspect

Add source talk_input to the strict source allowlist.

talk.select_first:
- no target expectation
- build bounded candidate list
- select best
- return selection summary

talk.select_next:
- requires current selection session
- advance frozen list
- return selection summary

talk.ptt_start:
- requires expected SelectionId, PTT generation and expected EncounterId when materialized
- revalidates exact Ped + MemoryAddress
- calls SetPlayerConversationPed(selectedPed) only at committed start
- calls InputController.SendMicStart(selectedPed)
- records exact UX4-owned active generation

talk.ptt_stop:
- accepts only the matching UX4 PTT generation
- calls InputController.SendMicStop only for a UX4-owned start
- clears UX4 PTT ownership even if the selected Ped is no longer valid

talk.clear:
- clears only UX4's selector state
- clears Essential player-conversation ped only if UX4 still owns the exact ped it set; never clear somebody else's newer selection

talk.inspect:
- read-only diagnostics

Every command stays inside the existing queue capacity/freshness rules and executes on Core.Update.

## 11. Snapshot contract

Extend the existing local snapshot rather than creating another channel.

Add an optional talkTarget object:

~~~json
{
  "present": true,
  "selectionId": "<uuid>",
  "encounterId": "<uuid or null>",
  "pedId": "<diagnostic handle string>",
  "cycleIndex": 1,
  "cycleCount": 3,
  "pttCommitted": false,
  "expiresInMs": 6420
}
~~~

This is runtime UX information only. Loader parsing remains defensive. No Ped memory address crosses the boundary.

Current continues to represent the actual selected/current command target so existing dispatcher logic remains compatible.

## 12. Visual target indicator

Add native/promoted-characters/TalkTargetIndicator.cs, invoked from the existing P2 Update path after selection validation.

V1 should be geometry-first, not name-dependent.

Primary indicator:

- derive a point above the target's head/upper body
- project world position to screen coordinates
- draw four small HUD rectangles/brackets around the projected point
- optionally show cycle position such as 2/3
- keep the indicator above a seated driver's/passenger's projected head
- do not require clear LOS, so the car body cannot suppress the marker

A world-space marker can be an optional secondary cue, but it must not be the only cue.

The indicator exists only while:
- target is valid
- selection is unexpired, or PTT is actively held
- game is focused / not in a blocked scripted state
- UI settings permit it

Do not render durable names from guessed identity. A promoted name may be displayed only through existing authenticated profile/current_describe data; the correctness of targeting must never depend on that lookup.

## 13. Settings

Extend Plugins/LSA.Enhanced.json with an optional talkTargeting section. Default disabled.

Proposed shape:

~~~json
{
  "version": 1,
  "talkTargeting": {
    "enabled": false,
    "key": "F10",
    "talkHoldMs": 220,
    "cycleWindowMs": 1500,
    "selectionTimeoutMs": 8000,
    "radiusMeters": 15,
    "retentionRadiusMeters": 20,
    "maxCandidates": 8,
    "indicator": true
  }
}
~~~

Validation:

- key must be a valid router key
- key must not duplicate any input.keys value
- if the key later equals Essential Talk/Text/Mark/MarkedTalk, UX4 suspends at runtime and stops any UX4-owned microphone generation; the JSON file itself stays valid
- talkHoldMs 120–500
- cycleWindowMs 500–3000
- selectionTimeoutMs 2000–30000
- radiusMeters 3–30
- retentionRadiusMeters >= radiusMeters and <= 50
- maxCandidates 1–16

Settings hot reload clears pending selection input and sends `talk.ptt_stop` for any UX4-owned microphone generation before applying the new configuration. UX4 never synthesizes TalkKey.

## 14. Steam Input migration

When UX4 is enabled:

- recommended: leave the physical controller Talk button mapped exactly as it already is and set `talkTargeting.key` to the same key as Essential's `TalkKey`
- shared-input mode acquires an independent suppression lease so Essential does not also run generic Talk from that physical press
- a neutral key such as F10 remains supported if a separate binding is preferred
- leave Essential's LosSantosAlive.config TalkKey unchanged
- after the hold threshold, UX4 calls `SetPlayerConversationPed(selectedPed)` and `InputController.SendMicStart(selectedPed)` on Core.Update; it does not synthesize TalkKey

When UX4 is disabled, shared Talk interception releases automatically. In the recommended shared-key configuration no Steam Input remap is required; stock Essential Talk resumes after the physical key is released.

## 15. Gates and cancellation

Reuse InputGates.

Selection/talk must not begin while:

- GTA lacks focus
- RPH console is open
- game paused
- LSA/RNUI menu owns input
- Essential text input/F7 menu is open
- loading
- cutscene
- player switch
- other existing scripted gates close input

If a gate closes during Talking, send `talk.ptt_stop` for the UX4-owned generation immediately.

If the target dies/despawns/changes memory address during PendingHold, fail with target_lost and do not start PTT.

If it disappears during Talking, call `InputController.SendMicStop()` for that UX4 generation only and clear the UX4 selection. Do not stop an unrelated stock or MarkedTalk turn.

## 16. Telemetry

Add bounded status lines only:

- [UX4] talk_target selected index=N count=N reason=first|cycle
- [UX4] talk_target cleared reason=expired|lost|world_reset|settings|manual
- [UX4] talk_ptt commit=accepted|rejected reason=<code>
- [UX4] talk_ptt begin latencyMs=<rounded>
- [UX4] talk_ptt end reason=release|gate|focus|target_lost|shutdown
- [UX4] talk_indicator state=ready|unavailable reason=<code>

Do not log profile names, memory text, prompts, audio, Ped memory addresses or raw controller histories.

## 17. Failure model

UX4 is optional and fails closed.

- selector unavailable -> no selected target, no synthetic PTT
- native bridge unavailable -> show AI/native unavailable; do not guess a target
- indicator failure -> targeting may continue but HUD reports indicator unavailable
- companion offline -> native targeting still works; promoted display name may be unavailable
- settings invalid -> retain prior valid settings
- T0 targeting seam not proven -> do not ship the PTT override

Ordinary Essential behavior remains available by disabling UX4 and restoring the controller's direct Talk mapping.

## 18. Non-goals

UX4 does not:

- implement proximity chat
- choose who overhears speech
- create NPC attention/gaze behavior beyond an optional proven ActivateAttention call
- persist a selected ped across reloads
- infer durable character identity
- change microphone/STT/provider/TTS lifecycle
- create a second conversation manager
- create a second ped task scheduler
- patch Essential unless the proven public direct-mic seam later fails a specific source-pinned live acceptance case

## 19. Implementation-ready decision

T0A is complete from the exact pinned DLL. The implementation path is now:

~~~text
preview/cycle target with no conversation mutation
  -> exact target revalidation at hold commit
  -> SetPlayerConversationPed(selectedPed)
  -> InputController.SendMicStart(selectedPed)
  -> stock mic lifecycle
  -> InputController.SendMicStop() on matching release
~~~

Do not synthesize stock TalkKey.

The remaining uncertainty is ordinary GTA acceptance of that public direct-mic seam from the P2 Core.Update context, not target-selection architecture. No Essential source patch, provider change, memory change, perception-knowledge change or action-architecture change is currently required.
