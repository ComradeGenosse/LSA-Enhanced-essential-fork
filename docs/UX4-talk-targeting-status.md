# UX4 Talk Target Selector — implementation status

Status: **merged to `main` on October 5, 2026.** Shared Essential-Talk interception and the original UX4 PTT path were exercised successfully in GTA. The later direct-talk/explicit-selector refinement is also on `main` and still needs a fresh GTA acceptance pass.

Historical implementation branches: `feature/ux4-talk-target-selector` and `fix/ux4-direct-talk-explicit-selector`. They are reference/history now; current `main` is authoritative.

The live pre-refinement run is recorded in [ux4-ps3-run-analysis-20261005.md](ux4-ps3-run-analysis-20261005.md). It proved three clean shared-Mouse4 turns with no duplicate stock Talk, 268–284 ms hold-to-start latency, clean releases/stops, and working PS3 telemetry. It did not exercise multi-target cycling or the later direct-talk/no-bracket UX.

Research head used: `2ddb8ae059abb364edb551518e31f86bf32a7249` (docs only; `main` had moved past that base).

## October 5 merge and reconciliation history

UX4 was reconciled onto `main@5558da7398e5ea8b78e97758aadee64f9e28f6bb` after the PS3 runtime-observability follow-ups landed.

- Current main remains authoritative for PS3 salience, JSONL telemetry, retained-history behavior, damage-callback diagnostics, and the current test runner.
- UX4 contributes only its intended talk-target/runtime/UI/test/documentation files.
- The only path changed by both main and UX4 since their merge base was `native/promoted-characters/runtime-tests/RuntimeTests.csproj`; both sides already contain the same Essential input-interception compile include, so no semantic conflict remained.
- No ACT0/ACT1, ACT2, radio, CGE, PS4+, or Scene Director runtime code was introduced.
- That reconciliation was followed by shared-Talk interception, a live GTA run, and the direct-talk/explicit-selector refinement. The historical branch CI/build counts below remain evidence for their respective checkpoints; they are not a fresh CI certificate for today's `main`.

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

## Committed-recipient feedback (source change, October 16, 2026)

