# Production W03 / A03 — M2 exact accepted dialogue and native-completed audio

**Status:** Specialist implementation delivered for source review; **not a production-ready original GTA integration**. The original runner and global native hookup are K-owned and unchanged. Physical GTA acceptance **NOT PERFORMED**. Branch: `feature/memory-k-t3-m2-audible-capture-20261011`. PR base: `integration/memory-closure-final-k-20261011`. Exact initial parent: PR #94 `0201731973a1c02a8852271897e2c8df420396b9`. W03/A03 plan: PR #97, workstreams manifest on `planning/memory-k-production-closure-20261011`.

## Source commits and exclusive write scope

- `20b627c28c6db2703833ce596e3468ca2a16dd6a`: `lsa-shared-brain/src/memory/m2TurnCapture.mjs` now returns `{status:'stored'|'duplicate',inserted,recordId,durable:true,scope,proof}` for **P2-readback-verified** accepted lines only. Readback checks immutable original owner/host/protagonist and exact text/source, inside the P2 reader, without a second database; fail returns `{status:'not_stored',reason:'m2_commit_readback_unverified'}`. New `assertSourceCurrent()` fences the bound native owner, incarnation, epoch, protagonist and timeline.
- `4587b887ce744621bfea7a80447aace536667661`: `lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs` checks native source on every accepted input/PCM segment; failed, incomplete or reordered speech evidence poisons the turn; `completeNpc` is single-shot with mandatory retirement even after failed native completion. Requires actual originally forwarded provider PCM, stream finalization and history-matched native completion.
- `5a008eca4f17ed28e2f11c019c3537bdb7945ef1`: `lsa-essential-e1-candidate/tests/memory-k-w03-m2-receipts.test.mjs`, 205 literal typed/final STT lines over genuine temporary P2 SQLite, real file close/reopen, four protagonist attributions, profanity/Unicode/combining marks, duplicate replay, missing durable readback, corrections, buffered/early-completed native PCM, queued late writes, interruption, recycled owner and epoch/rollback losses. Source ports are **explicitly isolated test fixtures**.
- This handoff file is a separate final docs commit; see PR head for its SHA. No outside specialist paths, K-owned runner/glue, native shared registration, CI acceptance report or main modified.

## Actual baseline and dependency inventory

1. Existing Agent C PR #81 supplies strict `createM2EssentialCapture`, `createM2TurnCapture`, `conversationRecorder`, original proof verifiers and additive P2 SQLite. PR #94 integrated them but `essentialGlue.mjs` still calls older `createM2TurnCapture` without accepted input or speech ledgers. We **did not** change K-owned files.
2. T1 W01 **must** supply live original C-01 accepted-turn evidence in `nativeAuthority.verifyCurrentTurn(query)` including `{nativeVerified:true,current:true,identity,characterId,ownerAlias,hostRunId,worldEpoch,protagonistKey,incarnationId,encounterId,observerIndex}`. Missing, mismatched or late evidence must return `null`; never invent historical acceptance or native owner. PR #94's original `MemoryOwnerAuthority.cs` publishes `acceptedTurns=[]`, and original JS `verifyCurrentTurn` omits incarnation/encounter/index: absent T1 integration **M2 correctly fails closed**.
3. Original Essential runner must provide an independent host `acceptedInput.verifyAccepted({identity,source,text,host})` port from **final accepted** typed/STT source ledger and accepted RAM history, not from RAM alone. Exactly matching `{accepted:true,final:true,identity,source,text}` is mandatory. No trimming/normalization/truncation. Partial STT does not count.
4. Original native `playbackHistory.verifyCompleted({identity,receipt,host})` must authenticate the actual `playback_started` + `playback_ended(reason:'completed')` terminal and accepted RAM history, returning same `receipt` *object* with `{nativeVerified:true,historyAccepted:true,identity,receipt}`; synth success and output transcript are not playback proof.
5. Original `speechTransport.verifyForwardedSegment({identity,segment,host})` must verify provider-completed PCM actually forwarded by `forwardPcm` with identical positive `audioBytes===forwardedBytes` and literal segment text/sequence. Original `verifyFinalizedAudio({identity,mode,segments,receipt,host})` must prove all provider and native PCM completed, no outstanding failed/retried/cancelled chunk, exact final receipt; return `{complete:true,identity,mode,segmentCount:segments.length,receipt}`. Both source ledgers must revalidate synchronously in the serialized SQLite writer.
6. The native owner/adapter epoch, active P2 timeline and host run must remain valid at **both enqueue and commit**. A repaired source cannot resurrect an old capture. Protagonists are attribution variants of the same player, never distinct user identities.

## Exact adapter contract for K and W04

