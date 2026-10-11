# Agent D handoff — M5 explicit player memory commands

**Branch:** feature/memory-agent-d-m5-commands  
**Base:** M1 verified 1ca219fd8b95ba2dbf2d1f8031d40fe93308a404 / PR #52  
**Status:** implemented and CI-tested as an **offline, isolated command package**; **not connected to production M2 journal, M4 recall, Essential dialogue turns, the in-game editor, or GTA**. No schema migration, M2 write API, or M4 retrieval file was modified. Do not deploy or claim live memory changes based on the offline fixture.

## Implemented code

| File | Responsibility |
| --- | --- |
| lsa-shared-brain/src/memory/explicitCommands.mjs | Rules-first parse, source-fenced referent matching, clarification, command orchestration, strict v1 memoryAction statuses and truthful acknowledgment helper |
| lsa-shared-brain/src/memory/fixtureMemoryCommandStore.mjs | **Offline only** serialized file-backed fixture store: fsync + atomic rename + restart verification, immutable seed records, explicit memories, suppression tombstones, linked correction overlays, deterministic command-id replay, inspector and non-destructive export |
| lsa-shared-brain/src/memory/p2ManualMemoryInspector.mjs | Existing P2 *global profile manual notes* inspection, read-back-verified CAS CRUD via the existing ProfileStore / P2SqliteProfileStore, and explicitly profile-only export. **Not an M5 spoken journal writer.** |
| lsa-essential-e1-candidate/tests/m5-explicit-memory-commands.test.mjs | Detector, exact quoted text, reported claims, witnessed moments, ambiguity, timeline/protagonist isolation, corrections/forget, restart/idempotence, failure injection, P2 manual notes |
| .github/workflows/memory-m5-commands.yml | Node 22/24 × Ubuntu/Windows CI matrix for M5 tests |

### Public API