**Status: source implemented and offline-tested; not built into a DLL, deployed, or GTA-validated.** Plan: `docs/plans/memory-k-npc-speech-ledger-and-ux4-target-feedback-20261016.md` section 3 (draft PR #188). This is feedback only: it does not change who receives a turn, lock a character, or add proximity listening.

Why: a direct hold can legitimately pick an ambient NPC standing in front of a promoted character, and nothing on screen said so. The NPC may even share the promoted character's voice, which is not identity evidence.

Behavior (UX4-controlled **mic** turns only; stock Text and stock Talk with UX4 off are unchanged):

| Moment | HUD |
| --- | --- |
| Native `talk.ptt_start` committed on a ped with verified current promoted ownership | `Talking to: Promoted NPC` |
| Committed on a valid ped with no ownership | `Talking to: Nearby NPC` |
| Ownership cannot be proven or contradicts itself | `Talking to: NPC (identity unavailable)` |
| Tap / cycle preview, when the same evidence is available | `Target 2/3 - Promoted NPC` or `... - Nearby NPC`; an unverified preview keeps plain `Target 2/3` |

- The notice comes from the native commit result for the exact committed ped (after mic ownership is confirmed), never from button-down, request acceptance, a preview, a previous selection, the voice or a name.
- No notice for a rejected, cancelled, target-lost, target-changed, ownership-lost, failed, or already-released start. One notice per committed generation; later ticks do not repeat it.
- `PromotedCharactersIntegration.ResolveTalkRecipient` is read-only: it uses the P2 encounter roster and P1 `TryResolveCurrent` proof that `PerceptionRoster` already relies on. It creates no encounter, registration or character, retires no anchor, and does no SQLite/HTTP/pipe I/O. `Promoted` requires: P2 ready, ped exists/alive/not the player, retained native address unchanged, matching encounter handle/address, a registration, and a current P1 claim with the same incarnation. A registration whose proof is stale is `Unknown`, never `Ambient`; an owner claim with no roster registration is also `Unknown`. Only a valid ped with neither is `Ambient`.
- `talk.ptt_start` and the select commands gained `recipientKind` (`promoted`/`ambient`/`unknown`) and a bounded `recipientEvidence` code. The loader matches `recipientKind` against that allowlist, builds the fixed generic label itself, and logs `[UX4] talk_ptt recipient kind=... evidence=...` only when the evidence is a short lowercase code. An absent field (older native) shows nothing; an unrecognized value shows the generic unknown notice.
- No alias, CharacterId, address, profile text or name is sent to the HUD or normal logs. The `talk.inspect`/snapshot path does not carry the class.
- **Named characters** are a separate, display-only upgrade of the `Promoted` row (source change, October 16, 2026; same build/GTA status as above). The native roster still has only owner aliases, so the name comes from the companion's existing `current_describe` action (the same lookup the F11 Current NPC page uses):
  1. Native adds the P1-verified `claim.sourceKey` to the commit result as `recipientAlias`, on `promoted` results only (shape-checked; never on `ambient`/`unknown`). It is a lookup key for the loader; it is never displayed or logged.
  2. The loader asks the companion for that exact `(encounterId, ownerAlias)` after the mic is already committed. The generic `Talking to: Promoted NPC` notice waits up to 400 ms for the answer, so the normal case shows one line: `Talking to: Nathan`. If the companion is slow it shows the generic label, and a verified name may still replace it within 3 s.
  3. A name is shown only if the companion answers `kind: promoted` with a CharacterId, the alias maps to **exactly one** profile (two claimants of one alias return no name), the name matches a conservative display set (letters, digits, space, `. ' _ -`, 40 chars; GTA `~` codes, control characters and markup never pass), the conversation is still the same talking generation, and a one-time fresh native `current.inspect` rechecks current P1 ownership for the same ped, encounter and alias after the name reply; cached HUD snapshots cannot authorize names.
  4. Anything else keeps the existing labels: `Promoted NPC` (alias missing, companion unreachable/erroring, unknown/ambiguous/unnamed profile, snapshot disagrees), `Nearby NPC` and `NPC (identity unavailable)`. Ambient and unknown recipients never trigger a lookup.
  5. Release, `Clear`, shutdown, settings change, a new hold or a changed target discard any pending lookup, so a late answer never names a conversation that ended or a different NPC. Previews (`Target n/m - ...`) are unchanged and stay generic.
  6. Normal logs carry only `[UX4] talk_ptt recipient_name outcome=shown|unavailable|unconfirmed`; no name, alias or CharacterId. The name never reaches targeting, mic, memory or dialogue routing: it is read-only HUD text.
- A direct hold may still choose the ambient NPC. The notice makes that visible; it does not lock Nathan.

Offline coverage added: loader HUD/log/allowlist/edge cases (`input-tests`), resolver cases and selector fault-degradation (`lifecycle-tests`), and preview/direct/explicit payload classification through the real command bridge (`bridge-tests`). These sources were written without a local .NET toolchain; Windows CI is the compile and run gate.

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

**Current-main note:** later conversation-partner ownership, shared Essential-Talk interception, and direct-talk/explicit-selector changes landed after that Actions run. The prior counts remain historical evidence; a fresh current-main regression is still desirable before calling the latest UX4 surface fully certified.

## Live GTA evidence already established

The October 5 shared-Talk/PS3 run established:

- Harmony Talk interception installed successfully and reported `mode=shared_essential`.
- Three UX4 microphone generations started and stopped cleanly.
- Hold-to-start latency was 268–284 ms.
- No duplicate stock generic-Talk capture occurred beside the UX4 turns.
- Tap-only selection events did not open the microphone.
- All three replies completed playback/history successfully.

That run had only one candidate at a time, so it did **not** validate cycling, farther-target selection, vehicle occupants, or the later direct-talk/explicit-selector refinement.

## GTA tests still required

Use [UX4-talk-targeting-gta-acceptance.md](UX4-talk-targeting-gta-acceptance.md). Offline tests do not show that the microphone turn reached the highlighted NPC. In GTA, still verify:

- the exact selected NPC receives `SendMicStart`, including when a nearer NPC is present
- driver, front passenger, and rear passenger can be highlighted and addressed
- direct hold shows no bracket; tap/cycle shows the bracket briefly, including inside a vehicle, and the highlighted NPC matches the one who receives an explicit-target turn
- a tap never opens the microphone
- hold-to-mic latency is acceptable (`talkHoldMs` stays 220 until measured)
- release during the native start, focus loss, and target loss leave no open UX4 microphone turn
- after a successful release, `PlayerConversationPed` remains the addressed NPC through its reply and F11/P2 Current NPC/CGE-style readers do not lose or redirect the partner
- a UX4 stop does not cut off an unrelated stock Talk or MarkedTalk turn
- Follow and the Current NPC page use the highlighted NPC
- disabling `talkTargeting` releases shared Talk interception and returns the existing controller button to stock Essential Talk after physical release

## Rollback

Set `"talkTargeting": { "enabled": false }` in `Plugins/LSA.Enhanced.json`, or delete that section. In the recommended shared-key setup no Steam remap is needed: interception releases and the same button returns to stock Essential Talk after physical release. Only neutral-key setups need their old Steam mapping restored. `LosSantosAlive.config` is never modified. Details are in [controller setup](controller-setup.md).
