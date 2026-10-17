# Memory K J-A — independent M6 retention test

Base: #138 head `6eb50775fe2302157f1bc510d7e93c5d6a511331`. Draft targeting `integration/memory-k-production-20261012`, not `main`. Not for automatic merge.

## Question

Does the existing deterministic M6 selection (coordinator → P2 SQLite → replay cursor) turn previously recorded NPC conversations into durable long-term memories **without** M7 cloud curation, Luna, GTA or any provider?

## Answer

Yes, on the source-simulation level. No new architecture: the new test drives the unmodified `createM6SelectionCoordinator`, `createM6P2ReplayAdapter`, `createConversationJournalRecorder`, `createM5SqliteServices` and real `createP2MemoryStorage` SQLite. `cloudQueueEnabled:false`, and the store handed to the coordinator throws if `enqueueCurationJob` is ever reached.

Tests (`lsa-shared-brain/tests/memory-m6-independent-retention.test.mjs`):

1. **Retention with M7 off.** Accepted player line + playback-completed NPC line become one permanent memory with both verbatim quotes and both source IDs. A mundane exchange stays in the M2 journal and is not promoted. A second promoted NPC receives nothing.
2. **Restart and replay.** After reopen (new host run/epoch, explicit timeline confirmation) `recover` saves nothing, memories and cursor are unchanged. Re-recording the same turn is idempotent. A crash between the durable deterministic save and the cursor ack leaves the cursor unmoved; after restart the identical proposal is replayed with `inserted:false` — no duplicate. A read-only look at the SQLite file shows zero `memory_curation_jobs` rows and exactly the expected deterministic records.
3. **Forgotten before processing.** A conversation whose lines were trashed before M6 ran is rejected (`forgotten_or_corrected`), the cursor still advances, nothing from it is retained (ids or text), and a restart does not resurrect it.
4. **Forgotten after retention.** Trashing a source of an existing memory removes that memory (including its co-source line); replay after restart does not recreate it; unrelated memories and other NPCs are untouched.

## Defect found and fixed (one small change)

`m6Coordinator.qualifyCommitted` checked its own suppression list before looking at the P2 replay stub, so a forgotten source arrived as `forgotten_or_corrected` but was reported as `m6_suppressed_source`. The P2 ack recomputes the stub reason and rejected the mismatch (`m6_p2_unaccounted_invalid_source`), which wedged M6 for that NPC at the forgotten line: nothing later was processed or acknowledged. Existing tests missed it because the mock P2 in `memory-m6-cursor-lifecycle` does not compare diagnostic reasons. Fix: the replay stub's own reason is used first (swap of two `if` blocks, `m6Coordinator.mjs`). Test 3 fails without the fix and passes with it.

## Semantics worth knowing (not defects)

- Forgetting is per source record. Trashing only the player line leaves the NPC's reply eligible as its own memory; forget both lines (or the scope) to forget the whole conversation.
- Forgetting one source of a retained memory removes the memory and its co-sources.

## Results

Local, Node 22.22 / Linux: new J-A 4/4; existing M6 completion 22/22, cursor lifecycle 10/10, P2 production 5/5, SQLite 1/1, integrated replay 10/10, integrated storage 23/23, M7 completion 29/29, e1 `memory-agent-e` 12/12. CI workflow `memory-k-ja-m6-retention.yml` runs the J-A and M6 suites on Node 24, Ubuntu and Windows; exact-head receipts belong in the PR.

## Boundaries

Offline source simulation only. No GTA/native receipts, Luna, provider calls, runtime wiring, soak or latency claims. The new test is not registered in `tools/memory-k-verification/registrations`; comprehensive integrated discovery is unchanged. Original scenario acceptance remains as stated in #138.