```js
const cap = createM2EssentialCapture({
  store: journalStore,characterId,ownerAlias,identity:turn.identity,
  isCurrent: () => originalTurnStillCurrent(),
  nativeAuthority: authenticatedT1MemoryAuthority,
  acceptedInput: originalFinalAcceptedInputLedger,
  playbackHistory: originalNativeTerminalAndRamHistoryLedger,
  speechTransport: originalProviderAndPcmForwardingLedger,
});
const playerReceipt = await cap.acceptPlayer({
  source: source === 'player_mic' ? 'stt' : 'typed',
  text: finalInput, // exact raw original accepted string
  utteranceId: verifiedOriginalUtteranceIdOrNull,
  transcription: source === 'player_mic' ? exactFinalSourceMetadata : null,
});
if ((playerReceipt.status==='stored'||playerReceipt.status==='duplicate') &&
    playerReceipt.durable===true &&
    playerReceipt.proof?.kind==='original_c01_accepted_turn' &&
    playerReceipt.scope?.timelineId === journalStore.activeTimelineId &&
    stillOriginalNativeTurnCurrent()) {
  // ONLY HERE may K invoke W04 M5; pass the same playerReceipt and
  // verify P2/native/epoch again immediately before M5, before any Luna call.
}
cap.admitSpeechSegment({
  mode:'early_streamed', // or 'buffered'
  sequence:0,text:actualTextSubmittedToTts,
  audioBytes:providerCompletedPcmBytes,
  forwardedBytes:verifiedOriginalForwardedPcmBytes
});
const npcReceipt=await cap.completeNpc({receipt:originalNativeCompletedReceipt});
cap.retire(); // also in K's finally, abort/supersession and owner retirement
```

**M5 receipt:** `scope={worldProfileId,timelineId,characterId}`; `proof={kind:'original_c01_accepted_turn',identity,ownerAlias,protagonistKey,hostRunId,worldEpoch,incarnationId,encounterId,observerIndex,contentSha256,source}`; `recordId` is the *verified* existing P2 SQLite dialogue row. No raw dialogue inside telemetry. The receipt is **not** authority to re-enter M5 on a different turn: K/W04 must fence it with the original native turn and currently confirmed timeline.

**Important fail-closed boundary:** P2 `findExactQuote` returns a bounded set of 20 identical quotations. If an old replay is no longer in that returned page, readback yields `not_stored` rather than a speculative M5 acknowledgement. K/T6 may later provide a scoped P2 `readDialogueByRecordId` through the same writer/reader to avoid that conservative limit. T3 did not alter T6-owned SQLite foundation.

## K-exclusive call order in actual source

1. In `essentialGlue.mjs`, import `createM2EssentialCapture` instead of the older `createM2TurnCapture`, negotiate T1 native current-turn capability, instantiate once after original `prepareTurn` hydration and before STT awaits, passing **all four live trusted ports**. Return null (memory disabled) on unavailable provenance; never fabricate evidence.
2. In `runSequentialTurn.mjs`, after original `history.commitPlayerInput({identity,input:finalInput})` succeeds, use original host accepted-ledger insertion from the typed or **final** STT source (not model text). Await `cap.acceptPlayer({source,text:finalInput,...})`; hold exact durable readback receipt. Only if durable and still current, dispatch W04's M5 command/clarification **before** `finalizeKnowledgeFrame` and any model/provider execution. Do not call W04 on `not_stored`.
3. During `forwardPcm`, separately count successful authorized `host.emit({type:'audio',chunk})` PCM bytes for this identity/attempt. Buffered speech: one exact segment equal to actual `services.speak(dialogue)` source and completely forwarded PCM. Early streaming: admit each successfully completed `services.speak(segment.text)` source in original segment order *after* `onPcm` forwarding success, not `decision.dialogue` or `streamedSegments` without audio. Certify `verifyForwardedSegment` on original host ledger; mark failed attempts incomplete. The whole provider stream must seal before native playback completion is admissible.
4. After `await observation.completion(watchdogMs)` succeeds and the **original** `history.acceptPlaybackResult({...result,playbackSucceeded:true})===true`, certify same native receipt object and source PCM-finalization. Invoke `await cap.completeNpc({receipt:result})` before calling `cap.retire()`. A `playback_started`, `output_transcript` or completed TTS response cannot journal an NPC line. No late/duplicate replay after `finally`.
5. Retire immediately in runner abort/supersession, current-owner loss, epoch/timeline/character retirement, protagonist switching, socket change, and `finally`. Do not let memory rejection stop stock dialogue; log only status/reason, not raw text. Keep M4/M8 in the **one** original PS4 frame. Never register alternative TTS or SQLite owner.

## Verification commands / receipts

Target **Node 24** on Linux + Windows, with P2 SQLite/FTS5 enabled:

```bash
node --check lsa-shared-brain/src/memory/m2TurnCapture.mjs
node --check lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs
node --check lsa-essential-e1-candidate/tests/memory-k-w03-m2-receipts.test.mjs
node --test lsa-essential-e1-candidate/tests/memory-k-w03-m2-receipts.test.mjs
node --test lsa-essential-e1-candidate/tests/m2-journal.test.mjs
```

**Evidence status at handoff drafting:** three specialist files pushed; no CLI source checkout in this agent execution environment and no verified Node 24/Windows CI receipt at this SHA yet. Test contents are committed, not represented as passed. K/T9 must run these exact commands plus full original end-to-end runner replay; GitHub Actions receipts, if subsequently available, must be reported with final commit SHA and job URL. This isolated W03 simulation is not A03 integrated acceptance, no physical GTA test was run, and S01–S10 remain false until K's exact-head original replays.

**Release decision:** W03 source ready for independent review, A03 **NOT ACCEPTED** without native T1 original C-01, host accepted-input/native playback PCM ports, K shared runner wiring, full Node24 CI and integrated replay. Controlled GTA **NO-GO**. No merge to main, GTA installation, paid calls or cloud activation.
