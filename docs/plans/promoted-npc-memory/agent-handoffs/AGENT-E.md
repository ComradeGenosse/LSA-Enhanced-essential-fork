# Agent E — M6 deterministic permanent memory and M7 cloud Luna groundwork

**Branch:** `feature/memory-agent-e-m6-m7-curation` (from verified M1 `1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`). **Status:** independent source implementation and offline fixtures only; not merged, not installed, not GTA-accepted.

## Files and authority

- `lsa-shared-brain/src/memory/evidence.mjs`: validates scope and qualified source, derives stable UUIDs and evidence-only fact digests. No direct game observations or native authority granted.
- `selection.mjs`: `selectAutomaticMemories(rawM2M3Records, {existingInHour,softTargetPerHour,batchId,minScore})`. Returns v1 `curation_proposal` payloads **only**. Accepts committed player/NPC dialogue with strict delivery status and witness-qualified events; never independently creates source records. Groups by promoted owner/world/timeline, approximate 90-second scene continuity and available epoch; max 64 source records per scene/proposal. Stable IDs make repeated selection idempotent. Does **not** guarantee storage or journal completeness.
- `consolidation.mjs`: `consolidateCandidates(existing,incoming)` yields `insert`, `link_duplicate`, or `preserve_explicit`, with unioned immutable source links (max 64), plus optional CAS revision. Only precisely matching normalized summaries, class and scopes link. Do not delete either raw journal record or an authored manual note.
- `queueContract.mjs`: `makeQueueJob(proposal,nowUtc)`, `validateCurationJob`, `retryDelayMs`, `requireDurableQueueAdapter`. Pure interface, **no migration, SQL tables or physical queue** (reserved for Agent A/integrator).
- `lunaCurator.mjs`: `createLunaCurationAdapter({requestJson,config})` reuses existing cloud reasoning model; `processIdleCuration({enabled,queue,provider,ledger,ownerId,nowUtc,maxBatch,estimatedMaxCostUsd,leaseMs,maxAttempts,signal})` handles bounded off-turn leases and attempts; `validateLunaAppraisal` never lets Luna replace the deterministic factual summary or evidence IDs.
- `lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs` wraps **existing** `src/openai/request.mjs` `requestJson`, `reasoningKey`, `reasoningBaseUrl` and `reasoningModel` (`gpt-6-luna` configured today). Does not register a live task or turn hook. Standalone should use its existing cloud request adapter against the **same shared-brain** interface rather than copy these modules.
- `lsa-essential-e1-candidate/tests/memory-agent-e.test.mjs` and `.github/workflows/memory-agent-e.yml` provide mock-only offline Node 20/24 Windows/Linux checks, not proof of in-game integration. No new local model, embedding, process or VRAM usage.

## Evidence/fun algorithm

All qualifying dialogue and PS2 observations must first land in **M2/M3 journaling regardless of selection**; rejected curation is not dropped source data. First reject invalid scope, unverifiable observation, unavailable direct claim or NPC speech lacking playback completion. Dialogue is labeled `Player said:` / `NPC said:`; a character's words are not verification of a GTA action. Reported claims explicitly read `Reported`; directly witnessed claims read `Observed`. The digest is constructed from qualified event/claim labels and durable subject keys; it intentionally avoids inventing locations, vehicles, clock time, motives or missing witnesses. Archive exact quotes via M2/M4, **not** these limited digests.

Score tags: jokes/pranks/humor (~.92), odd crashes/rollovers/stunts (~.87), embarrassment/mistakes (~.84), relationship bonds/promises (~.77), chases/combat (~.69), ordinary movement (~.43), otherwise low. Multiple independent records in a scene earn a small bonus. Player statements such as "That was hilarious" trigger a reported-dialogue memory without asserting what actually happened. Default minimum .56; `existingInHour` makes the threshold rise gently after ~6 automatic memories per co-present hour, never above .84. **Exceptional score >= .86 bypasses the soft pressure**, so there is no six-per-hour cap. Explicit player-requested memories stay in Agent D's separate path and are neither ranked nor delayed here.

A deduped scene's `proposalId` and `batchId` are content-derived UUID-v4-shaped stable keys. The factual digest is immutable once proposed; later interpretation can link as a separate proposal/revision. When two matching auto memories consolidate, append source-link IDs transactionally with a CAS revision, never rewrite the underlying evidence. When source links exceed 64, retain separate memories rather than discarding provenance. The parser ignores unverifiable inputs for curation; caller should report those separately for diagnostic/source coverage, never treat their absence as proof nothing happened.

## Durable queue adapter handoff to Agent A / integrator

Agent E intentionally does **not** modify M1 or Agent A SQLite schema. Implement queue, automatic episode and Luna appraisal tables as an additive migration in the existing **one P2-owned SQLite store**. Persist proposal snapshot, unique job ID, triple scope, attempt count, due UTC, lease token/owner/deadline, state, error code, created/updated UTC, append-only evidence links and idempotent cost reservation/settlement ledger. Keep original normalized source records immutable.

