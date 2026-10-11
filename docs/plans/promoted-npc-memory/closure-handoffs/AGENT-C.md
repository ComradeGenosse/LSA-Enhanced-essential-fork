# Memory Closure Agent C — M2 source-bound accepted dialogue

**Source pinned:** draft PR #75, `8443a8adec9433626902b46b81bd3e58fc382fb2` (not `main`).
**Dedicated PR:** [#81](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/81), base `integration/memory-completion-h-review-20261011`.
**Verified implementation/test tree SHA before this handoff-only commit:** `e1055366ba33e547b292ca67c1f214054059d45c`. The later Git commit containing this handoff has a separate SHA (a Git commit cannot contain its own hash); read the latest PR head for the delivery SHA. No merge, install or physical GTA execution was performed.

## Changed files — exclusive C ownership

- `lsa-shared-brain/src/memory/m2TurnCapture.mjs`: retains H's P2 `withTimelineWrite` and immutable turn scope, adds required synchronous **native source authority**, accepted-input proof and native terminal/RAM-history/speech proof. Revalidates source and owner inside the serialized SQLite writer, not merely before queuing. Irreversibly retires on observed source/host/timeline/protagonist/owner loss. Does not create a database or bypass the single P2 writer.
- `lsa-shared-brain/src/memory/conversationRecorder.mjs`: refuses non-roundtrippable UTF-16 surrogate input rather than silently replacing characters during UTF-8 SQLite serialization; no trim, rewrite or truncation.
- `lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs` (**new**): thin trusted-ledger adapter; independent of `essentialGlue`, runner, provider or native bridge mutation. Accepts only host-finalized typed/STT text, tracks exact provider-completed PCM-forwarded TTS segments, and only records NPC speech with a source-confirmed **finalized** full stream, matched native `playback_ended(completed)` and accepted RAM history. No final Luna draft argument exists.
- `lsa-essential-e1-candidate/tests/m2-journal.test.mjs`: original real P2 SQLite migration/archive/retirement regressions plus source-bound A mock/Essential/stream/UTF-8/adversarial tests. Corrects an outdated reconnect expectation to sticky retirement.

**No schema migration**; v1 memory `dialogue_line` and M1/P2 SQLite semantics preserved. No extra writer, P2 export change, PS4 renderer or local/cloud AI calls.

## Exported API and exact test-only A fixture

```js
import {createM2EssentialCapture} from '../src/memory/m2EssentialCapture.mjs';
const cap=createM2EssentialCapture({
  store: p2SqliteStore, characterId,ownerAlias,
  identity:{pedId,turnId,generationId,sessionNonce},
  sessionId:null, isCurrent:()=>trustedCurrentTurnAndOwner(),
  nativeAuthority,acceptedInput,playbackHistory,speechTransport
});
```

**A port (mandatory, synchronous, fail-closed):** `nativeAuthority.verifyCurrentTurn({identity,characterId,ownerAlias,hostRunId,worldEpoch})` returns a verified source object **only if current**:

```js
{
  nativeVerified:true,current:true,
  identity:{pedId,turnId,generationId,sessionNonce},
  characterId,ownerAlias,hostRunId,worldEpoch,
  protagonistKey:'unknown', // or source-proven franklin/michael/trevor
  incarnationId:'<native-proven-v4-uuid>',
  encounterId:'<native-proven-v4-uuid>',
  observerIndex:2 // actual retained native observer slot, nonnegative
}
```

The test fixture generates UUIDs/owner/currentness only in isolated fake P2 source tests. **Never** synthesize incarnation, encounter, observer, a protagonist guess or `nativeVerified:true` in production. An A port that cannot supply this contract must return null; K may map differently named *verified source evidence* but never infer missing evidence. The original current runner/glue only uses `isCurrent` and cannot satisfy the new mandatory evidence ports; the active path therefore fails closed pending K's patch.

**Host accepted-input port:** `acceptedInput.verifyAccepted({identity,source,text,host})` synchronously checks an authoritative accepted-input ledger tied to exact identity/generation/source/raw final string and completed `DialogueHistory.commitPlayerInput`; returns `{accepted:true,final:true,identity,source,text}` or null. `source` is `typed` or `stt`. For STT the ledger must be populated from the **final** STT result, not a partial hypothesis. The full `text` is not normalized: punctuation, profanity, leading/trailing whitespace, combining accents and Unicode survive. `utteranceId` is a verified source UUID or null; unsupported STT model/confidence is explicitly unknown.

**RAM/native terminal port:** `playbackHistory.verifyCompleted({identity,receipt,host})` returns `{nativeVerified:true,historyAccepted:true,identity,receipt}` **only** if the exact original authenticated native `playback_ended` receipt matches the identity and accepted RAM history. The shared recorder additionally checks `receipt.type==='playback_ended'`, `reason==='completed'`, `ok===true`, `playbackStarted===true`, `hadAudio===true`, `wasInterrupted===false` and exact four-part identity. This port must preserve receipt **object identity** for the queued write to prevent a lookalike replacement, and retain proof until journal commit. A generic positive callback is not proof.

**Speech PCM ledger:**
- `speechTransport.verifyForwardedSegment({identity,segment,host})` returns `{accepted:true,identity,sequence,text,audioBytes,forwardedBytes}` for a previously verified provider-success **and** actually forwarded PCM segment. Both byte counts must be positive equal safe integers. Sequence starts at zero, is contiguous, <=128 per turn, and texts are literal exact segments sent to TTS.
- `speechTransport.verifyFinalizedAudio({identity,mode,segments,receipt,host})` returns `{complete:true,identity,mode,segmentCount,receipt}` only after the original provider stream / native PCM send finished with no unresolved partial, failed, canceled, retried-with-audio or unforwarded segment. It is rechecked within the serialized writer after the exact terminal receipt.
- All these verifiers are **trusted host adapters** supplied by K, not caller flags, unverified transcripts or a new memory daemon. The JS fixture mimics these **outputs**, not the real pinned native proof generation. No native API can guarantee that TTS acoustics literally pronounce every source character; the proven claim is TTS text-to-forwarded PCM tied to native audio-completed receipt.

Capture API:
```js
await cap.acceptPlayer({source:'typed',text:verbatim,utteranceId:null,transcription:null});
// or source:'stt', with final STT's exact original text & metadata
cap.admitSpeechSegment({
  mode:'buffered', // or 'early_streamed'
  sequence:0,text:exactSubmittedTtsText,
  audioBytes:verifiedProviderPcmBytes,
  forwardedBytes:verifiedOriginalNativePcmBytes
});
await cap.completeNpc({receipt:originalNativeTerminalReceipt});
cap.retire();
```

Player/NPC journal statuses: `{status:'stored',inserted:true,recordId}`, `{status:'duplicate',inserted:false,recordId}`, or content-free `{status:'not_stored',reason}`. A source or SQLite failure must not abort normal dialogue or become an M5 “remembered” acknowledgement. `admitSpeechSegment` returns `{status:'admitted',segments:n}` or `not_stored`.

## Minimal K-only runner/glue integration recipe

1. **At accepted turn hydration, before STT/provider awaits:** after `prepareTurn`, bind actual P2 promotion `CharacterId`/`ownerAlias` and current verified native turn/protagonist from A, `verifiedHostContext` host run/epoch, and active confirmed M1 timeline. Instantiate `createM2EssentialCapture` once, with the original `turn.identity` and native/current owner liveness. Fail closed/null when A evidence is absent. Replace old glue direct `createM2TurnCapture` hook; do not run two recorders.
2. **Typed/final STT intake, before Luna/PS4 or M5:** after `history.commitPlayerInput({identity,input:finalInput})===true`, make the trusted host acceptance ledger certify the original `finalInput` bytes and source; `await cap.acceptPlayer({source:source==='player_mic'?'stt':'typed',text:finalInput,transcription,utteranceId})`. Retain exact durable line receipt. Only on `stored` or verified `duplicate` may K invoke the M5 command coordinator using the persisted record ID; never allow model/user callback to predeclare a save. If journaling is unavailable, continue ordinary dialogue without a false memory claim.
3. **Knowledge:** use the existing sole PS4/C-04 knowledge frame. No extra model instruction, memory writer or Director bypass. PS6 player mic/typed and C-06 priorities remain authoritative.
4. **TTS:** actual `services.speak` provider text for buffered speech is one sequence-zero segment. Early speech uses each exact successfully synthesized `segment.text`; only after the real `forwardPcm` path confirms full, ordered original PCM bytes should the speech transport ledger certify the segment and K invoke `cap.admitSpeechSegment`. Failed/retried attempts must invalidate the incomplete ledger. Do not substitute `decision.dialogue` for early segment text or include a final draft that was not played.
5. **Final audio:** after all early/buffered provider output is finished and the original final audio transfer is sealed, let `speechTransport.verifyFinalizedAudio` attest full completion. Await `observation.completion(watchdogMs)`; require authenticated matched `playback_ended(completed)` and `history.acceptPlaybackResult({...result,playbackSucceeded:true})===true`. Commit this original native receipt and RAM acceptance to the trusted playback ledger, then `await cap.completeNpc({receipt:result})`. No speculative `output_transcript`, `generation_complete`, TTS-success callback or partial playback authorizes a journal NPC line.
6. **Lifecycle:** retire immediately on abort, supersession, native owner loss, P1/P2 retirement, protagonist switch, source disconnect/reconnect/world-epoch transition, timeline suspension or `finally`. An old capture **never resurrects** after re-approval; bind a fresh turn only after authoritative A/P2 reconfirmation. Both ports must remain source-verified at M1 writer queue drain. Do not let delayed source callbacks implicitly renew authority.

**K-owned read-only files:** `essentialGlue.mjs`, `runSequentialTurn.mjs`, speech/native bridge, bootstrap, central config and combined CI. K must maintain an untruncated authoritative typed/STT acceptance ledger separate from the existing short RAM history (which trims). Native source A may remain unknown and should disable writes; actual binary pin and runtime branch proof require physical acceptance separately.

## Offline test log and remaining blockers

Reproduce with **Node 24**:

```sh
node --check lsa-shared-brain/src/memory/conversationRecorder.mjs
node --check lsa-shared-brain/src/memory/m2TurnCapture.mjs
node --check lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs
node --test lsa-essential-e1-candidate/tests/m2-journal.test.mjs
```

The existing `Memory H combined integration acceptance` workflow runs the M2 test path plus schema/M3/M9 on Node 24 **Windows and Ubuntu**, then cross-agent SQLite/M4–M7 and an isolated native .NET harness. **Latest implementation commit `e1055366` CI was queued at this handoff authoring; no green result is asserted here yet.** Earlier `3261b292` combined Windows+Ubuntu revealed one **outdated expectation**, not an unsafe persisted record: an old capture already retired on disconnect rightly returned `m2_turn_retired` instead of `m2_host_epoch_changed`. The test was updated in `ad9449d2`; the original job is **failed**, not claimed green. See the PR's SHA-specific Actions history for final results.

**Remaining blockers:** no verified real A-native port wired, no trusted host accepted-input or PCM/native terminal ledgers wired by K, no physical GTA / session-switch / live spoken-audio receipts, no independent model phoneme verification, no approved v2 splitting beyond the 12,000-UTF-16-code-unit `dialogue_line` bound, no K PS4/M5 integrated end-to-end acceptance, and no live deployment approval. Missing provenance is **unknown / not_stored**, not guessed. Promotion memory remains single SQLite P2 writer and one PS4 knowledge frame.
