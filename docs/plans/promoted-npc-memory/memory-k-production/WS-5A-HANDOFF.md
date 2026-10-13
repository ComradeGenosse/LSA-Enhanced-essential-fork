# WS-5a handoff: NPC dialogue memory capture (K-03(c), W03)

Branch `feature/ws5a-npc-dialogue-memory-capture-20261013`, based on
`integration/memory-k-production-20261012` (PR #138). Draft; no other PR touched.

## What now happens in production code
Player says something -> D01/D02/D03 write the accepted player line (unchanged).
The NPC reply is then written by **D03 only** (`recordNpcOutcome`) as an
`npc_generated` line with:

- `delivery` = `completed` | `interrupted` ("possibly not heard") | `failed` (never presented as said)
- `replyTo` = the player line's `recordId` (resolved by `appendDialogue` in the same character/timeline/world/session)
- same character, timeline, session, protagonist and a shared `journalTurnIdentityHash` derivation as the player line
- a provenance sidecar (`memory_d03_npc_delivery_sources`) written in the same P2 transaction

Evidence comes only from `src/memory/npcSpeechDeliveryLedger.mjs`, filled by
`runSequentialTurn` at the points it really acts (TTS segment start, each PCM
chunk after `host.emit` succeeded, provider total, `turn_complete`, RAM-history
acceptance, runner terminal) and by the native playback events for that exact
`{pedId,turnId,generationId,sessionNonce}`. The recorder is a private capability
given to `OpenAIConnection` (like the D01 issuer); it is not on runtime/services.
`services.admitM2SpeechSegment` (caller-asserted byte counts) is removed.

Classification: completed = every segment provider-bytes == forwarded-bytes, stream
finalised, native `playback_ended(completed, started, hadAudio, !interrupted)` and
history acceptance. Interrupted = audible start + at least one segment's PCM reached
native; text = segments handed to native. Failed = nothing audible, a reply planned.
Anything else (in-flight, inconsistent) records nothing.

Stale/forged/duplicate protection: fresh D02 lease at write time, D01 receipt and
P1 re-verified, continuity with the player line's stored evidence (avatar/NPC
incarnation/epoch), ledger evidence hash re-checked inside the transaction, the
UNIQUE turn hash + replay-conflict detection (no status upgrade, no duplicate).

## Deviation to record
`createM2EssentialCapture` (W03/A03) is still unused in production: its C-01
`verifyCurrentTurn` proof is unsatisfiable (D-022 / L-1). To keep D03 the single
dialogue writer, NPC writes live in D03 and `recordM2Npc` just delegates to it.
The W03 tests were repaired (fixture lacked `hostContextVersion`; replay test
omitted the transcription).

## Scope limits
- Only player-initiated turns with a durable player line are recorded. Director /
  special-event NPC speech is not (test asserts this).
- Interrupted/failed lines are ignored by existing recall readers; WS-6 must
  surface "possibly not heard" explicitly.
- `.github/workflows` untouched (WS-1 owns it); these tests join CI only when `memory-all` lands.
- K-15 (production lock of the public `appendDialogueLine`) is not done here.
- ElevenLabs and the K-05/06/07/12/21 branches untouched.

## Verification
OFFLINE (Node 22 locally, Linux; CI is Node 24): 
- `tests/memory/*.test.mjs` 128/128 incl. new `ws5aNpcDialogueCapture` (21 E2E through the real patched bundle, runtime, runner, D01/D02/D03 and a real P2 SQLite file) and `ws5aJournalAndLedger` (9)
- `tests/memory-k-w03-m2-receipts.test.mjs` 6/6, `tests/m2-journal.test.mjs` 27/27
- `tools/runTests.mjs`: only the 11 pre-existing failures remain (S01-S10, M1 editor); W03's 6 are fixed
- shared-brain: only the 4 pre-existing W04/W06 failures (other agents)

NOT VERIFIED (needs GTA/Windows): native `npcPlaybackStarted/Ended` sequencing from
the real ASI (esp. which fields `playback_ended` sets on barge-in), real audio timing,
long-playback lease behaviour, real OpenAI TTS chunking, Node 24. Scripted native
ACKs in the harness are not GTA evidence.
