# WS-6a Agent B handoff — G3/G4/G5 read-side evidence

Starting #152 SHA: `a4ab6fbc763dfdef594f392514fd1741466e71f2` (work order commit).
Branch: `feature/memory-k-ws6a-g3-g5-recall-20261013`.
Integration target: #152 **only**; no writes to #152 or #138.

## Owned files

- `lsa-shared-brain/src/memory/recallEvidencePolicy.mjs`
- `lsa-shared-brain/tests/memory-ws6-g3-g5-evidence.test.mjs`
- `lsa-shared-brain/tests/memory-m4-recall.test.mjs` (one import to run the focused test in existing Windows/Linux M4 CI)
- This handoff; no shared turn runner/PS4/workflow files changed.

## Agent C interface

Import `createRecallEvidencePolicy({store,isCurrent,verifyNativeNegative})`.
Provide the existing **original P2** store and D03 `verifyMemoryCurrent` closure; never an untrusted player/model claim. The `source` passed to each call is the frozen authenticated owner lease (hostRunId, worldEpoch, ownerAlias, incarnationId, encounterId, observerCaptureRef); the `scope` is the confirmed NPC, world and timeline plus verified historical player avatar. Every asynchronous store read, native verification, and output has a current-source guard.

- `await policy.witness({scope,source,observationId,eventRecordId,fromUtc,toUtc})`: returns witnessed only from verified P2 event+sidecar; negative only with **both** a continuous closed, source-qualified M3 ledger **and** independently authenticated interval-specific native negative proof. Null native verifier, missed samples, unknown observation ID, partial coverage, source switch, forged owner or mismatched interval returns unknown/unavailable. IMPORTANT: the persisted `nativeVerified` and `certified` fields are **not** native attestation. Integrator must provide a real verifier of this exact interval/event/source or leave negatives disabled (unknown). Ledger alone never warrants did_not_witness. It is not enough to wire an `async()=>true` verifier.
- `await policy.countDialogue({scope,source,predicate:{speaker?,containsText?,fromUtc?,toUtc?}})`: uses existing `store.withP2SqliteRead` to exhaustively scan verified, non-suppressed, non-superseded M2 dialogue across all player avatars, with content/envelope SHA checks. Returns `{status:"complete",exactCount,first,last,best,scanned,querySemantics:"literal_substring"}` **only if** fully scanned. Unsupported freeform semantic/event counts, scan over 20,000 rows, corrupt receipts, revoked source, or missing P2 read return `{status:"incomplete",exactCount:null,...}`. First/last refer to deterministic committed UTC ordering. Scan costs are O(rows): call only for explicit eligible exact-count/first-last questions, not each turn; benchmark with busy production-style journals.
- `await policy.verifyReferenceVisibility({scope,source,recordIds})`: optional **pre-send/retry** check under the original P2 read fence for source generation, current timeline, suppression, superseded transcripts, and still-present source hashes. Reject the whole contribution on false. For G3 exact counts, rerun the exhaustive query before a later send/retry: visible old IDs do not prove the numerical result is still current.
- `await policy.labelledEvidence({scope,source,sourceKind?,terms?,maxBytes?})`: uses authenticated P2 integrated recall only, no competing store. Produces bounded typed items: exact byte-preserving dialogue quotes, directly observed event claims vs reported claims, derived archival memories, and character opinions. Retains record IDs, sourceEvidenceIds and original avatar provenance. Returns `completeness:"bounded_candidate_page",exactCount:null` (never a false total). The integrator must admit these via existing PS4 RECALLED allocator, not a second prompt path.

## Truthful limitations / next steps

1. This is **read-side only**. Shared runner, source-current wiring, PS4 schema/renderer and deployment are owned by C. No native negative verifier is supplied here: the callback is a deliberately missing authority boundary; do not claim production G5 negative behavior until the native signer/verification path can attest the exact observation *and interval*.
2. G3 exact counts support a **literal dialogue predicate**, not natural-language semantic matching or witnessed-event counts. Unsupported questions abstain explicitly. The existing M4 384-row result has no all-complete proof.
3. Current bounded G4 labelling trusts the existing P2 projection's integrity verifier; it is not a substitute for verifying original source at pre-send/retry. C should call D03 current-source checker right before PS4 send and prune contributions on revocation.
4. Unit tests use in-memory P2 schema/SQLite rows and controlled native mock boundary; they do **not** claim a compiled native SDK or physical GTA acceptance. Node 24 Windows/Linux, end-to-end source/timeline race tests, exact-head CI and M4 latency p95 remain C's responsibilities.
