# PS3 deterministic salience

Status, October 5, 2026: **corrected implementation is merged into main and hash-deployed in shadow; live PS3 evaluation and JSONL persistence were verified in GTA, while structured behavioral acceptance and the controlled native-damage callback probe remain pending**.

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

Companion coverage is `lsa-essential-e1-candidate/tests/salience-engine.test.mjs`, included in `node tools/runTests.mjs`. The convergence audit found that this test file previously declared `const replay` twice, causing a syntax error that prevented 60 later test files from loading while the summary still looked green. The duplicate binding is fixed, acknowledgement/stale-key tests were added, and `runTests.mjs` now converts test-module import failures into explicit failed tests while continuing discovery. The corrected companion suite passed **387 tests across all 36 discovered modules, with 0 test failures and 0 module-import failures**. The native offline matrix passed all 12 suites (979 assertions). The source-pinned candidate build passed with 48 patches; its manifest lists PS0–PS3, keeps the default mode `off`, and keeps player speech gated. No production native source changed; the current-main runtime test project now includes its existing input-interception sources so the lifecycle suite compiles and runs.

## Local shadow deployment

The corrected 73-file overlay was deployed on October 5 after a full hash-verified rollback backup. The latest telemetry refresh copied nine files and 64 already matched; all 73 installed files match the candidate SHA256 manifest. The other 29 files in the backup scope—including live configs, `.env`, data, and logs—remain hash-identical to the pre-deployment backup. No files were removed.

The installed intelligence mode is `shadow`; player-speech witnessing remains disabled because there is no source-time capture receipt. The game, RAGE Plugin Hook, and LSA server were stopped during deployment. GTA was not launched. The local staging receipt and backup manifest contain per-file hashes.

## JSONL shadow telemetry

The existing console `[PS] companion_shadow` report is still produced on its existing **10-second cadence** after the intelligence hello has initialized. A scalar-only projection is also persisted through E4 observability to the server's normal rotating JSONL files. The October 5 GTA session verified 13 persisted samples at approximately the expected cadence:

```text
<LosSantosAliveServer>/logs/e1-run-<UTC>-<runId>.jsonl
```

The persistent records are:

- `intelligence_status` with `data.stage` = `connecting`, `connected`, `initialized`, or `disconnected`.
- `companion_shadow` with bounded transport counters; explicit retained-history count/high-water/eviction/skip diagnostics; lifecycle reset reasons; native drop/stale counts; separate ped/player/vehicle damage-callback totals; PS2 `correlated`, `witnessed`, `duplicates`, `dropped`; PS3 `decisions`, `urgent`, `eligible`, `staged`, `suppressed`, `faults`; selected bounded salience-reason counters; and `finalSnapshot` on the disconnect summary.

Only explicitly whitelisted scalar counters cross this persistence boundary. Capabilities, dialogue, accepted speech text/transcripts, credentials, profile contents, memories, and arbitrary nested report data are not persisted by these records. The E4 sink remains passive: telemetry callback, serialization, queue, rotation, or write failures are swallowed/contained and cannot change intelligence acceptance, salience decisions, native behavior, or gameplay.

To verify initialization on a live shadow run from the server directory:

```powershell
$log = Get-ChildItem .\logs\e1-run-*.jsonl | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $log.FullName -Pattern '"event":"intelligence_status"','"event":"companion_shadow"'
```

A healthy connection should show `connecting` -> `connected` -> `initialized`, followed by `companion_shadow` records roughly every 10 seconds while the channel remains initialized. A close/restart should add `disconnected`; reconnect attempts begin again with `connecting`.

To verify salience activity without inspecting dialogue, trigger an ordinary supported PS2 event such as companion damage or witnessed gunfire and compare successive `companion_shadow` records. `ps3Decisions` should advance; the relevant `ps3Urgent` / `ps3Eligible` / `ps3Staged` / `ps3Suppressed` and selected reason counters may advance according to the existing salience policy, while `ps3Faults` should remain zero. PS2 correlation/witness counters should advance independently. `retainedSignals` is diagnostic history, not a work queue: history pressure may rotate or skip retained copies but must not reject valid input before PS2/PS3. Harmless history ageing is counted separately from input `expired`. PS2 and PS3 counters are process-cumulative across intelligence reconnects so their relationship remains interpretable. Player-speech hearing remains gated off by the existing unsupported-capture-receipt rule and this logging change does not alter that path.

## GTA validation still open

1. Enable intelligence shadow mode only. Confirm no new Luna turn, memory file write, action, or playback interruption during damage and gunfire.
2. Record sanitized `ps3` counters from the companion shadow report: decisions, urgent, eligible, staged, suppressed, faults.
3. Confirm a companion who is shot produces an urgent self-danger decision while native reflex still owns movement.
4. Confirm a repeated burst does not keep the urgent response after the first revision, and that a later death revision can become relevant again.
5. Confirm live shadow does **not** emit `relationship_close`, `relationship_conflict`, `prior_memory`, or `trait_policy` until an authenticated captureRef/profile binding seam is added. Recognized-vs-backend-only behavior is an offline PS3 gate today.
6. If a driver flag is supplied by a later adapter, routine nearby presence stays omitted while vehicle impact does not.
7. Run the controlled native damage probe: record `pedDamageCallbacks`, `playerDamageCallbacks`, and `vehicleDamageCallbacks`; cause one isolated player hit, one tracked-NPC hit, and one vehicle damage event; verify the corresponding counter changes before diagnosing or changing the DamageTracker subscription path.\n8. Confirm retained-history eviction/skip counters can rise under a synthetic or long-session storm without `dropped` increasing solely because diagnostic history is full.\n9. Player speech remains disabled until a source-time capture receipt exists. Do not treat post-STT text as hearing.
