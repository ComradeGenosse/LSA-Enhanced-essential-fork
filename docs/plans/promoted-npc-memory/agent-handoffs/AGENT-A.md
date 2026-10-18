# Agent A — M2 shared conversation + event journal handoff

**Branch:** feature/memory-agent-a-m2-journal. **Parent:** M1 exact commit 1ca219fd8b95ba2dbf2d1f8031d40fe93308a404 (draft PR #52). Agent A exclusively owns schema and shared journal storage in this round.

## Implemented contracts and migration

One opt-in P2 SQLite database is migrated transactionally from PRAGMA user_version **2 to 3** under M1's one-writer lock. This does not introduce another database, local model or alternate profile format, and does not modify source v1 JSON or its backup. The M1 profile-only rollback export still deliberately excludes experiential journals. Existing unknown schema versions fail closed; the M1 inspection utility reports version 3.

- **dialogue_journal:** immutable accepted verbatim text, content SHA256, complete dialogueLine v1 envelope, provenance, character/world/timeline/session/protagonist/host/epoch, turn hash and delivery receipt. No age-based deletion or automatic archive pruning.
- **event_journal:** immutable complete journalEvent v1 envelopes, owner evidence, receipt status, original source hash and integrity checksum; dialogue envelopes and original content are both integrity-hashed. Indexed by character, timeline, event type and occurrence time.
- **dialogue_journal_fts:** FTS5 phrase index, used without a local embedding model. Both journals have indexed scope/recency paths.

Journal rows intentionally do not foreign-key directly to promoted_profiles: M1's normal profile edit CAS replaces those rows, so a cascading FK would delete user history and a restricting FK would break profile edits. Inserts verify promoted ownership independently. **Explicit P2 character removal now transactionally purges that character's dialogue and event journals**, including FTS5 entries. M5 must implement record-level manual deletion, export, and derivative invalidation.

## Public integration APIs

Import the shared package, not an Essential-specific implementation:

- lsa-shared-brain/src/memory/journalSqlite.mjs: migration, source contracts, append/read internals.
- lsa-shared-brain/src/memory/conversationRecorder.mjs: createConversationJournalRecorder(store), journalIdentityUuid(parts).
- lsa-shared-brain/src/characters/sqliteProfileStore.mjs: public, M1-guarded P2 store.

Shared store methods:

    await store.appendDialogueLine(dialogueLineV1, {sessionId,protagonist,hostRunId,worldEpoch});
    await store.appendJournalEvent(journalEventV1);
    await store.readDialogueLines({characterId,timelineId,limit:200,speaker?,sessionId?,beforeUtc?});
    await store.findExactQuote({characterId,timelineId,quote,limit?:20});
    await store.searchDialogue({characterId,timelineId,query,limit?:20});
    await store.readJournalEvents({characterId,timelineId,eventType?,limit?:200});

Queries require explicit CharacterId and timelineId; world scope is bound to the store. Return values are immutable. Dialogue records add attribution {sessionId,protagonist,hostRunId,worldEpoch} to the complete dialogueLine envelope. Exact quotes use binary equality and return untouched stored words; search is literal FTS5 phrase matching. Limits range from 1 to 1000 records. Neither query performs cross-timeline fallbacks.

All writes call M1 withTimelineWrite at the serialized SQLite commit boundary. Suspended/ambiguous timelines, unconfirmed/disconnected host context, wrong epochs, stale owners and replay conflicts are rejected. Dialogue replay keys on character/timeline/speaker/turn hash; event replay keys on character/timeline/observationId/revision. Repeated identical source evidence returns {inserted:false,recordId}; conflicting source evidence is never silently substituted.

**Agent M3:** Supply memory.v1 journalEvent envelopes to appendJournalEvent. Source code verifies contract, promoted owner alias and verified host epoch; your observer pipeline still must independently prove witness modality, native ownership and source hash from actual evidence. Do not implement additional SQLite tables or bypass M1 fencing.

**Agent M4:** Use readDialogueLines, findExactQuote, searchDialogue and readJournalEvents with explicit character/timeline scope. A model's final quote is not guaranteed exact, but deterministic store results are. Wire one typed C-04/PS4 retrieval contributor rather than changing the memory DB.

**Agents M5/M6/M7:** Treat journal source records as immutable evidence. Implement explicit delete/export/forget, curation queues, derived memories and provenance invalidation as your own layers AFTER this shared foundation; coordinate any new schema with Agent A's ownership.

## Accepted turns and playback

Recorder usage:

    const recorder=createConversationJournalRecorder(store);
    await recorder.recordPlayerAccepted({
      characterId,identity:{pedId,turnId,generationId,sessionNonce},
      source:'typed',text:originalAcceptedText,attribution:{protagonist:'franklin'}
    });
    await recorder.recordNpcCompleted({
      characterId,identity,text:actualSpokenText,
      receipt:matchingNativeCompletedPlaybackEvent
    });

The Essential path invokes player recording after real accepted typed/STT player intake. It passes original finalInput before the transient history's trim/truncation affects it. NPCs are admitted only after source-matched native playback_ended(reason=completed,hadAudio,playbackStarted,!wasInterrupted) AND DialogueHistory acceptance. Failed, interrupted or merely generated speech is not journaled. A stable locally derived receipt UUID is used when Essential has no native receipt UUID; this identifier is not extra proof of playback. The host callback remains the trust boundary. Text is never trimmed, sanitized, summarized or silently clipped; >12000 code-unit input is rejected per contract.

Essential integrates only when opt-in SQLite is enabled, a captured promoted character matches the persistent projection, and source/timeline are verified. JSON-mode stays unchanged. Failed optional writes produce content-free telemetry and do not fail an active conversation. Standalone imports the exact same recorder/store. Standalone native binding and playback receipt integration still belong to the separate standalone-host track.

## Tests and validation boundary

New suite: lsa-essential-e1-candidate/tests/m2-journal.test.mjs. The Windows/Ubuntu Node 24 workflow also runs prior M1/editor/identity regressions and Node 20/22 JSON startup checks. Tests cover transactional migration; both adapters; exact UTF-8 including Unicode/profanity/whitespace; STT uncertainty; FTS/quote lookups; 230+ lines with years-old quotes; explicit character removal/FTS purge; replay, reconnect and restart; native receipt admission; timeline/epoch suspension; event contract/dedup/owner checks; profile edit preservation; and tamper detection.

**Check the CI checks on the exact draft PR head before claiming green status. These are offline source tests, not GTA acceptance.**

## Deferred/limitations

No in-GTA validation, GTA installation, automatic SQLite enablement, prompt recall rendering, journal-specific deletion/export/quotas or user-driven archive controls in this branch. M4 delivers conversational recall, M5 delivers deletion/export, and native adapters must demonstrate current host/epoch/owner and actual playback receipts. Essential STT metadata may report unknown model/confidence until provider metadata is explicitly forwarded. No raw text appears in telemetry. This branch must stay stacked on PR #52; do not merge main or other agents' branches.

**Coordination:** other agents should merge/cherry-pick Agent A's shared journal changes after M1 and use these APIs rather than independently authoring a competing migration or database.