\`detectExplicitMemoryCommand(rawText, lunaInterpretation?) -> parsed | null\`

- Recognizes remember, never forget, keep in mind, make a note, promise, forget/delete/erase, transcript correction, counter-claim, inspect, and export; does not treat "do you remember?" or "I forgot my keys" as a memory write.
- Exact input spans are retained; player statements have **reported** provenance, not claimed as witnessed facts.
- A Luna result may optionally help classify a *previously detected* remember cue as a statement, but the supplied content must be an **exact span** of the accepted player line. There is **no mandatory model, background local AI, or model call in M5**.
- This conservative parser deliberately does not guess compound/implicit conversational commands, pronoun identity, or the meaning of missing native observability.

\`handleExplicitMemoryCommand({ line, commandId, scope, store, verifiedContext?, lunaInterpretation?, onClarification? }) -> Promise<memoryAction | memory_read | null>\`

- \`line\` must be an *accepted* player typed/STT \`dialogue_line\` with its original \`recordId\`, exact \`content\`, \`committedAtUtc\`, \`speaker\`, \`source\`, \`delivery\`, \`characterId\`, \`worldProfileId\` and \`timelineId\`. It must be bound to the addressed **promoted** character by the actual M2 source bridge; this package does not infer that authority from text or a ped handle.
- \`scope\` contains \`{characterId,worldProfileId,timelineId,protagonistKey?}\`; valid known protagonist keys are Franklin/Michael/Trevor and \`unknown\`. Incoming candidate scopes must match, including protagonist where provided.
- \`commandId\` is a **stable UUID for retries**. Do not mint another ID on a transport retry. \`requestedByLineId\` in \`memoryAction\` is the source \`line.recordId\`.
- \`onClarification({commandId,requestedByLineId,scope,prompt,alternatives})\` is an optional **separate** UI/dialogue channel for bounded alternatives. The returned \`memoryAction\` itself remains byte-for-byte within the strict \`contracts/memory.v1.json#/$defs/memoryAction\` shape (\`additionalProperties:false\`).
- \`memoryActionAcknowledgement(action)\` supplies a safe default phrase. Luna/PS4 must use \`outcome\` + \`durableCommit\` rather than free text to decide whether it can claim a save.
- \`inspect\`/\`export\` use \`{kind:'memory_read',operation,status,data}\`, **not** a forged \`memoryAction\`, because v1 memoryAction only permits remember/forget/correct.

### Required M2/M3/M4 adapter interface (Agent A/C integration)

\`\`\`js
const store = {
  // Evidence is returned only for the scoped promoted character and lineage.
  async findCandidates({scope,operation,selector,topic,beforeUtc,excludeRecordId}) {
    // Immutable projected candidates:
    return [{
      recordId, kind, characterId, worldProfileId, timelineId,
      protagonistKey, content, occurredAtUtc, label, eventType,
      receiptStatus, speaker, source, delivery, segmentId
    }];
  },
  async commitCommand({
    scope, commandId, requestedByLineId, operation,
    origin, recordType, content, contentHash, pin, evidenceRecordIds,
    targetRecordId, correctionMode, subjectCertainty, requestedAtUtc
  }) {
    // REQUIRED: P2SqliteProfileStore.withTimelineWrite(scope.timelineId,
    //   synchronousAtomicTransaction)
    // Store command receipt, memory/tombstone/correction + frozen evidence in
    // ONE transaction; verify source line is accepted and scope/owner matches.
    return {
      commandId, requestedByLineId, operation, status:'committed',
      durableCommit:true, memoryId, evidenceRecordIds
    };
  },
  async verifyCommand({scope,commandId}) {
    // Read a persisted receipt by commandId + full scope.
    // Null if not definitely committed. No optimistic "in progress" success.
  },
  async inspect({scope}) {}, // optional, read-only
  async export({scope}) {}   // optional, non-destructive and access-controlled
};
\`\`\`

**Important ownership rule:** the eventual SQLite adapter must perform the actual journal/command transaction through M1 \`withTimelineWrite(timelineId, synchronousCommit)\`, with native \`hostRunId/worldEpoch\`, active timeline and provenance revalidated *inside the serialized writer queue*. A fast preflight alone is not enough. The fixture's injected gate mirrors the ordering but **does not authenticate GTA native evidence or qualify as a production database**.

An adapter must fail closed if the source line isn't committed, if a transcript is NPC-generated, if an NPC line has no verified completed playback, if the event isn't witnessed, if a character/timeline/subject doesn't match, or if any referenced evidence has been forgotten. *Never mark durableCommit:true based on an in-memory object or an unverified mock.*

### Storage semantics and retrieval coordination

- **Remember:** create an \`origin:'explicit_player'\` record, importance 85; pinned never-forget = 95. Include command-line evidence and exact selected records; for explicit statements use reported-player-claim semantics, never a verified world event.
- **Forget:** create a durable suppression tombstone indexed by scoped evidence key, holding an audit content hash. Hide target from M4, C-04, PS4 and Luna's future curator **immediately**. Evidence itself must not be rewritten; scheduled 7-day trash purge and cascading derived-memory suppression belong to the real SQLite adapter. The fixture implements only the suppression overlay.
- **Correct:** append a provenance-linked correction rather than mutating an original transcript/witness record. Transcript correction supplies a preferred recall overlay; correction of observed world facts is only a player counterclaim, not a rewrite of native facts.
- **Idempotence:** \`commandId\` is unique and replayable. A duplicate command ID with a different persisted request must fail. Repeated remember of the same referent/content within 60 seconds is deduplicated by the fixture (no new permanent record).
- **Recall:** M4 must consume tombstones and corrections as authoritative overlays, filter by CharacterId/world/timeline/protagonist, never rehydrate a suppressed memory from an old journal row, never replace exact quote bytes with a summarized quote, and never confuse lack of evidence with a negative observation.
- **P2:** the existing editor's manual notes are global profile metadata, not timeline-derived GTA observations. \`p2ManualMemoryInspector.mjs\` safely uses the M1 ProfileStore APIs for those notes. Do **not** route spoken M5 event writes through v1 \`profile.memories\`, where timeline/source provenance would be lost.
- **Export:** M5 fixture exports a separate immutable JSON file; P2 manual-only export is a labeled JSON string with sha256. These are **not** complete future SQLite journal exports, backups or in-GTA privacy/deletion operations.

### Acceptance / test reporting

Run:

\`\`\`sh
node --test lsa-essential-e1-candidate/tests/m5-explicit-memory-commands.test.mjs
\`\`\`

CI workflow: **Memory M5 Explicit Commands**, matrix Node 22 and 24 on Windows and Ubuntu. See exact-head workflow run for results; **an older green run does not validate a later commit**.

Covered: false-positive commands, direct claim and verified situation, hard unknown for unresolved deixis, unique/ambiguous events, speaker and scope fencing, exact retained STT bytes, correction overlay, deletion tombstone, repeated command id across restart, 60-second dedupe, fault before/after rename, timeline suspension at write boundary, a lying mock, inspector/export, P2 manual note CRUD and revision conflict. An intentional after-rename lost receipt returns \`failed\` until retry reads the durable receipt; we do not optimistically acknowledge it.

### Remaining work (not quietly counted as complete)

1. **Agent A / real SQLite journal:** implement transactional \`commitCommand\` and \`verifyCommand\` with durable command receipt keys, error mapping, timeline and subject fences. Add FTS5/tombstone/correction indexes as migrations owned by A or a later integration agent; this branch deliberately does **not** edit their storage files. Authorize command only for an M2-accepted addressed player line; **never** treat parser output as authority.
2. **Agent C / M4 recall:** implement scoped \`findCandidates\` from M2/M3 journal and existing stored memories; propagate precise timestamps, modalities, known subjects, scene, source line acceptance and playback. Apply suppression and transcript overlays to recall before supplying PS4, and test no spontaneous callbacks from deleted sources.
3. **Dialogue/native wiring:** invoke interpreter only on accepted addressed promoted player turns, before Luna generation; present typed \`memoryAction\` in trusted PS4 context, convey clarifications via callback, test speech/action chronology in GTA. Native source/epoch confirmation remains mandatory. No live integration has been performed.
4. **Pending clarification durability:** store two-turn/bridge-reconnect pending choices with an explicit id + expiration; bind clarifying follow-up *only* to previously offered evidence IDs, not freshly guessed candidates. Current core emits bounded options but does **not** yet persist multi-turn clarification state.
5. **Privacy & lifecycle:** wire real user-controlled export/delete/backup, 7-day trash retention and purge, cascaded suppression of derived beliefs, explicit entire-character purge on unpromotion, audit/restore policy and timeline-aware inspector. Test negative retrieval after restart and backup restore.
6. **More syntax/UX:** expand idioms and compound commands (max two per utterance), time/location native constraints and scene/same-encounter markers, stable character aliases beyond the conservative cue detector, optional Luna parse fallback with strict evidence check. No automatic remote model calls are introduced.
7. **GTA acceptance:** Essential/standalone deployments, in-game inspection, reconnect, save/load, time regression, PS native provenance, 4-hour soak, and real dialogue acknowledgment latency remain **unverified**.

**Isolation:** commit all Agent D code on this branch; keep PR draft; do not merge Agent A/C files or infer their implementation from fixtures.
