# Agent F — M7 Luna cloud curation completion handoff

**Base:** PR #61 exact commit `c26948cacf2e00b076ec1b71fb1af6f8cf1962c9`.
**Branch:** `feature/memory-completion-f-m7-luna-20261011`.
**Scope:** M7 worker, SQLite curation queue/ledger/appraisal reader, queue contract,
Essential cloud bridge, opt-in idle scheduler, mock-only regression tests and CI.
**Not deployed. No billable request performed.**

## Public adapters for Agent H

- `createEssentialLunaCurator(config,{fetchImpl})` from
  `lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs`:
  injects existing OpenAI `requestJson` transport, requires the selected
  `openai` provider and an existing *Luna* reasoning model; does not initialize
  background work or make API requests on import.
- `createEssentialM7Scheduler({config,store,queue,ledger,mode,cloudOptIn,isIdle,
  fetchImpl,ownerId,now,onError,maxBatch,estimatedMaxCostUsd,leaseMs,
  maxProviderMs,maxAttempts,intervalMs,minIntervalMs})`: **default OFF**,
  no eager cloud provider in off/shadow, no auto-registration.
  `scheduler.checkpoint({characterId})` executes one bounded, idle-only,
  promoted-character-isolated unit; `start({getIdleCharacterId})` optionally
  schedules periodic checks; `cancel()` aborts current work;
  `setMode('experimental',{optIn:true})` is required for cloud use;
  `stop()` cancels and shuts down.
- `createIdleCurationScheduler(...)` in shared-brain for future RAGE host
  parity. The scheduler fences on active timeline, authenticated host run,
  native epoch, current P2 character and actual idle state at every awaited
  worker boundary. The store's own M1 `withTimelineWrite` fence is final
  authority for all persistent queue/ledger/appraisal changes.
- Existing `createDurableCurationAdapters(store,{dailyUsd,monthlyUsd})` in
  `integrationPorts.mjs` is unchanged. Supply its `queue` and `ledger`
  to the Essential scheduler. **Agent H must wire it explicitly** in host
  bootstrap and honor cloud-data consent; no live hook is installed here.
- `readCurationAppraisals(db,{characterId,timelineId,protagonistKey,limit},
  worldProfileId)`: read-only P2 SQLite helper for future M8/PS4 integration.
  Produces `epistemicStatus:'character_opinion'`, immutable source links,
  original factual digest and separate `opinion`; returns zero items after
  source suppression or across protagonists. H must wrap it through the
  serialized P2 read port; this branch does **not** edit locked P2 store.
- `reconcileCurationBudgets(db,{beforeUtc,worldProfileId})` conservatively
  settles unresolved reservations at the charged ceiling. H may provide an
  administrative maintenance port; never release uncertain transport spend.
  The ledger remains in the single P2 SQLite database.

## Queue / billing invariants

1. Job `jobId=proposalId`, immutable deterministic proposal, source IDs
   and triple scope are validated. Explicit player memories are not queued.
2. Claim is transactional, bounded to 4 and optionally filtered to one
   promoted character. Expired leases can be re-claimed on process restart.
   Missing, corrected, deleted or superseded evidence is failed closed into
   a durable dead letter instead of sent to the provider.
3. Completion rechecks source authorization and active CAS lease expiry
   **within the same SQLite transaction** as appraisal persistence and
   acknowledgment; stale/foreign tokens are rejected. Failure does not
   replace a deterministic fact or erase the journal.
4. Error/Retry-After backoff is bounded, attempt counts are persistent and
   max-attempt jobs stay inspectable in the existing dead-letter state.
5. Budget reserves durable daily/monthly maximum estimated USD **before**
   cloud transport. Cancellation/failure/timeout/crash after uncertain
   transport conservatively settles or retains the entire ceiling; successful
   responses may settle a lower amount only with actual provider token usage
   and explicitly configured price-per-million-token values for that model.
   Prices are never guessed; no false claim of actual invoice cost.
6. No different NPCs share a cloud batch. Invalid responses are rejected
   before any memory commit. Partial commit errors leave already-completed
   appraisals intact and retry only incomplete leases.
7. Off and shadow do not lease, reserve or call cloud. Experimental requires
   an explicit positive opt-in, authenticated native epoch and idle proof.
   The scheduler never runs in a dialogue-turn hook by itself.

## Constraints and H integration obligations

- M7 is implemented behind an **unregistered, opt-in** host adapter. H must
  wire scene-close and idle checkpoints, the verified owner binder, and
  necessary P2 read/maintenance port wrappers; no Essential bootstrap, P2
  store, `integrationPorts.mjs`, PS4/C-04 or deterministic M6 code was edited.
- Confirm the chosen Luna model's effective input/output price and bounded
  request token limits before authorizing any expense. USD limits are
  reservations, not the OpenAI billing dashboard.
- After H integration, verify cloud-data consent UX, actual save/load epoch
  transition handling, provider outages/Retry-After under load, privacy
  propagation into M8/PS4, four-hour multi-NPC soak, native receipts and
  controlled GTA playtests. None are certified by offline fixtures.
- The queue's existing v4 schema is retained; no independently deployed
  database, local model, embeddings or GPU budget.
- Source events still rely on M3's eventual authenticated owner/coverage
  completion. M7 does not invent any perception or witness signal.

## Tests and CI

`.github/workflows/memory-m7-completion.yml` runs Node 22/24 on Windows
and Ubuntu, module syntax checks, `memory-m7-completion.test.mjs`,
`memory-agent-e.test.mjs` and integrated P2 SQLite tests. These use only
offline/mocked transport; no Luna billable test calls.
**CI exact-head results must be inspected separately; this handoff alone is
not an acceptance receipt.**
