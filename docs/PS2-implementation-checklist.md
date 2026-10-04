# PS2 Implementation Checklist

Implementation branch: `feature/ps2-witness-rules-episode-correlation`
Base: latest fetched `origin/main` at `b45f682` (2026-10-04).
Specification: `origin/research/ps2-proximity-chat-speech-plan`, commit `e1d0bd1`.

## Plan reconciliation

- [x] Fetch latest `main` and create a dedicated implementation branch from it.
- [x] Fetch and inspect the named PS2 research plan branch.
- [x] Map proposed PS2 files/interfaces to the actual PS0/PS1/P2 code in the latest-main tree.
- [x] Prove or reject the existing mic begin/end to capture UUID/native-time linkage; keep speech hearing disabled if unproven and record a focused probe.

### Reconciled interfaces on latest `main`

| Plan proposal | Current main equivalent / finding |
| --- | --- |
| `native/intelligence/WitnessPolicy.cs` | New native module; current production seams are `SensorAdapters.cs`, `EntityAnchors.cs`, and the bounded `IntelligenceIntegration.Update` in `IntelligenceIntegration.cs`. |
| `src/perception/speechContract.mjs` | `lsa-essential-e1-candidate/src/perception/contracts.mjs` owns the closed frame/observation validators. |
| `src/perception/episodeCorrelator.mjs` | No correlator exists. `episodeStore.mjs` only validates/stores immutable episodes; `shadowRuntime.mjs` ingests raw PS0 signals but does not correlate or create observations. |
| `observationStore.mjs` | Existing immutable observation storage and revision limit; no witness production/projection is wired to it. |
| Speech event/transcript store | No existing PS2 speech modules. Existing STT is in `openai/runSequentialTurn.mjs`; microphone PCM capture is private state in `openai/openaiConnection.mjs`; the current path emits `input_transcript` after STT and currency checks, then commits ordinary player history once. |
| Native mic lifecycle | `BeginMicTurn`/player-mic hooks establish control/turn lifecycle. `openaiConnection.startRealtimeInput/endRealtimeInput` establish companion PCM capture. No current interface carries a shared utterance UUID and matched native begin/end game ticks/observer receipts across those sides. Thus source-time player speech cannot be enabled safely from current code. |
| Candidate hooks/build | `tools/buildCandidate.mjs`, `patches/essential-hooks.json`, `src/integration/essentialGlue.mjs`, and `src/openai/runSequentialTurn.mjs` are the actual hook/config points; no proposed PS2 hook or receipt exists. |
| PS0/P1/P2 authority/lifecycle | Native P2 host is `native/promoted-characters`; PS0 pipe is output-only `LSA.Intelligence.v1`; P1 identity facts and P2 control channels are separate. Existing dialogue goes through `runSequentialTurn.mjs` and `openaiConnection.mjs` with validated native turn/action/playback ownership. |

**Mic linkage finding:** unsupported/unknown. The inspected code proves only local monotonic capture start/stop metrics, PCM collection, post-STT `input_transcript`, and P0/P1 turn hydration. It does not prove a source-time native tick, capture UUID shared with native receipt, or observer receipt during the interval. The implementation must therefore leave the speech witness producer explicitly unavailable and report a bounded diagnostic reason; no post-STT nearby roster can substitute for source-time evidence.

**Focused follow-up probe:** instrument a uniquely keyed PTT capture at native begin/end and companion PCM start/end; record matching UUID, adapter epoch, native game ticks, monotonic times, cancellation/empty/overflow paths, delayed STT, reconnect, player switch and anchor retirement. In GTA, move ordinary/promoted listeners into/out of range and across wall/interior/vehicle boundaries while capture is open. Enable speech only after exact begin/end UUID/tick pairing and source-time observer receipt timing survive cancellation, delayed STT, reconnect and replacement-lifetime cases.

## Implementation

- [x] Implement bounded witness policy and visual/auditory/report evidence using existing native anchors and source snapshot seams.
- [x] Implement episode correlation, immutable observer revisions, continuation bounds, and replay/idempotence.
- [x] Implement speech transcript reference/observer perception contracts and accepted-input integration, gated by native source-time receipt support.
- [x] Support ordinary and promoted NPC observers without promotion, fabricated sessions, or stale identity inheritance.
- [x] Preserve existing Essential turn/action/playback lifecycle; add no responder selection, reasoning/TTS calls, turns, sessions, or playback dispatches.
- [x] Document unsupported seams, diagnostics, rollout gates, and follow-up probe.

## Verification

- [x] Run targeted PS2 companion tests and native harnesses: witness rules (2), speech (3), contracts (22), lifecycle (54); native intelligence unit harness (76 assertions), native integration harness (41 assertions), and production Node/.NET factual-pipe interop (1).
- [x] Run PS0/PS1/P2 regression tests and native harnesses: full companion suite below; Session Identity offline (19) and facts pipe (9); P2 offline safety (33), control pipe (13), runtime (29), PS host lifecycle (10), recovery lifecycle (58), and host/command lifecycle (25). The host test and its Bootstrap project restore the official .NET Framework 4.8.1 reference assemblies through NuGet when the machine targeting pack is absent; no game assemblies execute.
- [x] Run the full companion suite: `node tools/runTests.mjs` — 345 passed, 0 failed.
- [x] Review the final diff and commit the completed work on this branch (`a6a03e4`).

The default interop helper path targets `net481`; on this host the passing pipe interop command supplied `native/intelligence/tests/bin/Debug/net48/IntelligenceTests.exe` explicitly. Physical GTA acceptance remains pending and is outside offline harness coverage.


## Corrective review

A post-implementation review found and corrected three contract-level gaps:

- sampled `injury_state` now maps into PS2 injury observations instead of being rejected as unsupported;
- `reported` witness receipts are admitted by the correlator, and the closed witness/claim contracts preserve a UUID `reportRef` only for `dialogue_report` evidence;
- damage, sampled injury and death now share a victim-scoped `harm` continuation key, while episode participant revisions union prior/new participants so an earlier attacker is not lost. A later death claim remains source-less unless that death signal itself carries supported source evidence; episode continuity does not manufacture causality.

Regression cases were added for sampled injury → damage → death continuity, participant preservation, death-without-source causality, report-contract admission and hearsay preservation. The previously recorded 345-test/full-native-suite result predates this corrective commit; repository CI is not configured on this branch, so the complete suite should be re-run before merge in the normal development environment.
