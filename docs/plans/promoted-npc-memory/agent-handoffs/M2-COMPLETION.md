# M2 completion — source-bound conversation capture (Agent A)

**Parent:** PR #61, exact integration head `c26948cacf2e00b076ec1b71fb1af6f8cf1962c9`.
**Branch:** `feature/m2-completion-turn-capture-20261011`.
**Scope:** Independent M2 implementation; not integrated in the production runtime, and **not GTA-accepted**.
**Storage:** The existing M1/P2 SQLite writer, M2 immutable dialogue journal and M4 retrieval remain unchanged.

## Audit of existing production hooks

- `lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs` already calls `services.recordM2Player({turn,text:finalInput,source})` after `history.commitPlayerInput` for accepted player turns. It records the original untrimmed `finalInput`, despite `DialogueHistory` independently trimming its short-lived RAM copy. STT currently has provider/model uncertainty.
- On the buffered path, `services.speak` synthesizes `decision.dialogue`. On the early path, it synthesizes successive `segment.text` strings before final decision reconciliation. Both converge on `observation.completion(watchdogMs)`, followed by `history.acceptPlaybackResult({...result,playbackSucceeded:true})` and the existing `services.recordM2Npc({turn,text:decision.dialogue,receipt:result})` call.
- `lsa-essential-e1-candidate/src/integration/essentialGlue.mjs` registers both callbacks, checks P2 promoted projection, and invokes `createConversationJournalRecorder`. **These hooks must be upgraded by Agent H; do not duplicate the existing hooks.**
- `lsa-shared-brain/src/memory/conversationRecorder.mjs` provides a host-neutral, idempotent verbatim record contract; shared `journalSqlite.mjs` enforces source fields, binary exact contents, immutable SHA checks, duplicate/replay conflict, archive, FTS5 and M1 timeline write fencing.
- The current direct Glue adapter resolves host attribution at invocation. A delayed receipt can otherwise pick up a *new* verified host/epoch after reconnect, so a source-bound turn adapter is required. Similarly, sending the reconciled `decision.dialogue` after **early** segment synthesis must not be taken as proof of precisely what was actually delivered to TTS.

## New M2 implementation

`lsa-shared-brain/src/memory/m2TurnCapture.mjs` exports `createM2TurnCapture`. It binds immutable turn identity, CharacterId, owner alias, world, timeline, host run/epoch, protagonist and optional stable sessionId at the actual turn's acceptance. It requires host-authoritative `isCurrent` and `currentProtagonist` callbacks. No native authority is invented inside the shared brain.

The adapter wraps the existing recorder (no second journal) and uses the same existing `store.withTimelineWrite(timelineId, commit)` queue. Immediately **inside** that synchronous serialized callback, it rechecks native-turn liveness, owner alias, protagonist, verified host/epoch and timeline before invoking the existing foundation's `appendDialogueLine`. A stale queued receipt cannot silently adopt another save lineage or actor lifetime. Retirement remains sticky. No model, FTS adapter, SQLite schema or separate process was added.

```js
const bound = createM2TurnCapture({
  store: persistentP2Store,
  characterId: trustedPromotedCharacterId,
  ownerAlias: trustedPromotionOwnerAlias,
  identity: verifiedTurnIdentity, // {pedId,turnId,generationId,sessionNonce}
  protagonist: verifiedProtagonistOrUnknown,
  sessionId: optionalTrustedStableUuid,
  isCurrent: () => hostStillOwnsThisExactTurnAndActor(),
  currentProtagonist: () => currentVerifiedProtagonistOrUnknown(),
});

// AFTER actual typed/STT acceptance (not partial transcription):
const playerResult = await bound.recordPlayerAccepted({
  accepted: true, source: 'typed', // or 'stt'
  text: originalAcceptedInput, utteranceId: acceptedSttIdOrNull,
  transcription: verifiedSttMetadataOrNull,
});

// ONLY AFTER accepted native playback_ended + RAM history acceptance:
const npcResult = await bound.recordNpcCompleted({
  historyAccepted: true, text: exactTextDeliveredToTts,
  receipt: matchedNativeCompletionResult,
  mode: 'buffered', // or 'early_streamed'
  spokenSegments: null, // early_streamed: original ordered exact TTS strings
});

// Abort, supersession, actor retirement, session close/replacement:
bound.retire();
```

Statuses are **`{status:'stored',inserted:true,recordId}`**, **`{status:'duplicate',inserted:false,recordId}`**, or **`{status:'not_stored',reason}`**. An exception is caught and reported without dialogue content or raw SQLite error. `not_stored` is NEVER evidence of a memory save, and neither `stored` nor `duplicate` indicates that permanent M5/M6 memory curation completed. Dialogue proceeds normally on journal failure.

## Exact runtime-hook requirements for Agent H

