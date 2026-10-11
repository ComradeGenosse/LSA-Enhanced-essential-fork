# Agent E — M4 sole PS4 recall closure

**Immutable starting point:** draft PR #75, `8443a8adec9433626902b46b81bd3e58fc382fb2`. **Dedicated implementation branch:** `feature/memory-close-e-ps4-recall-20261011`; PR base `integration/memory-completion-h-review-20261011`. **Implementation head before this handoff:** `7775ccde1b466da86ffd8b2bdc7c1bc7c46d0d4f`. See PR head for the *final* exact handoff commit (a commit cannot literally contain its own SHA). Do not merge or deploy.

## What actually changed

- `lsa-shared-brain/src/memory/ps4RecallContribution.mjs`: `createAcceptedRecallQuery({acceptedTurn,snapshot,queryId,maxBytes})` preserves actual accepted typed/STT text with identity hash, validates strict v1, and deterministically classifies a recall request without Luna-generated intent; `preparePs4Recall` is bounded, epoch/host/character/protagonist fenced and requires PS6 entitlement for spontaneous queries; `verifyPs4RecallCurrent` requires synchronous current native/P2 identity and source visibility (tombstone/correction) readback.
- `lsa-shared-brain/src/memory/recallEngine.mjs`: v1 3072-character code-point item bound (never clips verbatim quotes). Existing M4 SQLite reader remains **P2-owned**; no migration/writer added.
- `lsa-essential-e1-candidate/src/context/knowledgeSelector.mjs`: `projectPreparedRecall(prepared,{maxBytes})` validates five-field typed v1 item shapes and allocates at most 4096 bytes. Earlier **archived dialogue** goes to `RECALLED.earlierArchivedConversation`; other verified evidence goes to `RECALLED.evidence`. Neither is a live user/assistant conversation message.
- `lsa-essential-e1-candidate/src/context/knowledgeRenderer.mjs`: `renderKnowledge({...preparedRecall,recallAuthorization})` admits optional typed M4 *only* when explicit synchronous `recallAuthorization(preparedRecall)===true`, within the existing single `TurnKnowledgeFrame`, respecting 16KiB canon and 112KiB frame budgets, dropping optional M4 before pinned P2 canon, PS2 must-include facts and history. It retains private `recallReferences` / `recallStamp` for later checks. `pruneKnowledgeFrame(frame,keepObservation,keepActivity,keepDialogue,keepRecall)` drops whole items before send without refill.
- `lsa-essential-e1-candidate/src/context/knowledgeDelivery.mjs`: `createKnowledgeDelivery({...recallCurrent,pruneRecall})` fails closed by default when recall is present; revalidates at prepare, send, retry, success and event watch. Pre-send recall invalidation can prune only the M4 portion; sent revisions fail with `knowledge_request_stale`.
- Focused tests in `lsa-essential-e1-candidate/tests/memory-m4-closure.test.mjs`, imported by the existing `lsa-shared-brain/tests/memory-m4-recall.test.mjs` gate. The latter updates its positive test to provide a mock source readback.

No unowned runner/glue, integration port, SQLite, bootstrap, native or Director file was edited.

## Exact integrator K API and minimum edits

