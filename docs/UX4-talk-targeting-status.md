# UX4 Talk Target Selector — implementation status

Status: **reconciled onto current `main` / fresh regression-build required / GTA-pending**. Not merged. Post-review mic ownership, native gate revalidation, stop-retry, and conversation-partner ownership fixes are included; GTA acceptance has not been run.

Branch: `feature/ux4-talk-target-selector`

Implementation base after October 5 reconciliation: `main@5558da7398e5ea8b78e97758aadee64f9e28f6bb` (corrected PS3 + runtime observability follow-ups). Original UX4 implementation base was `8c63b20492fbf6bc2e1ba98acc598259c22a57fe`.

Research head used: `2ddb8ae059abb364edb551518e31f86bf32a7249` (docs only; `main` had moved past that base).

## October 5 reconciliation onto current main

UX4 was reconciled onto `main@5558da7398e5ea8b78e97758aadee64f9e28f6bb` after the PS3 runtime-observability follow-ups landed.

- Current main remains authoritative for PS3 salience, JSONL telemetry, retained-history behavior, damage-callback diagnostics, and the current test runner.
- UX4 contributes only its intended talk-target/runtime/UI/test/documentation files.
- The only path changed by both main and UX4 since their merge base was `native/promoted-characters/runtime-tests/RuntimeTests.csproj`; both sides already contain the same Essential input-interception compile include, so no semantic conflict remained.
- No ACT0/ACT1, ACT2, radio, CGE, PS4+, or Scene Director runtime code was introduced.
- This reconciliation does **not** constitute a fresh build, CI result, deployment, or GTA acceptance. Run the full current-main regression/build matrix before deployment.

## What was implemented

The physical Talk control, mapped in Steam Input to `talkTargeting.key`, now does this while the feature is enabled:

- a tap shorter than `talkHoldMs` selects the best nearby NPC, or cycles a frozen list
- a hold commits that NPC and starts Essential's stock microphone with `NpcTargeting.SetPlayerConversationPed(selectedPed)` then `InputController.SendMicStart(selectedPed)`
- release, focus loss, the LSA menu, a closed input gate, settings reload, target loss, world reset, or shutdown sends `talk.ptt_stop` for that UX4 generation only
- `InputController.SendMicStop()` runs only when that generation actually called `SendMicStart`
- while the selection is valid, Follow, Wait, Promote, capture, and the Current NPC page use it ahead of `PlayerConversationPed` and `CurrentSpeakerPed`

New runtime pieces:

- `native/promoted-characters/TalkTargetSelector.cs`
- `native/promoted-characters/TalkTargetIndicator.cs`
- `native/promoted-characters/TalkTargetPolicy.cs`
- `native/promoted-characters/TalkTargetGeometry.cs`
- `native/promoted-characters/TalkPttSession.cs`
- `native/enhanced/Input/TalkTargetInput.cs`

The local bridge gained `talk.select_first`, `talk.select_next`, `talk.ptt_start`, `talk.ptt_stop`, `talk.clear`, and `talk.inspect` from source `talk_input`. There is no second IPC transport and no `EssentialHeldKeyRelay`.

The highlight is a screen-space bracket around the projected head bone, plus a `2/3` label. It is cached on Core's Update and drawn from RPH `Game.FrameRender`. No line of sight is required.

`talkTargeting` is off unless `Plugins/LSA.Enhanced.json` enables it. See [controller setup](controller-setup.md).

## Deviations from the research plan

- T0A stands. UX4 does not synthesize Essential's `TalkKey`. Stock normal Talk still runs `GetBestConversationPed` and would overwrite an explicit target. The research notes that still said "synthesize TalkKey" were corrected.
- `SetPlayerConversationPed` runs only at committed PTT start. Preview and cycling do not call it, and they do not call `ActivateAttention`. Current-NPC precedence is the UX4 selection while it is valid, then the existing conversation ped, then the current speaker.
- Stock Text input is unchanged. It still chooses its own best ped. UX4 does not claim to control Text.
- Candidate limits travel inside each talk command because the settings file lives in the loader AppDomain. The native side rechecks the same bounds.
- A hold with no current selection asks the native side to choose the best ped and commit that same ped. A hold while a selection is still valid commits that selection.
- If `talk.ptt_stop` is processed before `talk.ptt_start` for the same generation, the start is cancelled and `SendMicStart` is not called. If start runs first, the queued stop closes it once.
- UX4 source-resolves Essential's active microphone Ped from the hash-pinned `SendMicStop()` IL. A UX4 stop calls `SendMicStop()` only while that exact Ped is still active. If stock Talk/MarkedTalk replaced it, UX4 releases its own generation without stopping the newer stock mic.
- Native `talk.ptt_start` rechecks Essential text/F7 gates plus loading, cutscene, player switch, mission, and online/scripted state immediately before the side-effecting mic start.
- Physical stop failure no longer clears UX4 generation ownership. The same generation remains retryable, and the loader will not begin a new hold while a prior stop is unresolved.
- After a successfully committed PTT turn, release stops only the UX4-owned microphone generation. UX4 no longer clears `NpcTargeting.PlayerConversationPed`; Essential owns the committed conversation-partner lifetime through the reply/next committed input. Failed or cancelled starts still roll back the provisional partner.
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

**Convergence follow-up:** the later conversation-partner ownership change (successful PTT release no longer clears `PlayerConversationPed`) was pushed after that Actions run. The prior counts remain evidence for the earlier hardened head, but the updated branch still requires a fresh offline/CI rerun before merge.

## GTA tests still required

Use [UX4-talk-targeting-gta-acceptance.md](UX4-talk-targeting-gta-acceptance.md). Offline tests do not show that the microphone turn reached the highlighted NPC. In GTA, still verify:

- the exact selected NPC receives `SendMicStart`, including when a nearer NPC is present
- driver, front passenger, and rear passenger can be highlighted and addressed
- the bracket stays understandable inside a vehicle and matches the NPC who receives the turn
- a tap never opens the microphone
- hold-to-mic latency is acceptable (`talkHoldMs` stays 220 until measured)
- release during the native start, focus loss, and target loss leave no open UX4 microphone turn
- after a successful release, `PlayerConversationPed` remains the addressed NPC through its reply and F11/P2 Current NPC/CGE-style readers do not lose or redirect the partner
- a UX4 stop does not cut off an unrelated stock Talk or MarkedTalk turn
- Follow and the Current NPC page use the highlighted NPC
- disabling `talkTargeting` and restoring the controller's direct Talk mapping returns the old behavior

## Rollback

Set `"talkTargeting": { "enabled": false }` in `Plugins/LSA.Enhanced.json`, or delete that section. Map the physical Talk button back to Essential's Talk key. `LosSantosAlive.config` is not modified. Details are in [controller setup](controller-setup.md).