All queue persistence must be synchronous durable SQLite transactions (single writer, WAL/FULL semantics), with `withTimelineWrite(timelineId, synchronousCommit)` at the actual serialized commit boundary. Never queue against ambiguous save lineage, mismatched world, disconnected/unconfirmed native epoch, or an unknown character. Claim and complete must CAS `jobId + leaseToken + scope` and fail closed on stale/foreign leases. Expired leases may become due again after a restart, without deleting content. `completeLeased` must atomically insert a validated `curation_proposal` (or verified idempotent replay) **and** mark job `completed` before returning: only then may later UX say the appraisal was saved. Explicit memory command acknowledgements remain exclusively Agent D's responsibility.

Required adapter methods:
```js
queue.enqueueIfAbsent({job}) // unique jobId; transaction durably commits
queue.claimDue({limit, nowUtc, leaseUntilUtc, ownerId}) // [{job:{...state:'leased'}, leaseToken}]
queue.completeLeased({jobId, leaseToken, proposal}) // verify scope+lease, append then ack atomically
queue.retryLeased({jobId, leaseToken, attempt, nextAttemptAtUtc, errorCode}) // CAS, or dead_letter
queue.releaseLeased({jobId, leaseToken}) // release/cancel; CAS
ledger.reserve({batchKey, maxUsd, nowUtc}) // durable per-day/per-month user spend limits
ledger.settle({batchKey, maxUsd}) // conservatively settles spent ceiling; idempotent
ledger.release({batchKey}) // for proven zero-transport cases only
```
Ensure `claimDue` never returns a row with a different timeline or inactive character. Make expired lease recovery and retries transactional; dead-letter jobs are inspectable/replayable rather than deleted. The interface carries **no real SQLite implementation yet** and does not claim restart tests against a real database.

## Luna worker controls and trust

Worker defaults to `enabled:false`. Caller chooses an idle/scene-close checkpoint **off the dialogue turn**, gives it an abort signal, and supplies the established E1/OpenAI request transport; max four proposals per batch, bounded timeout/tokens and cancellation. Before any call, durable ledger must reserve the maximum estimated spend and enforce explicit configured daily/monthly caps. This is an estimate, **not a measured OpenAI cost**; wire exact usage reconciliation after responses when available. Failure/rate limit sends a bounded exponential delay (honor Retry-After); cancellation releases leases. Late/stale/invalid proposals never bypass source checks. The deterministic selected memory exists independently of Luna and is recallable when M4 integrates it; zero cloud availability must not interrupt M2/M3 writes, recall or player conversations.

Luna may rank, choose `episode|semantic|relationship|joke` and express a subjective `inCharacterTake`, **not** change `groundedSummary`, IDs, character, world, timeline or factual observations. Returned interpretations require an M8 renderer treating them as **unverified character opinion**. No M8 personality mutation, spontaneous Director callback or automatic GTA action is installed here.

## Integration plan without multi-agent live coordination

1. Agent A (M2) exposes committed journal lines and event-adapter read surfaces and the durable queue/automatic-memory tables. Agree on `journal_event`/`dialogue_line` envelopes from `contracts/memory.v1.json`, not guesses based on existing profile v1 notes.
2. Agent B (M3/M9) supplies witnessed event envelopes from PS2; no M6 trust on unstamped proximity or NPC narration. Optionally add source-qualified `sceneId` metadata without changing v1 logical envelopes until a contract revision is agreed.
3. Integrator adapts M2/M3 rows to `selectAutomaticMemories` at scene close/idle checkpoints, passes actual per-NPC co-present-hour automatic memory count, dedupes and durably persists outputs under M1 timeline gate, then enqueues a curation job when cloud curation is configured. **Do not gate deterministic memory save on Luna**.
4. Agent C (M4) adds a permanent-memory journal adapter and fetches immutable source links. Do not let these digest strings override verbatim quote retrieval.
5. Agent D (M5) owns explicit remember/correct/forget, separate priority/path and durable acknowledgement.
6. M8/PS6 can eventually consume optional `inCharacterTake` as marked opinion after explicit safety/Director policy. Do not claim these are deployed.

## Known limits / unimplemented acceptance

- No shared SQLite migration, queue/ledger backing tables or real atomic save/ack; no live M2/M3 source wiring, per-hour attendance counter, cross-restart DB replay, memory editor integration, M4 recall attachment, M8 personality dynamics, PS6 spontaneous callback or GTA validation.
- Scenes are approximate 90-second groups when a stronger scene ID is absent. No semantic embeddings: conservative duplicate detection can leave near-duplicates, which is safer than merging distinct incidents.
- `inCharacterTake` is separately marked as unverified opinion by its field name but no semantic proof of every subjective word is possible. M8 must not convert opinion to facts.
- Notability keyword scoring is deliberately deterministic and English-oriented, with no claim to understand player intent or exhaustive GTA event types; future calibration needs real fixture captures.
- Provider errors may consume tokens after transport begins: spend ledger conservatively settles the reserved ceiling, pending more accurate usage reconciliation. Runtime caller must not enable cloud calls without user authorization and a configured budget.
- Exact-head CI results, when available, are the source of test pass claims. Source-only checks never mean installed GTA behavior.
