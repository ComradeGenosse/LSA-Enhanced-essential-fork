# UX4 Talk Target Selector — implementation status

Updated October 5, 2026.

**Status: ✅ merged to `main@d7d8311`.** The shared Essential-Talk-key path was exercised in GTA on the preceding `c8df99b` payload: three ordinary microphone turns started/stopped cleanly, all replies completed, and no duplicate stock generic Talk turn was observed. The later direct-Talk/explicit-selector refinement is also on `main`, but that exact head still needs a fresh full build/regression and GTA acceptance pass.

Historical implementation branch: `feature/ux4-talk-target-selector@28b3ac8` (now 9 commits behind `main`). The refinement branch `fix/ux4-direct-talk-explicit-selector@d7d8311` is identical to current `main`.

Current design:

- normal hold: direct Talk, no selector bracket, temporary hidden target only for that PTT;
- tap: enter explicit selector mode;
- repeated tap: cycle the frozen nearby list;
- explicit bracket previews for about 1 second, while the target remains valid for the configured selection timeout;
- hold with an explicit target: commit that exact Ped;
- shared Essential `TalkKey` mode uses the existing Harmony interception without changing the user's Steam Controller binding;
- Essential still owns microphone, conversation, action and playback lifecycle.

The original T0A audit and implementation-plan branches are historical design inputs. They are not the current deployment status.

## Live evidence on the pre-refinement shared-key build

See [ux4-ps3-run-analysis-20261005.md](ux4-ps3-run-analysis-20261005.md). That run verified:

- `[UX4] talk_target input=ready key=Mouse4 mode=shared_essential`;
- three accepted UX4 PTT generations;
- 268–284 ms hold-to-start latency;
- native stop 27–34 ms after loader release;
- exactly three server captures / authorization accepts / playback starts / playback completions;
- no duplicate generic Talk turn;
- selection-only taps did not open the microphone.

It did **not** validate the later direct/no-bracket interaction split, multi-target cycling, vehicle occupants, all interruption races, or exact highlighted-target identity. Those remain GTA acceptance items.

## What was implemented

The physical Talk control, mapped in Steam Input to `talkTargeting.key`, now has two modes:

- **hold without a prior tap** = direct Talk. UX4 chooses the best current candidate for that PTT only, starts Essential's stock microphone, and shows **no selector bracket**
- **tap** = enter explicit targeting mode and show the selector bracket
- **tap again** = cycle the frozen nearby candidate list
- **hold while an explicit target is still valid** = talk to that exact selected NPC
- the explicit bracket previews for about 1 second and is hidden as soon as PTT starts; the explicit target itself remains usable for the normal selection timeout
- release, focus loss, the LSA menu, a closed input gate, settings reload, target loss, world reset, or shutdown sends `talk.ptt_stop` for that UX4 generation only
- `InputController.SendMicStop()` runs only when that generation actually called `SendMicStart`
- while an explicit selection is valid, Follow, Wait, Promote, capture, and the Current NPC page use it ahead of `PlayerConversationPed` and `CurrentSpeakerPed`

New runtime pieces:

- `native/promoted-characters/TalkTargetSelector.cs`
- `native/promoted-characters/TalkTargetIndicator.cs`
- `native/promoted-characters/TalkTargetPolicy.cs`
- `native/promoted-characters/TalkTargetGeometry.cs`
- `native/promoted-characters/TalkPttSession.cs`
- `native/enhanced/Input/TalkTargetInput.cs`

The local bridge gained `talk.select_first`, `talk.select_next`, `talk.ptt_start`, `talk.ptt_stop`, `talk.clear`, and `talk.inspect` from source `talk_input`. There is no second IPC transport and no `EssentialHeldKeyRelay`.

The highlight is a screen-space bracket around the projected head bone, plus a `2/3` label. It is cached on Core's Update and drawn from RPH `Game.FrameRender`. No line of sight is required.

`talkTargeting` is off unless `Plugins/LSA.Enhanced.json` enables it. It can use a neutral key or share Essential's configured `TalkKey` without changing the controller binding. See [controller setup](controller-setup.md).

## Deviations from the research plan

- T0A stands. UX4 does not synthesize Essential's `TalkKey`. Stock normal Talk still runs `GetBestConversationPed` and would overwrite an explicit target. The research notes that still said "synthesize TalkKey" were corrected.
- `SetPlayerConversationPed` runs only at committed PTT start. Preview and cycling do not call it, and they do not call `ActivateAttention`. Current-NPC precedence is the UX4 selection while it is valid, then the existing conversation ped, then the current speaker.
- Stock Text input is unchanged. It still chooses its own best ped. UX4 does not claim to control Text.
- Candidate limits travel inside each talk command because the settings file lives in the loader AppDomain. The native side rechecks the same bounds.
- A hold with no explicit tap selection uses a temporary hidden native target for that PTT only. It is discarded on release and never becomes persistent selector state. A hold while an explicit tap selection is still valid commits that exact selection.
- If `talk.ptt_stop` is processed before `talk.ptt_start` for the same generation, the start is cancelled and `SendMicStart` is not called. If start runs first, the queued stop closes it once.
- UX4 source-resolves Essential's active microphone Ped from the hash-pinned `SendMicStop()` IL. A UX4 stop calls `SendMicStop()` only while that exact Ped is still active. If stock Talk/MarkedTalk replaced it, UX4 releases its own generation without stopping the newer stock mic.
- Native `talk.ptt_start` rechecks Essential text/F7 gates plus loading, cutscene, player switch, mission, and online/scripted state immediately before the side-effecting mic start.
- Physical stop failure no longer clears UX4 generation ownership. The same generation remains retryable, and the loader will not begin a new hold while a prior stop is unresolved.
- After a successfully committed PTT turn, release stops only the UX4-owned microphone generation. UX4 no longer clears `NpcTargeting.PlayerConversationPed`; Essential owns the committed conversation-partner lifetime through the reply/next committed input. Failed or cancelled starts still roll back the provisional partner.
- UX4 may now intentionally share Essential's existing `TalkKey`. A separate Talk interception lease suppresses only Essential's duplicate physical Talk polling while UX4 reads the same real key. Router Mark/Text leases and UX4 Talk leases are independent, and disabling/stopping UX4 drains a held key before restoring stock Talk. `MarkedPedTalkKey` is never intercepted.
- The runtime test project now compiles the existing Essential input-interception sources with `RuntimeEntry`. Those calls were already on `main`; the test project did not include the files, so it did not build.

