# M6 completion — deterministic permanent memory coordinator

**Base:** PR #61 exact commit `c26948cacf2e00b076ec1b71fb1af6f8cf1962c9`.  
**Branch:** `feature/m6-completion-deterministic-coordinator-20261011`.  
**Ownership:** evidence, scene selection, conservative consolidation, new `m6Coordinator.mjs`, M6 tests and CI. No edits to integrated SQLite, curation SQLite, Luna curator, Essential turn runtime or scheduler.

## Delivered

- **Committed evidence only.** `createM6SelectionCoordinator` rereads exact M2 dialogue and M3 witnessed events from the active P2 SQLite journal. M3 evidence must round-trip through `readVerifiedEventEvidence` and match its immutable journal source hash. Player text remains a *reported utterance*, never independent proof of a GTA fact. NPC speech requires completed playback; missing PS2 sidecars and unknown/inferred claims cannot silently become memories.
- **Deterministic, fun-first selection.** Source-grounded inside jokes, embarrassing remarks, bizarre collisions, rollovers/stunts, relationship promises, rescues, and shared incidents receive weighted notability; mundane dialogue remains in M2 archives without automatically becoming permanent. Scores are deterministic, no resident curator or GPU required. Approximately six per active hour is **soft**, with a gentle pressure threshold and exceptional events exempt.
- **Scene fencing.** Up to 64 immutable source IDs in a scene, default gap 90 seconds, no cross-world, cross-timeline, cross-promoted character, cross-protagonist, incompatible verified epoch or divergent owner lifetime. Interleaved independent protagonist streams do not split each other's scene. Scenes have deterministic IDs derived from sorted source links. Conversation quotes are journal evidence, not rewritten model paraphrases.
- **Duplicate/consolidation rules.** Selection refuses conflicting duplicate source record IDs. Identical proposals replay idempotently. `consolidateCandidates` preserves exact/manual memories, refuses ambiguous duplicate targets and cross-protagonist merges, and proposes append-only link unions only when immutable source IDs overlap and bounds allow; *semantic similarity alone is never evidence that two GTA incidents are the same*. Shared-store CAS provenance-link updates are outside M6-owned files, so this coordinator avoids pretending to perform unsupported in-place merges.
- **Durable deterministic saves before optional curation.** `saveDeterministicMemory(proposal)` persists through PR #61's single SQLite writer, native source confirmation and `withTimelineWrite`. After a successfully persisted proposal, opt-in `enqueueCurationJob` can create a durable M7 job without making a provider request. If enqueue fails after save, the next checkpoint rereads the permanent links, reconstructs the identical source-frozen proposal and re-enqueues it. Provider availability does not gate deterministic persistence.
- **Replay and explicit failure.** Scene-close, idle and recovery scan eligible committed sources, exclude forgotten and corrected evidence, skip only source links already represented by automatic permanent memories, and return rejected-evidence diagnostics. Save/queue errors propagate rather than reporting false success. Timeline suspension stops writes. Explicit player memories do **not** count toward automatic soft pressure or become automatic consolidation targets.
- **CI.** `.github/workflows/memory-m6-completion.yml` checks Node 20.19/24 on Ubuntu and Windows, syntax, new coordinator fixtures, original M6/M7 contract tests, and Node 24 real P2 journal integration.

## Exact Agent H lifecycle wiring contract

Import `createM6SelectionCoordinator` from `lsa-shared-brain/src/memory/m6Coordinator.mjs`. After the P2 SQLite store is initialized, create one coordinator per store:

```js
const m6 = createM6SelectionCoordinator({
  store: p2SqliteStore,
  cloudQueueEnabled: false, // opt in only with user authorization + M7 budgets
  quietMs: 90_000,
  maxRead: 1000,
  softTargetPerHour: 6
});
const scope = { characterId, worldProfileId, timelineId }; // trusted P2 owner binder
```

