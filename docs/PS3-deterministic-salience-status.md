# PS3 deterministic salience

Status, October 5, 2026: **corrected implementation reconciled on local staging; full offline verification and production candidate build passed; local shadow deployment is the next gate; physical GTA validation and GitHub merge remain pending**.

PS3 ranks PS2 observations. It does not create turns, actions, memories, playback changes, or native authority. `urgent` means the observation outranks other candidates. Reflex and self-preservation remain native.

The decision shape is `observationId`, `revision`, `decisionKey`, `policyVersion`, `context` (`omit` | `candidate` | `must_include`), `memory` (`none` | `stage`), `response` (`none` | `eligible` | `urgent`), at most four reason codes, and `expiresAtMonotonicMs`. `decisionKey` is grant-attempt-specific so a stale acknowledgement cannot consume a later re-grant.

`memory: 'stage'` is a label for a later writer. This phase does not open the profile store. `response` does not select a speaker.

## Bounds

- 256 cached decisions, 32 per observer.
- 1,024 reaction-ledger entries, 10-minute TTL.
- A full ledger refuses new non-urgent grants. Forgetting a grant is not a way to react again.
- Same revision and non-escalating later revisions lose reaction and memory entitlement.
- A higher severity, or a new `dead` / `attack` claim, may earn entitlement again.
- Explicit bindings with `recognized: true` are the only social identities. A backend CharacterId is not a relationship.
- Trait policy accepts only a whole trait equal to `protective`, `cautious`, `loyal`, or `bold`.
- The shadow adapter passes `activity: 'unknown'` because the anchor roster has no activity evidence. Callers can pass `idle`, `driving`, `passenger`, or `in_vehicle` when supported by a trusted situation source.
- Live shadow currently has no authenticated `captureRef → CharacterId/profile` binding. It therefore does not supply relationship, memory or trait-policy context; those branches are implemented and covered offline only.
- Recognition requires an explicit `recognized: true`; a missing flag is treated exactly like `false`.
- Suppression capacity fails closed for response/memory entitlement instead of evicting a prior grant. The latest-decision diagnostic cache is bounded with the decision cache.
- A response grant is now an **entitlement**, not consumption. `acknowledge(decisionKey, consumer, delivered|rejected|expired)` records consumer outcome; only a delivered PS6 response consumes response entitlement. Rejected/expired grants may be re-issued with a fresh `decisionKey`.

## Checks

Companion coverage is `lsa-essential-e1-candidate/tests/salience-engine.test.mjs`, included in `node tools/runTests.mjs`. The convergence audit found that this test file previously declared `const replay` twice, causing a syntax error that prevented 60 later test files from loading while the summary still looked green. The duplicate binding is fixed, acknowledgement/stale-key tests were added, and `runTests.mjs` now converts test-module import failures into explicit failed tests while continuing discovery. The corrected companion suite passed **384 tests across all 36 discovered modules, with 0 test failures and 0 module-import failures**. The native offline matrix passed all 12 suites (979 assertions). The source-pinned candidate build passed with 48 patches; its manifest lists PS0–PS3, keeps the default mode `off`, and keeps player speech gated. No production native source changed; the current-main runtime test project now includes its existing input-interception sources so the lifecycle suite compiles and runs.

## GTA validation still open

1. Enable intelligence shadow mode only. Confirm no new Luna turn, memory file write, action, or playback interruption during damage and gunfire.
2. Record sanitized `ps3` counters from the companion shadow report: decisions, urgent, eligible, staged, suppressed, faults.
3. Confirm a companion who is shot produces an urgent self-danger decision while native reflex still owns movement.
4. Confirm a repeated burst does not keep the urgent response after the first revision, and that a later death revision can become relevant again.
5. Confirm live shadow does **not** emit `relationship_close`, `relationship_conflict`, `prior_memory`, or `trait_policy` until an authenticated captureRef/profile binding seam is added. Recognized-vs-backend-only behavior is an offline PS3 gate today.
6. If a driver flag is supplied by a later adapter, routine nearby presence stays omitted while vehicle impact does not.
7. Player speech remains disabled until a source-time capture receipt exists. Do not treat post-STT text as hearing.
