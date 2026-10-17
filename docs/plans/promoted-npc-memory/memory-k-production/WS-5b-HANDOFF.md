# WS-5b handoff — production M3 witnessed-event capture

Branch `feature/memory-k-ws5b-m3-witnessed-capture-20261013`, based on `integration/memory-k-production-20261012` (PR #138).
Findings addressed: K-03(d/e/f), K-13 (write side), D-023, G2/G5, S02/S03.

## Evidence labels

- **OFFLINE TESTED** — everything below. The native named pipe is simulated at the protocol boundary (a fake socket speaking the real `hello` / `anchors` / `observer_index` / `memory_authority` / `signal` frames). The authenticated pipe parser, PS2 runtime and correlator, native memory authority, M3 intake/binder/recorder and the P2 SQLite store are all the real code.
- **GTA UNTESTED** — nothing here has run in GTA. The C# owner-fiber sampler (`MemoryOwnerAuthority.cs`) was read, not changed or compiled. Real owner-frame cadence, jitter, pause behaviour and `memory_authority` publication by K are unverified live.

## What now works

A promoted NPC's witnessed PS2 observation reaches the P2 journal in production:

`IntelligenceClient` (pipe) → `ShadowRuntime`/`EpisodeCorrelator` → accepted-observation tap → `M3BoundedIntake` → `M3ObserverOwnerBinder` → `WitnessedEventRecorder` → P2 `withTimelineWrite` → `event_journal` + `event_source_evidence`.

1. **`profileForAlias` defect (K-03(f))** — fixed. P2 profile rows carry no `worldProfileId`, so the old predicate never matched and no owner could resolve. One shared resolver, `src/memory/livePromotedProfile.mjs`, now serves M3 and D02. It requires a writable timeline, a verified host context and exactly one non-retired profile owning the alias. Anything else resolves to null.
2. **D-023 observation-time attribution (K-03(d/e))** — default mode. At the synchronous tap, the PS observer index, the native owner inspection, current owner evidence and host run / world epoch must all agree for one live profile. Any mismatch writes nothing and increments `unattributed`. The verified identity becomes a single-use ticket (bound to the exact observation and candidate); the commit re-checks the ticket and the P2 write fence. The decision is persisted per row as `attribution` (`decision:'D-023'`, observer index, owner frame, observation tick) inside the sidecar and `sourceHash`. Legacy rows keep stable hashes. `attribution:'source_time'` still demands the strict native source-time ledger.
3. **Production wiring** — `src/memory/m3ProductionMemory.mjs` is the single factory, called by `bootstrap.mjs` (the inline adapter and authority construction was removed). It wires the native authority, adapter, coverage, telemetry, and retirement on host-context and world-boundary change. A failure leaves capture off (fail closed).
4. **Observer coverage (K-13 write side)** — authenticated owner frames become durable per-NPC windows in a new table, `m3_observer_coverage`:
   - Time outside a window is *uncovered*. Windows close on sequence/tick regression, tick gap > 1 s, delivery gap > 3 s (`game_paused`), epoch/stream change, owner absent or changed, timeline change, retire and shutdown.
   - A persisted window end never passes (last sample − 3 s settle), the oldest queued-but-undecided observation, or the oldest unpersisted loss.
   - Observations that were refused, overflowed, retired or failed become point/burst *gap* rows (bursts coalesce).
   - A crashed process's open windows are sealed `process_restart` at their last checkpoint.
   - Read API: `store.readObserverCoverage({characterId, worldProfileId, timelineId, fromUtc, toUtc})` returns `{complete, gaps, windows, coveredMs, basis}`.
5. **Related defect fixed** — `m3_coverage` had `ON DELETE CASCADE` to `promoted_profiles`, and P2 rewrites profile rows on every `edit()`. Every edit wiped all coverage. The FK is removed, with a rebuild migration for existing databases. Character removal now deletes coverage explicitly. `m3-completion.test.mjs` asserted the old cascade; its assertion and comment were updated.

## Tests added (all offline)

| File | Covers |
|---|---|
| `lsa-essential-e1-candidate/tests/m3-ws5b-production.test.mjs` (20) | Resolver; exact identity/incarnation/encounter/world/timeline/ownerProof; attribution verified end to end; isolation between NPCs; idempotent re-offer; D-023 negatives (absent owner, incarnation/encounter mismatch, alias mismatch, stale owner frames, foreign host run/epoch, forged receipt, ambient observer); ticket forgery and replay; write-fence loss; retire/close; pause → durable gap; overflow → durable loss gap; profile edit does not wipe coverage; telemetry names; integrated recall |
| `…/tests/m3-ws5b-stress.test.mjs` (3) | **2,500 events** through the production chain (5 NPCs × 500 single-witness events, with prompt re-delivery); **2,500 observations** from 500 five-witness signals; 80 events across a 30 s pause. Zero duplicates, exact attribution, unbroken coverage, bounded queue. ~25 s |
| `lsa-shared-brain/tests/m3-observer-coverage-tracker.test.mjs` (14) | Window semantics, safety invariant, coalescing, retry/degrade |
| `…/m3-observer-coverage-sqlite.test.mjs` (6) | Legacy FK repair, settle semantics, `process_restart` seal, upsert rules |
| `…/m3-intake-outcomes.test.mjs` (3) | One terminal outcome per queued observation |
| `…/tests/m3-production-harness.mjs` | Shared harness (not a test) |

Existing suites versus the base commit: shared-brain 4 failures before and after (W04×3, W06 A06 — pre-existing); e1 17 failures before and after, identical names; `tests/memory/*` 98/98; `tools/memory-sim` 7/7.

Run: `node --test lsa-shared-brain/tests/*.test.mjs`, then `cd lsa-essential-e1-candidate && node tools/runTests.mjs`.

## Shared-file touches other workstreams should know about

- `lsa-shared-brain/src/memory/sqliteIntegratedRecallProjection.mjs` — one line: the replay identity passes `attribution` through. **WS-6a may touch this file.**
- `src/observability/eventContract.mjs` — registered `memory_m3_intake_loss` and `memory_m3_coverage` (CRLF preserved).
- `sqliteFoundation.mjs` / `sqliteProfileStore.mjs` / `integrationPorts.mjs` — `appendObserverCoverage`, `readObserverCoverage`, and the per-character deletion list.

## Known limits and non-goals

- **Per-observation negative coverage is not produced.** `did_not_witness` rows (`verifyNativeCoverage`) still need a native source-time ledger, which is C# that is not compiled here. This work gives windows and gaps only, so "not covered" and "unknown" are all it can say. No code path claims an NPC *did not* witness something.
- Coverage is not yet in the RecallBundle. WS-6a should consume `readObserverCoverage`.
- Pre-promotion capture (`resolvePrepromotion`) is left to WS-5c, as is K-21 (the native sampler returns null for the whole frame if any one owner fails). The tracker treats such a frame as a gap.
- **Late redelivery fails closed.** D-023 is observation-time, so a re-offered receipt older than ~5 s is refused (`unattributed`) rather than re-attributed from stale owner frames. It also records a conservative gap, because the tracker cannot tell a redelivery from a miss. A prompt re-offer of the same receipt is a clean `duplicate`.
- **Packaging (K-01)** is unchanged and still WS-1's. `m3ProductionMemory.mjs` uses the same `../../../lsa-shared-brain/...` import style as other `src/memory/*` modules, which `stageSharedMemory` does not rewrite for the packaged build. No workflow files were touched.
- Skew limits are 5000 ticks back and 2000 forward between an observation and its owner frame. They are `authorityOptions` and need live tuning against the real sampler cadence.
- Windows are not certified until the 3 s settle margin passes, so the newest few seconds always read as uncovered.

## Needs live GTA verification

- That the native sampler's `memory_authority` frames arrive at ~250 ms and carry the fields this code requires, with the incarnation/encounter ids matching the observer index.
- Behaviour across game pause, save/load and world-epoch change.
- That skew limits and the 3 s settle margin suit real jitter.
- That a promoted NPC actually recalls a witnessed event in dialogue (needs WS-6a).