1. **At accepted input before model frame freeze**, obtain `snapshot` from **verified** native source authority and the current serialized P2 timeline, not from name, ped handle or LLM. It must contain `characterId,worldProfileId,timelineId,protagonistKey,turnIdentityHash,hostRunId,worldEpoch,incarnationId,encounterId,turnId`. Take `acceptedTurn={accepted:true,source:'player_text'|'player_mic',text:EXACT_ACCEPTED_BYTES,turnIdentityHash}` and an independently allocated v4 `queryId`. Call `createAcceptedRecallQuery(...)` when the player's question warrants recall. The explicit recorder and speaker evidence must be source-confirmed.
2. Bind `readAdapter.read({scope,terms,fromUtc,toUtc,sourceKind,speaker,limit})` to **the one** P2 SQLite read path, e.g. the already integrated `createP2IntegratedRecallAdapter`. Return only source-qualified, proof-checked rows and `coverageComplete:false` unless independently attested. The adapter must continue honoring corrections, tombstones, derived suppression, character/time/protagonist scope.
3. `await preparePs4Recall({query,readAdapter,snapshot,currentIdentity:()=>liveNativeP2Snapshot(),protagonistKey:snapshot.protagonistKey,source,playerActive,deadlineMs:40,maxContributionBytes:4096,nowUtc,followup,directorAdmitted})`. If `status!=='ready'`, proceed with dialogue without recall; never delay for late SQLite. For `spontaneous`, `source:'special_event'` requires original PS6 C-06 Director entitlement, mic/typed priority, cooldown and player inactive.
4. Before `renderKnowledge` (the *sole* PS4 allocator), pass `preparedRecall` and **synchronous** `recallAuthorization:()=>verifyPs4RecallCurrent(prepared,{currentIdentity,source,playerActive,directorAdmitted,validateEvidence})`. The `validateEvidence(recordIds,stamp)` callback MUST reread the original P2 authoritative visibility/correction/tombstone state for every ID under the same owner/world/timeline/protagonist scope and return literal `true` only when all are still eligible. In the absence of this port, omit recall; **do not use** `()=>true` in production.
5. Wire `createKnowledgeDelivery({frame,baseFrame,isCurrent,validate,prune,recallCurrent:(refs,stamp)=>verifyPs4RecallCurrent(prepared,{currentIdentity,source,playerActive,directorAdmitted,validateEvidence}) && refs.every(ref=>currentEvidenceIncludes(ref.recordId)),pruneRecall:f=>pruneKnowledgeFrame(f,()=>true,()=>true,()=>true,()=>false),...})`. Call `prepare()` before request serialization, `beforeRequest(body)` on every provider dispatch/retry and `success()` only after validated delivery; cancel a sent attempt if identity/visibility changes. The same synchronous PS4 native/P0/PS2 validation remains mandatory.
6. Keep `followup` per native owner, protagonist, timeline and turn chain; expire it after five minutes; do not use it after player topic change. Turn query generation must use **accepted** text, not synthesized model intent. Archived quotes stay under the explicit earlier-archived section in the frame, not `messages` or an extra system prompt.

**Mock fixture:** source row `{characterId,worldProfileId,timelineId,protagonistKey,recordId,sourceKind:'dialogue_line',atUtc,evidenceState:'verified',envelope:strictV1DialogueLine}`; full `readAdapter.read()` response `{rows:[row],coverageComplete:false}`. The exact target record must be `delivery:'accepted'` player typed/STT or `delivery:'completed'` NPC with real `deliveryReceiptId`. `currentIdentity()` returns the same live stamp until a native/epoch/protagonist change; `validateEvidence(ids,stamp)` returns an authoritative synchronous literal boolean. Tests may mock these interfaces; mocks are **not** native proof.

## Reproducible offline commands

```bash
node --check lsa-shared-brain/src/memory/ps4RecallContribution.mjs
node --check lsa-shared-brain/src/memory/recallEngine.mjs
node --check lsa-essential-e1-candidate/src/context/knowledgeSelector.mjs
node --check lsa-essential-e1-candidate/src/context/knowledgeRenderer.mjs
node --check lsa-essential-e1-candidate/src/context/knowledgeDelivery.mjs
node --test lsa-shared-brain/tests/memory-m4-recall.test.mjs
node --test lsa-essential-e1-candidate/tests/knowledge-renderer.test.mjs lsa-essential-e1-candidate/tests/knowledge-delivery.test.mjs
```

**Results:** No local full repository checkout or offline Node command was available in Agent E's execution environment; tests were authored but must not be represented as passed until CI check artifacts at the final SHA explicitly show success. No Luna/paid calls were performed. PR #75 combined tests (including M4) run on GitHub on the dedicated PR; record the exact status and SHA after they conclude.

## Unresolved blockers / acceptance boundaries

- K has not wired the trusted native proof, P2 synchronous privacy readback, accepted turn classification or full sole-frame runner send path. Until then these exports are standalone, with default-deny recall and no live NPC memory.
- Generic M3 negative witness/coverage is not certified; a missing row gives `unavailable`, not proof the NPC saw nothing. Native event/protagonist ownership cannot be fabricated by M4.
- A 3073-character *single* quote cannot fit v1 `RecallItem`; preserve source in P2 and return unknown rather than truncate or relabel it. Certified exhaustive earliest/oldest search requires a separate adapter guarantee.
- 40 ms is a target; timeout cuts off late results, but production p95, async SQLite queues, and full Windows/physical GTA validation are not certified by standalone fixtures.
- M5/M6/M8 and PS6 routing remain other owners' responsibility. No extra SQLite writer, local model, remote curation, modified native registration, GTA install or merge to `main` was made.