1. **`await m6.onSceneClose({scope,atUtc,activeHourCount})`:** Call at an authenticated, fully committed scene/encounter close (after accepted player lines, completed NPC playback receipts and qualified PS2 observations have landed in the journal). This includes currently closed-scene evidence through `atUtc`. Optional `activeHourCount` is the actual previous-auto-memory count for the owner's current co-present activity hour; omit if unavailable and the coordinator uses rolling wall-time approximation. Do not call on raw or speculative PS2 events.
2. **`await m6.onIdle({scope,atUtc,activeHourCount})`:** Call periodically only when the dialogue turn and critical native work are idle; defaults to processing evidence at least 90 seconds old, preventing premature mid-scene selection. Calls may be repeated safely.
3. **`await m6.recover({scope,atUtc,activeHourCount})`:** Call on restart/reconnect only **after** verified native run+epoch and user-confirmed active timeline. Resume pending deterministic selection and queued M7 handoff by replaying source evidence and existing permanent links. If native confirmation or timeline is suspended, do not retry in a loop: wait for user reconciliation and call recovery afterward.
4. **Error handling:** Never acknowledge success or clear an external pending flag on rejection. On `m6_timeline_not_writable` pause; on `m6_*_replay_window_exhausted` surface an operational fault requiring the future paginated journal reader; on a transient store/queue failure, retry a checkpoint after health/lineage returns. Rejections in the returned `rejected` array are incomplete evidence **not certified negative observations**.
5. **Lifetime:** Stop scheduling work on owner retirement or timeline change. No stale scope or raw payload is passed by Agent H; build a new trusted scope on reauthorization. The method itself checks the current store's promoted owner, world ID and writable active timeline.

The returned snapshot has `status` (`complete` or `partial_evidence`), `phase`, `cutoffUtc`, `readCount`, `qualifiedCount`, `candidateCount`, `saved` receipts, `queued` and `rejected` diagnostics. Only the underlying SQLite store's checked receipt constitutes durable completion; this is not a user-facing “remembered” command receipt.

## Remaining integration limits (not production certified)

**Bounded replay:** Current PR #61 store exposes only latest-N M2/M3 reads, with no archive cursor or durable M6 scan checkpoint. This coordinator fails closed if either source list reaches its configured max (up to 1,000), or an individual protagonist has at least 1,000 permanent memories. It **does not claim** that >1,000 unread historical entries can be recovered. For full-scale no-loss guarantees, the journal owner must expose paginated committed evidence reads or a durable source-driven cursor in the same P2 store; Agent H must wire an appropriate replay cadence and operational alarm. We have not changed the shared SQLite schema under another agent's ownership.

**No generic CAS link mutation:** The v4 public store has `saveDeterministicMemory` but no append-evidence-revision method. We avoid false claims of cross-proposal in-place consolidation. Distinct independently sourced episodes remain separate; same proposal IDs are replay-idempotent. Add safe CAS append-link API in the owning SQLite phase if required.

**No atomic save-plus-M7 enqueue:** Existing PR #61 APIs are two durable calls. M6 recovery repairs a failed second call when source evidence is still within the replay window; truly unbounded recovery requires the durable source cursor described above. Cloud appraisal remains opt-in and off-turn.

**Live adoption pending:** Agent H still owns scheduler and C-04/PS4 delivery. Native PS2 source binder and M2 playback acceptance are prerequisites outside this PR. No GTA installation, real-world capture or four-hour multi-NPC soak is claimed. Exact-head GitHub Actions results and controlled GTA receipts, not this document, determine deployment readiness.

## Fixture matrix

Mundane banter, accepted player jokes, NPC completion/provenance, reported versus witnessed claims, weird vehicle incidents, relationships and promises, repeated/overlapping versus independent crashes, source replay with reordered rows, interleaved protagonists, temporal/epoch/lifetime fences, late missing sidecars, archived/recovery source gaps, queue-write interruption, forgotten and corrected evidence, suspended timeline, soft pressure and the exceptional-event escape. No cloud calls or local LLM runtime.
