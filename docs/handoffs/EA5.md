# EA5 — Native protagonist proof: implementation handoff

**Agent:** A / EA5. **Starting SHA:** `4cad39198478d7f03bb8ec6657b674e52fa659dd` (PR #68). **Implemented code/test SHA before this handoff:** `5d69fad5afb1d5a795ff9199dea1727c3c8fd91b`. Branch: `feature/ea5-native-protagonist-authority-20261011`. Target: `integration/elevenlabs-emotional-acting-ea0-ea4-20261011` (PR #68). No deployment or game mutation.

## What is implemented

- `native/intelligence/NativeProtagonistSensor.cs`: game-fiber-only GTA-native reader using live `Game.LocalPlayer.Character` with nonzero live handle and memory address, `PLAYER_ID`, `PLAYER_PED_ID`, `GET_PLAYER_PED`, `IS_PLAYER_PLAYING`, `GET_ENTITY_MODEL`, post-model identity recheck, and cutscene/switch/network guards. Source failure, missing/foreign model, scripted transition, dead/invalid ped returns `unknown`. Only story player model hashes `player_one=0x9B22DBAF` (Franklin), `player_zero=0x0D7114C9` (Michael), `player_two=0x9B810FA2` (Trevor) qualify. No actor/name/dialogue inference.
- Revisioned native producer owned for the entire host run, preserving monotonic revisions through normal switches, ABA, loss of source, connection-version rotation and epoch changes. Invalid native input cannot renew prior protagonist. Emits ordered `protagonist_model` snapshots and 250 ms heartbeats on the existing bounded, user-ACL native intelligence pipe. Revision overflow fails closed. Never opens new IPC or sends native commands.
- `IntelligenceChannel.Connected`: read-only transport currency flag. `IntelligenceIntegration` samples only from `Update` on the existing owner fiber. It is deliberately **opt-in and defaults disabled** until the final integration agent updates the companion to accept the new event; current clients must not receive unknown frames.
- `lsa-essential-e1-candidate/src/perception/protagonistProtocol.mjs`: exact v1 payload schema and closed known/unknown enum. No arbitrary payload fields/actor metadata.
- `lsa-essential-e1-candidate/src/perception/protagonistAuthority.mjs`: `createProtagonistAuthority({getNativeStream,clock?,freshMs?})` with `readVerified()` (frozen known record or null), `isCurrent(record)` (same reference AND current authenticated stream/host/epoch/token/sequence and <=1500 ms freshness), `acceptAuthenticatedFrame(frame)` (trusted integration-only ingress), `revoke()`. Same-revision, higher-sequence heartbeats retain existing record; new revisions replace it. Unknown, replay, conflicting revisions, channel retirement and epoch replacement deny.

## Wire contract and required final-review integration

Native outer frame is the **existing** v1 `IntelligenceChannel` envelope:
```json
{"version":1,"type":"protagonist_model","adapterEpoch":"UUID","streamId":"UUID","sequence":1,"payload":{"version":1,"source":"native_player_model","protagonist":"franklin","hostRunId":"UUID","worldEpoch":1,"revision":2}}
```
`unknown` is legal **only on the wire**, never a `readVerified` record. The native hello retains its existing `hostRunId/worldEpoch/adapterEpoch/streamId`. Record shape is exactly `{version:1,source:'native_player_model',protagonist,hostRunId,worldEpoch,revision}`. Native sequence and stream ID come from the original authenticated channel, not this sensor.

1. In F-owned `intelligenceClient.mjs` and its ingestion contract, teach the native runtime to validate `protagonist_model` on its **same** accepted ordered pipe; unknown types must continue to fail closed. Call `acceptAuthenticatedFrame` only after that exact frame's native acceptance, never on incoming unvalidated JSON. No fake `authenticated:true` convenience path.
2. Supply `getNativeStream()` from the independently verified **live** socket/hello/runtime. Required snapshot: `{connected:true,authenticated:true,sessionToken:<unique non-reused reference per socket>,adapterEpoch,streamId,hostRunId,worldEpoch,lastSequence}`. Update `lastSequence` from the actual admitted outer frame **before** invoking EA5 ingress. The token and host/stream fields MUST NOT be derived from the current `protagonist_model` payload. Invalid frame, socket close, epoch change, source retirement or stream replacement must invoke `revoke()`/lose currency; timers alone cannot authenticate.
3. In native registration/bootstrap, explicitly enable the new optional `IntelligenceIntegration(..., protagonistEvidenceEnabled:true)` **only when the receiving runtime implements the event**. The optional parameter follows `directorAttemptsPerMinute`; existing positional calls retain default-off behavior. Avoid turning this on with older companions.
4. Feed the resulting instance to the **existing** `createMoodRuntime({getRuntime,protagonistAuthority})` and separately satisfy EA6's actual M1 confirmed SQLite timeline authority. EA5 does not mint save lineage or bypass P1/PS2 owner proof. On teardown/reload call `revoke()`; do not retain an authority across a new native host without the live native source.
5. Add EA5 Node test and native integration-test commands to EA9 Windows/Linux CI matrix. This agent intentionally did not modify EA9 workflows or F-owned shared runtime.

## Changed paths

- `native/intelligence/NativeProtagonistSensor.cs` (new)
- `native/intelligence/IntelligenceChannel.cs`
- `native/intelligence/IntelligenceIntegration.cs`
- `native/promoted-characters/PromotedCharacters.csproj`
- `native/intelligence/integration-tests/GameStub.cs`
- `native/intelligence/integration-tests/IntegrationTests.csproj`
- `native/intelligence/integration-tests/Program.cs`
- `native/intelligence/integration-tests/EA5TestCases.cs` (new)
- `lsa-essential-e1-candidate/src/perception/protagonistProtocol.mjs` (new)
- `lsa-essential-e1-candidate/src/perception/protagonistAuthority.mjs` (new)
- `lsa-essential-e1-candidate/tests/ea5-native-protagonist-authority.test.mjs` (new)
- `docs/handoffs/EA5.md` (this file)

## Tests and truthfulness

- **Executed locally:** `node --check` for **byte-identical Git-blob-verified** EA5 authority/protocol modules and `node --test /mnt/data/ea5-check/verify.test.mjs`: 4 suites, 4 passed (strict source contract, immutable identity, same-revision heartbeat, ABA, unknown, stale, wrong host/epoch, reconnect, forged sequence). Git blob hashes matched the committed source. This separate smoke harness is not the repository's complete committed EA5 test suite.
- **Committed, not yet executed:** repository `node --test tests/ea5-native-protagonist-authority.test.mjs` and full `npm test`; C# `dotnet build native/intelligence/integration-tests/IntegrationTests.csproj` then Windows `IntegrationTests.exe`; pinned production SDK build `node tools/native-sdk/compileProductionNative.mjs`. This environment has Node 22 but **does not have dotnet or direct git clone access**. Do not count committed native assertions as passed until Windows CI succeeds on the exact EA5 head.
- **Not performed:** real GTA Enhanced on-fiber model capture, actual player-switch/cutscene/host reconnection receipts, native RPH 1.124/1.132 compatibility in an installed game, EA4 integrated mood flow, ElevenLabs audio or billable calls. **No GTA deployment authorization.**

## Deployment restrictions

Native producer disabled by default; companion listener and F-owned wiring are absent; EA6 real M1 timeline approval remains separate. Release only after F stitches verified pipe ingress, EA6 M1, EA7 mood and EA9 CI, then controlled GTA shadow receipts for Franklin→Michael→Franklin, load/reset, source disconnect/reconnect, cutscenes, unknown model, and owner/cross-character boundaries. A passing stub is not a native in-game proof. User-SID ACL protects against other users, not a malicious same-user Windows process: native host installation and companion process remain trusted computing base.
