# Agent C — M4 retrieval and PS4 handoff

**Branch:** feature/memory-agent-c-m4-recall. **Parent:** exact verified M1 commit 1ca219fd8b95ba2dbf2d1f8031d40fe93308a404 (PR #52). **Status:** isolated source implementation and fixture tests, not integrated with live GTA.

## Owned files and interfaces

- lsa-shared-brain/src/memory/recallEngine.mjs exposes validateRecallQuery(query), recallMemory({query,readAdapter,protagonistKey,nowUtc,followup}), and toPs4RecallContribution(bundle).
- recallMemory returns {bundle,continuation}. The bundle follows contracts/memory.v1.json (version 1, recall_bundle); protagonistKey is one of franklin, michael, trevor or conservative unknown, supplied by verified C-15 identity, never inferred from Ped handle, name, or model speech.
- Continuation is valid for 5 minutes and only within exactly the same character/world/timeline/protagonist; explicit topic changes ignore the old topic.
- lsa-shared-brain/src/memory/sqliteRecallReadAdapter.mjs exposes SQLiteRecallReadAdapter({db}) and openSqliteRecallReader({filePath}), with read({scope,terms,fromUtc,toUtc,sourceKind,speaker,limit}) returning {rows,coverageComplete}. A filePath connection uses Node 24 node:sqlite read-only and query_only. A supplied db is never globally flipped into query_only.
- toPs4RecallContribution returns one typed {version:1,contributor:'m4_recall',lane:'RECALLED',queryId,status,coverage,items} contribution. It does NOT write model context or establish an independent prompt owner. PS4/C-04 remains the only allocator and renderer.

## M2/M3 read projection required for this SQLite adapter

Agent C owns **no production schema or migration**. Agent A may provide the following named v1 projection on the common P2 database, or a substitute read-only adapter with equivalent semantics:

1. m4_recall_records_v1: document_id INTEGER PRIMARY KEY; character_id, world_profile_id, timeline_id, protagonist_key, record_id, source_kind, speaker, timestamp_utc (canonical ISO UTC), evidence_state, envelope_json, surface_text. envelope_json contains the lossless M0 dialogue_line or journal_event envelope. Speaker is player/npc for dialogue.
2. m4_recall_fts_v1: SQLite FTS5 of surface_text, with rowid equal to document_id and transactionally maintained on inserts/updates/corrections/tombstones/forgets. Index event type and direct evidence fields, not invented narrative.
3. m4_recall_coverage_v1: character_id, world_profile_id, timeline_id, protagonist_key, source_kind, from_utc, to_utc, all_complete, complete. Only a source-authoritative journal producer marks complete capture/retention coverage; PS2 observing at some point does not prove continuous witnessing.

M2/M3 MUST validate owner association, native hostRunId/epoch, timeline, accepted player typed/STT receipt, and completed NPC playback receipts BEFORE setting evidence_state to verified. The read engine performs additional strict envelope and scope checks but cannot reconstruct missing native proof. No rows from other protagonists, timelines, worlds or characters may be shared or automatically merged. On absent schema or broken query, the read call fails closed to unavailable. Coverage means no record in a certified capture span, NEVER proof an event did not occur.

Agent A owns migrations, read-index population, sessions, the producer write gate, retention and deletion. Agent B owns witnessed-event admission, proof of owner/lifetime, pre-promotion import and source coverage. M4 creates none of those and never writes SQLite. M5/M6 later may project permanent records only after their evidence links/deletion semantics are verified.

## Recall behavior

- CPU-only structured scope, source/time/speaker filtering, bound SQLite FTS5 phrase escaping, a bounded recent fallback, lexical overlap, recency, deterministic tie-breaking and byte budgets. No vectors, embedding process, GPU curator or local LLM.
- Player text requires accepted typed/STT source. NPC text requires completed playback with a verified nonnull UUID receipt. Source text remains exactly as stored (spacing, Unicode, profanity, STT errors); no auto-cleanup or unsupported normalization.
- Direct self/visual/auditory qualified claims may be observed_fact; any reported/inferred/unknown claim is reported_claim. The event output uses source kind/subject/modality/certainty, not a synthetic witness account.
- Archives are searched lexically even when older than the recent window. Spontaneous retrieval is capped to 3 items and remains subject to future PS6 Director admission, rather than overriding player dialogue.
- M0 recallItem content is at most 3,072 UTF-16 code units although M2 dialogue may be 12,000. Oversized exact lines are never truncated and falsely tagged byte-exact. A future versioned quote-chunk retrieval protocol is needed for full 12k recall.
- A missing item with certified source-complete coverage produces not_recorded (in the specified journal), not a statement the world event never happened. Everything else missing or ambiguous returns unavailable. Multiple possible quotes remain separate candidates.
- Relative UTC time phrases are heuristic. Production integration must anchor them to authenticated game/world clocks or explicit player clock. Ordinal all-time and prior-session questions need extended read filters and session metadata before claiming full support.

## PS4/C-04 wiring after M2/M3

1. Capture a verified permanent CharacterId plus worldProfileId, selected timelineId and C-15 protagonist at the trusted turn boundary; do not use ephemeral ped/name/owner alias as a memory selector.
2. Create and validate an M0 recall_query with a bounded deadline, fetch the RecallBundle before PS4 freezes TurnKnowledgeFrame, and preserve source record IDs, certainty and coverage in typed RECALLED memory contribution.
3. Integrate inside PS4's single knowledgeRenderer allocation and optional CONVERSE reference. Budget together with P2 canon and PS2 safety facts, do not inject a parallel Luna system prompt or overtake C-04/PS6.
4. Recheck identity/timeline at send time, drop stale recalls, leave source conversation content out of routine telemetry, and preserve the one P2 DB for Essential and standalone.
5. Once agents publish, version and test the chosen journal-read facade against real A/B writes, correction/tombstones, missing receipts, rollback and GTA timing. This is explicitly outstanding, not a handoff request to the user.

## Verification and limitations

Run Node 24 and SQLite FTS5 using: node --test lsa-shared-brain/tests/memory-m4-recall.test.mjs. GitHub Actions workflow .github/workflows/memory-m4-recall.yml runs Ubuntu/Windows. Fixture-only tables and FTS indexes are created in memory by tests; nothing touches a live store. Covered: byte-exact Unicode quote, interrupted NPC output, character/world/timeline/protagonist isolation, malicious read row, time range/coverage, witnessed versus reported event, bounded spontaneous recall, long quote refusal, scoped followups, topic shift, aged archive via FTS, 10k observations and 50-query p95 timer. Target p95 <=40 ms is a measurement goal, not a claim of GTA success. No local/CI result should be claimed before a completed run.

Limitations: no semantic paraphrase without lexical overlap; no invented false memories; all-time earliest ordinal and prior session selectors still need source indexing; no automatic PS4 frame modification; no production A/B reader until their schema becomes available; no GTA deployment, no M1->M4 merge, and no local LLM.