1. **Modify the existing two Glue/turn-runner callback registrations, not create another recorder or overlapping listener.** Create the bound capture synchronously from the **trusted current P2 projection, host source, protagonist and turn identity** before first asynchronous provider work. Do not infer CharacterId from a ped handle or name. Only promoted and source-confirmed owners qualify. If M1 storage is not enabled/available, preserve existing JSON mode; do not claim journal success.
2. Pass a host-authoritative `isCurrent` closure checking *exact* turn identity, generation, session nonce, native owning actor incarnation, owner retirement and live connection. Pass `currentProtagonist` from verified protagonist identity; use `unknown` when unproven, never guess. Bind hostRunId/worldEpoch by the adapter **at ingress**, not after STT or playback. Make the captured turn scope available to the existing `services.recordM2Player` and `services.recordM2Npc` calls.
3. Call `recordPlayerAccepted` only when `DialogueHistory.commitPlayerInput` returns true and actual typed/STT intake was accepted. Pass the original `finalInput` string verbatim. Do not pass the RAM-trimmed history or an interim STT hypothesis. Distinguish replay duplicate from conflicting accepted text; do not retry by allocating a new turn identity.
4. NPC: wait for `observation.completion` with source-matched native `playback_ended(reason=completed, hadAudio=true, playbackStarted=true, wasInterrupted=false, ok=true)` **and** successful `history.acceptPlaybackResult`. Forward that original result as `receipt`. TTS success, `output_transcript`, `turn_complete` and staged RAM history are not playback proof. Reject any late/interrupted/superseded completion.
5. For the **buffered/final** TTS path pass the actual dialogue handed to the speech provider. For **early-streamed** TTS capture the exact ordered `segment.text` strings passed to `services.speak`. Construct `text` as a literal concatenation of the TTS source strings (or an equivalent verified lossless transcript representation) and pass `mode:'early_streamed',spokenSegments`. The adapter rejects an early-streamed text/segment mismatch. Do not substitute reconciled `decision.dialogue` when it diverges from the actually synthesized segments. Verify whether these were submitted, canceled or successfully handed to native; only the terminal completed receipt authorizes journaling.
6. Retire the capture on cancellation, replacement, terminal failure, native owner retirement, protagonist change or session close; also track session close/disconnect immediately in `isCurrent`. Late receipts and tasks queued behind SQLite must stay rejected. Authenticated reconnection/new world epoch requires a **new** capture and user-confirmed save-lineage authority, never reauthorization of an old bound capture.
7. Interpret `status:'stored'` / `duplicate` only for *journal* acknowledgements. Never emit an explicit "I remembered" / M5 durable command acknowledgement until that separate command's verified durable commit/readback. Report `not_stored` as content-free telemetry, without injecting memory failure into normal Luna dialogue or replaying the line as a new turn.
8. Preserve C-04/PS4 recall as one knowledge-frame writer. Use the existing journal read APIs for replay/archives; exact quotation must be taken from immutable `content` with binary equality. Do not use truncated RAM context as the archive and do not conflate absence of evidence with proof an event never occurred.
9. **Deployment acceptance is separate**: instrument native receipts and bundled Node on isolated Windows GTA install; test owner/summon/retire, session replacement, incomplete/interrupted streamed playback, live protagonist switches, timeline suspension/confirmation and process restart. Capture real source/epoch/turn IDs and playback completion evidence without logging private utterances.

## Offline verification matrix

Dedicated additions to `lsa-essential-e1-candidate/tests/m2-journal.test.mjs` exercise: accepted vs speculative typed/STT, Unicode/whitespace exact byte retrieval, duplicate/conflict handling, buffered and early-streamed valid/invalid native receipts, native RAM-history gate, interrupted/late receipts, owner retirement/supersession, protagonist changes, reconnect/epoch/timeline fences, queued retirement at the actual writer callback, safe failed-storage reporting, and 205 bound committed lines preserved across store close/reopen with an exact old quote. The pre-existing M2 suite already covers 230+ archive entries, profile-preserving migration, FTS, tampering, and mixed host adapter persistence.

Run `node --test lsa-essential-e1-candidate/tests/m2-journal.test.mjs` on Node 24 SQLite/FTS5, plus the branch's `memory-m1-portability.yml` and `memory-integration.yml` workflows. Check the **final commit SHA's** results on Ubuntu and Windows; offline green is not a claim of in-GTA success.

## Outstanding scope and acceptance limitations

- Agent H still owns upgrading the real `essentialGlue.mjs` and `runSequentialTurn.mjs` seams, including authoritative actor/protagonist liveness, original TTS segment capture and receipt audit. **Current production callers use the older direct recorder until H wires this adapter.**
- The immutable v1 `dialogueLine.content` maximum is 12,000 JS code units; overlong input currently rejects rather than silently truncating. Unlimited-length quote chunking would require an approved v2 storage/retrieval contract; this change does not silently add one.
- Native GTA, packaged runtime, real STT metadata, session/owner receipts and exact installed Windows playback checks have not been verified by these source changes. Standalone native integration remains M10 scope.
