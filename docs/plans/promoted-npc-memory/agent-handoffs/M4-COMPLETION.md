# M4 completion — retrieval and PS4 handoff

**Branch:** `feature/m4-completion-schema-recall-20261011`  
**Base:** PR #61 exact commit `c26948cacf2e00b076ec1b71fb1af6f8cf1962c9`  
**Owner:** Agent C; no changes to integrationPorts, knowledgeSelector, knowledgeRenderer, essentialGlue or shared migrations.

## Files and delivered interfaces

- `recallSchemaV1.mjs`: loads the actual `contracts/memory.v1.json` at runtime, checks the v1 recall query/bundle definitions (including nested items, coverage, `additionalProperties:false`, UUIDs and limits). Every returned bundle has `totalBytes` equal to its **complete serialized UTF-8 byte length, including the field itself**. Fail-closed `sealRecallBundle`.
- `recallEngine.mjs`: strict query admission, accounted empty/nonempty bundles, conservative 3,072-unit quote boundary, source/scope suppression markers, improved relative-duration windows, bounded typed PS4 contributions. Never truncate a 12k retained line and call it an exact quote.
- `sqliteIntegratedRecallProjection.mjs`: read-only projection over the **actual** PR #61 P2 v4 tables: dialogue journal + FTS5, immutable event sidecars, permanent memory, M5 tombstones and corrections. Verify hash checksums, owner and protagonist scope, completed NPC playback and reported correction provenance. Suppress forgotten and superseded original records and related derived records; do not claim event identities beyond the current event contract (`unknown`).
- `sqliteRecallReadAdapter.mjs`: select the integrated projection when the `m4_recall_*` fixture projection does not exist; preserve legacy M4 fixture adapter support and conservative coverage.
- `ps4RecallContribution.mjs`: `preparePs4Recall` and `verifyPs4RecallCurrent` create/guard a **typed contribution only**. Reject identity or source changes before read, after read and at send time; bound read admission by deadline, reject spontaneous memory during a player turn, and cap projected JSON bytes.
- `tests/memory-m4-recall.test.mjs`: strict-schema/byte, long exact quote, correction/tombstone, real v4 archive, 10k-record benchmark and PS4 stale/priority tests in addition to original fixtures.

## Precise PS4 integration requirements (Agent H)

1. Obtain immutable **verified** `{characterId,worldProfileId,timelineId,protagonistKey,turnIdentityHash,hostRunId,worldEpoch,incarnationId,encounterId,turnId}` from P2 and the active native turn; do not derive identifiers from ped handle, alias, dialogue text, or remembered prompt state. Pass a `currentIdentity()` callback which reads the same trusted authority.
2. Classify a specific accepted player recall request at the turn boundary. Prefer explicit player requests. Spontaneous retrieval requires PS6/Director admission when the player is not speaking; M4 does **not** authorize speech or trigger Luna.
3. Before PS4 freezes `TurnKnowledgeFrame`, call `preparePs4Recall({query,readAdapter,snapshot,currentIdentity,protagonistKey,source,playerActive,nowUtc,deadlineMs,maxContributionBytes,followup})`. Query MUST contain the verified turn identity hash, and use authenticated clock where available. The default read admission budget is 40 ms and PS4 contribution cap 4096 bytes. A timeout or stale identity produces a dropped contribution, never a blank second prompt.
4. For the live P2 SQLite store, use `SQLiteRecallReadAdapter({filePath})` on the *same database file* with read-only connection and schema v4; or implement equivalent attested read methods. The existing `SharedJournalRecallAdapter` in Agent H's `integrationPorts.mjs` remains separately owned and must be reconciled to these semantics (especially prior corrections, archived records, source hashes, and provenance).
5. Agent H should admit `prepared.contribution.items` as optional `RECALLED` within the existing `knowledgeRenderer` allocation and total request budget. Retain `recordId/sourceKind/mode/freshness` typed metadata. Do not append a separate system message, overwrite source history, crowd out native must-include PS2 safety facts or canonical P2 memory, or promote reported corrections into observations.
6. Immediately before Luna request send, call `verifyPs4RecallCurrent(prepared,{currentIdentity,source,playerActive})`. If false, drop M4 contribution from the single frame. The host MUST also perform its established P0/PS2 and timeline revalidation. Never log verbatim M2 text to routine telemetry.
7. Negative observations require separately certified source coverage. **PR #61 does not yet offer general native PS2 negative-coverage guarantees**, so the integrated reader returns `coverageComplete:false`, and an empty result is `unavailable`, not evidence that the event did not happen.
8. Turn continuations are five-minute and identity-scoped. Agent H must preserve them only inside the corresponding character/world/timeline/protagonist/turn request chain and discard them on owner retirement, rollback or explicit topic change.

## Remaining boundaries and acceptance gates

- The v1 `recallItem.content` max is 3,072 UTF-16 units under this conservative producer, while M2 can retain 12,000; 3,073–12,000 exact lines require a **separately approved v2 chunked quote contract**, not silent clipping. Absolute first/earliest all-time recall remains unavailable until a certified exhaustive ordered reader is supplied.
- The integrated SQL projection reads M5 corrections and tombstones; v4 still lacks a certified all-complete coverage interface and exact native protagonist attribution for M3 events. Do not infer either.
- M4 does not modify actual PS4/C-04 renderer, shared SQLite migrations, the established Essential turn runner or PS6 admission. Those production bindings and deployment testing remain with Agent H.
- Measure 10k-record retrieval p95 on completed CI/target Windows device; 40 ms is the target, not an automatic certification from a passing functional fixture. No GTA test, live native receipt, PS4 deployment, Windows production soak or provider latency result is claimed by this handoff.

### Offline acceptance command

```bash
node --test lsa-shared-brain/tests/memory-m4-recall.test.mjs
```
