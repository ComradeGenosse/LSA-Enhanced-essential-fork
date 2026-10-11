# Agent G — M6 deterministic permanent memory lifecycle handoff

**Pinned starting SHA:** 8443a8adec9433626902b46b81bd3e58fc382fb2 (PR #75).  
**Dedicated PR:** https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/82  
**Branch:** feature/memory-close-g-deterministic-lifecycle-20261011  
**Base:** integration/memory-completion-h-review-20261011  
**Exact last implementation-code SHA:** bc96c7d1c212200e68d3286faf27e878109d54b4. The documentation commit is an additional PR-head commit; inspect PR #82 for its final document-inclusive SHA.  
**Disposition:** Offline source code and mocked P2 cursor tests delivered. Production integration NOT proven. No merge, install, paid Luna call or GTA acceptance.

## Changed files (owned)

- lsa-shared-brain/src/memory/m6Coordinator.mjs — durable cursor-scoped selection, scene close/idle/recovery hooks, privacy/source rechecks, retry-safe saves and optional queue insertion before cursor ack
- lsa-shared-brain/src/memory/m6CursorConsumer.mjs — strict versioned P2 source-hashed, append-sequenced, paginated cursor consumer
- lsa-shared-brain/tests/memory-m6-cursor-lifecycle.test.mjs — 2,500-source restart, page/send/save/queue/ack crash matrix, privacy, false witness, different owner/protagonists, timeline switch, cloud-off cases
- lsa-shared-brain/tests/memory-m6-completion.test.mjs — imports cursor tests in existing CI entry point, explicitly enables bounded legacy test-only fixture
- lsa-shared-brain/tests/memory-m6-sqlite.test.mjs — pins legacy SQLite smoke test to explicitly bounded compatibility fixture

Existing selection.mjs and consolidation.mjs were reviewed, not rewritten: deterministic immutable source IDs, scene gap and 64-ID upper bound, humor/pranks, embarrassment, crashes, relationships, ordinary high-salience source-grounded incidents, no fuzzy merge across independent source incidents. Explicit M5 pinned memories are excluded from automatic-memory competition.

## Exported production API and exact K hooks

~~~js
import {createM6SelectionCoordinator} from
  'lsa-shared-brain/src/memory/m6Coordinator.mjs';
import {createM6CursorConsumer, requireM6CursorStore,
  M6_CURSOR_CONTRACT_VERSION} from
  'lsa-shared-brain/src/memory/m6CursorConsumer.mjs';

const m6 = createM6SelectionCoordinator({
  store: p2SqliteStore,
  // allowLegacyBoundedReplay defaults false. NEVER enable it in production.
  cloudQueueEnabled: false, // true only after explicit M7 authorization
  quietMs: 90000,
  pageSize: 250,
  maxRows: 8192,
  maxPages: 64,
  softTargetPerHour: 6,
  minScore: 0.56
});
const scope = {characterId, worldProfileId, timelineId}; // trusted P2/native
await m6.onSceneClose({scope, atUtc}); // after final M2/M3 scene commits
await m6.onIdle({scope, atUtc});       // low priority, outside player turns
await m6.recover({scope, atUtc});      // after restart/verified resume
~~~

Results: {status,phase,cutoffUtc,readCount,qualifiedCount,candidateCount,saved,queued,rejected,fromCursor,toCursor,acknowledged,archiveComplete,blockedByQuiet}. In production status is complete or partial_evidence. A legacy-only fixture returns legacy_bounded and archiveComplete:false. No hook returns a player-facing M5 saved acknowledgment.

K must call these only after P2 initializes; native run, epoch, incarnation/encounter, current CharacterId/owner, scene closure and confirmed writable timeline have been authenticated. Never feed raw NPC/model narrative or proximity as a witnessed fact. Call scene-close only AFTER accepted typed/STT lines, completed NPC playback and qualifying PS2 journal evidence have committed. Call idle only when turn/native work is idle, without preempting original player speech, PS6 Director entitlements or game fiber. Recover after native re-verification and explicit timeline confirmation; stop work on owner retirement, world/save switch or revoked timeline. Propagate errors and retry only after repairing the P2/source fault. No false success on rejected/partial checkpoints.

## Agent B cursor methods required on ONE P2 SQLite writer

The production code fails closed unless all THREE B-owned methods are available. Agent B must implement their real SQL and checked serialized transactions; G owns no P2 migration or separate database.

~~~ts
readM6Checkpoint({scope}): Promise<{
  version:1,
  cursor:string|null,
  activeHourCount:number,
  hourBucket?:string
}>

readM6JournalPage({scope,afterCursor:string|null,limit:number}): Promise<{
  rows:Array<{
    cursor:string,
    sourceHash:string, // 64 hex SHA256(JSON.stringify(evidence))
    evidence:DialogueLineV1|JournalEventV1 // committed P2 projection
  }>,
  hasMore:boolean
}>

ackM6Checkpoint({
  scope,expectedCursor:string|null,nextCursor:string,
  sourceHashes:Array<{cursor:string,sourceHash:string,recordId:string}>,
  savedProposalIds:string[],
  rejected:Array<{recordId:string|null,reason:string}>,
  cutoffUtc:string,hourBucket:string,cloudQueueEnabled:boolean
}):Promise<{committed:true,cursor:string}>
~~~

Cursor MUST be an opaque monotonically append-ordered source sequence, never a wall-clock timestamp. Read all retained M2/M3 committed rows across pages (including old archives), without latest-1,000 truncation. P2 must source-check the original stored envelope and preserve native PS2 sourceHash/sidecar separately from the M6 decoded-envelope integrity SHA. Include a safe migration/backfill and unified cross-journal sequence index within P2.

Acknowledge under the SAME P2 native/timeline-checked serialized write transaction: CAS expected cursor, prove contiguous hashes through nextCursor, prove every listed deterministic memory saved, prove every enabled queue job committed, recheck current privacy/tombstone/correction state, audit rejected rows, then persist the new cursor and automatic-admission count/hour bucket. Failure must leave cursor unchanged. Neither explicit M5 pinned memories nor user-authored notes count toward the automatic six/hour soft-pressure baseline. The stable persisted active-hour count must exclude unacknowledged batch saves to make retry deterministic; hourBucket tracks UTC hour by default or a K/P2 source-proven co-present active hour.

### Crash guarantee and operational bounds

For each page batch: committed journal read -> source verification -> deterministic proposal IDs -> idempotent P2 save -> optional idempotent P2 M7 queue enqueue -> transactional P2 cursor CAS ack. A crash at any earlier boundary leaves source rows replayable. Retried proposals retain immutable source hashes/IDs and the same checkpoint pressure. A crash after an already committed ack resumes from the new cursor, rather than creating a second memory. A nonmatching CAS or source hash is an error, never a best-effort advance.

M6 defaults to pageSize 250 and maxRows 8192, maxPages 64. If backlog exceeds these limits, it fails loudly with m6_cursor_*_exhausted, cursor stays unchanged. K must alarm and tune bounded capacity or add a separately reviewed safe segmented scan: NEVER skip to latest-N or silently drop older evidence. Agent B must ensure sidecar-less witnessed rows block forward progress rather than certify negative observation. Rejected non-witness rows get an audited negative admission, not an inferred no-witness claim.

## Privacy, source, cloud and priority invariants

- normalizedEvidence only accepts accepted player typed/STT and actual completed native-playback NPC lines; event receipt must be PS2 witnessed and owner proof must be verifiable against the same P2 identity. Any unproven protagonist remains unknown.
- For witnessed M3, sidecar read must return the original matching event ID, native sourceHash and evidence. Inferred/reported claims cannot silently become direct observation. Source-scoped player speech remains a quote of what the player said, not proof of the GTA world.
- M5 tombstones and correction overlays exclude original facts. M6 rechecks privacy before save, before queue, and before checkpoint ack. B must provide final atomic protection and M7 must also check again before provider dispatch.
- Cloud curation remains disabled by default. This coordinator enqueues only; it does not make a request, reserve cloud spend, allocate VRAM or start a background daemon. K/M7 own consent, budget, provider leases and low-priority scheduling.
- Deterministic selection works with the cloud disconnected. ~6 automatic memories per active hour is a SOFT target, not a hard deletion quota. Extraordinary humor-heavy fixtures exceed it; ordinary text still remains in M2 archive.

## Actual offline test commands and receipts

At exact implementation predecessor commit 1a9c79373e1e90aaca9abec27d0e3210ab012e3b, GitHub Actions run 38183758983, M6 deterministic memory completion, completed SUCCESS for Ubuntu and Windows with Node 20.19.0 and Node 24. Ubuntu Node 24 job 114601609804 recorded:

- node --test lsa-shared-brain/tests/memory-m6-completion.test.mjs — 19 passed, 0 failed (includes new 2,500-row restart, crash matrix, source privacy and false witness)
- node --test lsa-essential-e1-candidate/tests/memory-agent-e.test.mjs — 12 passed, 0 failed
- node --test lsa-shared-brain/tests/memory-integrated-storage.test.mjs — 10 passed, 0 failed
- node --test lsa-shared-brain/tests/memory-m6-sqlite.test.mjs — 1 passed, 0 failed

Later implementation commits changed hour-bucket pressure and pre-queue suppression. The above is NOT evidence of passing at the final implementation SHA; final-head CI must be checked separately. No local Node or GTA run, Luna provider call or native physical receipt was performed.

Reproduction:

~~~sh
node --check lsa-shared-brain/src/memory/m6CursorConsumer.mjs
node --check lsa-shared-brain/src/memory/m6Coordinator.mjs
node --test lsa-shared-brain/tests/memory-m6-completion.test.mjs
node --test lsa-shared-brain/tests/memory-m6-cursor-lifecycle.test.mjs
node --test lsa-shared-brain/tests/memory-m6-sqlite.test.mjs
~~~

## Remaining blockers / K integration edits

1. B must implement the above durable cursor read/ack interface and unified backfill in the one P2 SQLite source. The old real SQLite fixture is explicitly legacy-only; strict mocked cursor tests are NOT proof of real B transactions.
2. K alone changes bootstrap.mjs, essentialGlue.mjs, runSequentialTurn.mjs and integrationPorts.mjs to instantiate the coordinator AFTER authenticating A/B native owner/timeline and to schedule scene-close, idle, resume/restart handlers. Never run on native game fiber, player-turn priority or bypass PS6 Director.
3. B/K must run a real-SQLite 2,500+ source backlog, all crash boundaries, privacy races, cross-owner/protagonist/timeline migration and true reconnection tests using Agent B's actual schema. M6's mocked transaction CAS is not a real WAL/cross-process receipt.
4. K/M7 must ensure queued jobs that become forgotten/corrected are not sent to Luna; source privacy must be rechecked at lease and model-send boundaries.
5. Combined original-host packaging, PS4 knowledge frame, M5 command UX, M3 native PS2 proof, M9 Director callbacks, M0 S01-S10 end-to-end trace, 4-hour/three-NPC soak and controlled GTA remain unverified.

**Never interpret this handoff as GTA acceptance, deployment permission, or permission to merge main or make paid requests.**
