# UX4 T0 targeting audit — exact Essential mic seam

> **Implementation follow-up:** this audit's direct `SendMicStart(Ped)` seam is now implemented in merged UX4. Shared Essential Talk-key interception has live GTA evidence; current main further splits normal direct Talk from tap/cycle explicit selection. See `../UX4-talk-targeting-status.md`.

Date: October 4, 2026

Status: **T0A complete from the exact checked-in Essential DLL.**

GitHub Actions run: `37238684178`
Audit workflow commit: `25bf7364ce02ddee012080faf9134c9cf39f760e`
Pinned DLL: `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll`
Verified SHA-256: `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`

The research workflow decompiled that DLL with ILSpy and extracted all references to the targeting and microphone methods.

## Executive conclusion

The original T0 assumption was wrong but unnecessary.

A preselected `PlayerConversationPed` is **not** authoritative when the player subsequently presses stock Talk. Stock normal Talk performs fresh target acquisition:

~~~text
Talk input
  -> NpcTargeting.GetBestConversationPed(...)
  -> NpcTargeting.SetPlayerConversationPed(bestConversationPed)
  -> stock mic core(bestConversationPed, Talk)
~~~

Therefore UX4 must not synthesize stock TalkKey after preselection.

The DLL exposes a stronger public seam:

~~~text
NpcTargeting.SetPlayerConversationPed(selectedPed)
InputController.SendMicStart(selectedPed)
...
InputController.SendMicStop()
~~~

## Proven details

### Normal Talk

The decompiled normal-talk handler gets `GetBestConversationPed(excludedPed)`, validates it, calls `SetPlayerConversationPed(bestConversationPed)`, then enters the private mic core with that same Ped.

### Marked Talk

The marked-talk handler uses its stored marked Ped, calls `SetPlayerConversationPed(markedPed)`, then enters the same mic core.

### Direct mic start

Public `InputController.SendMicStart(Ped)` calls that same private mic core with the caller-supplied Ped.

The mic core:

- validates the supplied Ped;
- stores it as the active mic Ped;
- passes it to `GeminiBridgeClient.SetCurrentBridgeAudioSpeaker`;
- passes it to `ConversationHydrationCoordinator.BeginMicTurn`;
- passes it to `ConversationLookBehavior.StartPlayerMicLook`.

It does not call `GetBestConversationPed` or `GetPlayerConversationPed`.

### Hydration

`ConversationHydrationCoordinator.BeginMicTurn(Ped)` operates on the supplied Ped and contains no call to `GetBestConversationPed`, `GetPlayerConversationPed` or `GetCurrentSpeakerPed`.

### Release

`InputController.SendMicStop()` reads the Ped stored by the mic core and performs the stock release path, including `ConversationHydrationCoordinator.MarkMicReleased(activePed)`.

### SetPlayerConversationPed side effects

The setter is not preview-only. Its decompiled body also registers player interaction context, detaches a conflicting directed interaction, queues conversation warmup and sets NPC focus toward the player. `ActivateAttention(Ped)` simply calls the setter.

Therefore selection/cycling must remain side-effect-free; call `SetPlayerConversationPed` only at committed PTT start.

### Text input

`TextInputService.StartTextInputMode` independently runs `GetBestConversationPed()`, sets that Ped, then calls `InputController.SendTextPrompt(bestConversationPed, text)`. Stock TextKey is therefore not automatically tied to UX4 selection.

## Revised implementation contract

At committed start on Core.Update:

~~~csharp
var ped = talkTargets.SelectedPedIfValid(...);
RevalidateExactLifetime(ped, expectedSelectionId, expectedEncounterId);
NpcTargeting.SetPlayerConversationPed(ped);
InputController.SendMicStart(ped);
~~~

At matching UX4 release/cancellation:

~~~csharp
InputController.SendMicStop();
~~~

Track a bounded UX4 PTT generation so late start/stop races cannot affect another turn.

## Remaining GTA evidence

GTA is still required for acceptance, not for deciding the architecture:

- invoke public `SendMicStart(Ped)` from the actual P2 Core.Update path;
- verify driver/passenger targets;
- measure input-to-mic latency;
- verify release/focus-loss/target-loss races;
- verify coexistence with stock MarkedTalk/runtime gates.

No Essential source patch is justified by current evidence.