## Offline results

| Suite | Result |
| --- | --- |
| UX input, settings, dispatch, view models | 531 assertions passed |
| P2 command bridge, including UX4 | 403 assertions passed |
| P2 lifecycle / clock recovery | 58 assertions passed |
| P2 offline safety/admission | 39 assertions passed |
| P2 runtime admission/lifetime | 34 assertions passed |
| P2 host/command lifecycle | 30 assertions passed |
| P2 Windows control pipe | 16 assertions passed |
| PS host lifecycle | 10 assertions passed |
| Intelligence production source | 76 assertions passed |
| Intelligence integration | 41 assertions passed |
| Session identity offline | 19 passed |
| Session identity native facts | 9 passed |
| Companion `node tools/runTests.mjs` | 370 passed, 0 failed |
| `node tools/buildCharactersAddon.mjs` | succeeded, `deploymentPerformed: false`, `gtaRuntimeTest: false`, stage `P2+PS0+PS1+PS2+UX1+UX2+UX3+UX4`, `talkTargetingDefaultEnabled: false` |
| `node tools/buildCandidate.mjs` | succeeded, 48 source-pinned patches, status `candidate-built-offline-ps2-player-speech-gated-gta-pending`, bundle SHA-256 `7b4d461fe14976cd454be4babc0d84c1b350d4753ff378e681e819a02a934cde` |

Packaged addon hashes from the final characters build:

- `LSA.PromotedCharacters.dll` `84415da0baee8d54e8336035cee95480be8ff7ea8bd1995161706aa769fb8b06`
- `LSA.PromotedCharacters.Runtime.dll` `96c8c9f1e194ad55e61084d181568fbcc793614c414ee8c4fe2b084c67b80bd0`
- `LSA.PromotedCharacters.Bootstrap.dll` `f5354b05c9d826bc06a3ea3b1f51d33475d6742105b75e16a62cf10c8fd6ee4e`
- `LSA.SessionIdentity.dll` `017e4e842595360ccfb3162bcf216bdd2db5a921e1e232a69b9685777680c4a5`

RAGENativeUI is still compile-only and is not in the package.

## Post-review hardening verification

GitHub Actions run `37318850380` on Windows against the hardened branch passed:

- UX input/settings/dispatch/view models: **533 assertions passed**
- P2 bridge/runtime: **449 assertions passed**
- P2 lifecycle/reset: **58 assertions passed**

The added regressions cover native PTT gate revalidation, active-mic ownership loss to a newer stock/MarkedTalk mic, retry after a physical `SendMicStop()` failure, and refusing a new hold while the previous stop remains unresolved.

**Current-head note:** the historical Actions counts below validate earlier hardened UX4 heads. The conversation-partner ownership fix, shared-Talk lease work and direct-Talk/explicit-selector refinement landed afterward. Current `main@d7d8311` therefore still requires a fresh full offline/build run even though the feature is merged.

## GTA tests still required

Use [UX4-talk-targeting-gta-acceptance.md](UX4-talk-targeting-gta-acceptance.md). The shared-key/no-duplicate-Talk seam has live evidence, but the exact current-main interaction model still needs GTA verification. In particular:

- the exact selected NPC receives `SendMicStart`, including when a nearer NPC is present
- driver, front passenger, and rear passenger can be highlighted and addressed
- direct hold shows no bracket; tap/cycle shows the bracket briefly, including inside a vehicle, and the highlighted NPC matches the one who receives an explicit-target turn
- a tap never opens the microphone
- hold-to-mic latency is acceptable (`talkHoldMs` stays 220 until measured)
- release during the native start, focus loss, and target loss leave no open UX4 microphone turn
- after a successful release, `PlayerConversationPed` remains the addressed NPC through its reply and F11/P2 Current NPC/CGE-style readers do not lose or redirect the partner
- a UX4 stop does not cut off an unrelated stock Talk or MarkedTalk turn
- Follow and the Current NPC page use the highlighted NPC
- disabling `talkTargeting` and restoring the controller's direct Talk mapping returns the old behavior

## Rollback

Set `"talkTargeting": { "enabled": false }` in `Plugins/LSA.Enhanced.json`, or delete that section. Map the physical Talk button back to Essential's Talk key. `LosSantosAlive.config` is not modified. Details are in [controller setup](controller-setup.md).
