# PRODUCTION-W09 — Source-bound replay and pinned acceptance handoff

Status: **PARTIAL IMPLEMENTATION / A09 BLOCKED / A10 BLOCKED / GTA NO-GO**.
Owner: T9. Baseline: PR #94 **0201731973a1c02a8852271897e2c8df420396b9**.
Feature branch: `feature/memory-k-t9-integrated-replay-harness-20261011`.
Draft PR base: `integration/memory-closure-final-k-20261011`.

## Delivered real code and its boundary

- `lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs` — **real P2 SQLite production imports**, test-only PS2 source fixtures, the P2 single writer, source-qualified event sidecars, actual replay cursor CAS, 205 accepted lines and 2,501 distinct sidecar-backed event records across two promoted characters. Distinguishes all four protagonist keys, committed readbacks, 127-row pages, restart/cursor durability, pre-ack crash replay and post-ack restart, Unicode byte equality, host changes/clock regression, two-observer exclusion, privacy trash and seven-day purge. This is an **isolated source simulation**, not a replay from the original Essential accepted C-01/native/PS6 producers.
- `tools/memory-sim/closure-acceptance-replay.mjs` — exact checkout SHA, Node 24, source hashes, P2 test execution, and ten independent **hard-failing** source-bound M0 scenario slots. Each scenario requires an executable original-runner+P2 integration test, a real process exit zero, and a verifiable machine receipt from the same checkout. Per-case scenario receipts, error logs, and specific missing-source diagnoses are written even when the acceptance job fails.
- `tools/memory-sim/closure-native-producers.v1.json` — explicit four-producer C-01/M3/M7/M9 native production compile inventory. All four lists intentionally EMPTY until K audits the actual merged T1/T2/T7/T8 source files; empty inventories hard-fail A09. K must enter only real `native/` source paths present in the main `PromotedCharacters.csproj` `<Compile Include>` list, not harness-only source modules or guessed class-name markers.
- `tools/memory-sim/verify-pinned-production.mjs` — verifies the pinned original Essential backend and DLL hashes, 70-AST-hook build output, manifest hashes, staged real runtime and P2 memory module hashes, main production native project **Compile Include** entries and actual production compilation. Runs native policy/ABI harnesses separately; compilation of a test-only source does not count as compiled production source.
- `.github/workflows/memory-k-w09-integrated-replay.yml` — separate Node 24 Windows/Linux source-simulation and fail-closed S01–S10 jobs, Windows pinned AST/native production build audit. Uploads receipt JSON as CI artifacts on failure. Does **not** edit K's original workflow.
- This handoff. K-exclusive runtime/glue, native global registration, central report and existing final CI are unmodified. `tools/memory-sim/scenarios.v0.json` remains entirely `implemented:false`.

The test intentionally asserts that the currently pinned P2 store has **no** M6 checkpoint adapter. T6/K must replace this expected-negative test with its positive production-cursor replay after the real source implementation is integrated; do not delete the negative or switch to `allowLegacyBoundedReplay` to manufacture A06.

## Runnable offline commands (repo root; Node **24**)

```powershell
node --check tools/memory-sim/closure-acceptance-replay.mjs
node --check tools/memory-sim/verify-pinned-production.mjs
node --check lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs
node --test lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs
node tools/memory-sim/closure-acceptance-replay.mjs --source-sim
node tools/memory-sim/closure-acceptance-replay.mjs
Push-Location lsa-essential-e1-candidate
npm run build
Pop-Location
node tools/memory-sim/verify-pinned-production.mjs
```

Linux shell: the same `node` invocations; replace `Push-Location` / `Pop-Location` with `( cd lsa-essential-e1-candidate && npm run build )`.
Additional isolated original native commands:

```powershell
dotnet run --project tools/essential-abi/EssentialAbi.csproj --configuration Release
dotnet run --project native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj --configuration Release
dotnet run --project native/intelligence/m9-tests/M9NativeTests.csproj --configuration Release
dotnet build native/intelligence/integration-tests/IntegrationTests.csproj --configuration Debug
dotnet build native/intelligence/director-tests/DirectorTests.csproj --configuration Debug
dotnet build native/promoted-characters/PromotedCharacters.csproj --configuration Release
```


Receipt paths are `artifacts/memory-k/w09-receipt.json` and `artifacts/memory-k/w09-pinned-package-receipt.json`.
Every receipt contains the checkout SHA. Verify CI job run IDs and full steps, not just a green badge or a PR handoff. The new scripts have **not** been run against a live GTA installation or any real user/API context. No local source checkout or native build is assumed by this handoff.

## Original M0 coverage matrix

| Case | Current verified test coverage | Remaining exact original-runner integration gate |
|---|---|---|
| S01 | Actual SQLite exact-byte Unicode/profanity, dedupe, reboot | Original C-01 accepted typed/STT hook to M2 readback under real runner |
| S02 | 2,501 event-sidecar stress, routine firing fixture | Actual source-time qualified event, 180+ seconds, PS3 exclusion, real M4 recall |
| S03 | Two distinct promoted SQLite owners; no cross-observer memory | Real native source-time certified witnesses / unknown negative distinction |
| S04 | P2 readback/privacy primitives | W03 accepted commit -> W04 M5 ambiguous clarification and no false acknowledgment |
| S05 | SQLite committed evidence and M6 negative adapter gate | W06 atomic cursor, W07 native idle + consent + Luna offline and budget recovery |
| S06 | Multi-owner same baseline read isolation | W05 real one-PS4-frame personality interpretation with same committed facts |
| S07 | Actual P2 write suspension on source regression/host change and reconfirmation | Original native game clock / timeline/source events through original runner |
| S08 | Identity source fixture and per-owner no-leak paths | W02 native source-time prepromotion 120-second admission and exclusion |
| S09 | Exact persisted dialogue and replay suppression primitives | Original accepted STT correction chain with M5 overlay and M4 send suppression |
| S10 | Original producer source presence checked | W08 authentic event -> PS2 -> PS3/PS6 original Director cooldown/player priority |

All **S01–S10 still BLOCKED at A10**. An isolated direct module test passing does not prove a complete original game turn was accepted, spoken or source-attested.

## Machine-readable original-runner receipts for K

For each `S01` … `S10`, integration must add a distinct real source test:
`lsa-essential-e1-candidate/tests/memory-k-original-Snn.test.mjs`.
It must import the original `runSequentialTurn` or runtime `createRuntime` **and** the actual P2 SQLite store, assert persisted readbacks, enforce tested negative cases, and print exactly one line prefixed `@@MEMORY_K_W09_RECEIPT@@` followed by JSON:

```json
{
  "scenarioId": "S01",
  "headSha": "<exact checkout git rev-parse HEAD>",
  "phase": "original_runner_integrated_source_simulation",
  "result": "pass",
  "runnerInvocations": 1,
  "durableSqliteReadbacks": 1,
  "originalRunnerSourceSha256": "<sha256 of original runSequentialTurn.mjs>",
  "p2SourceSha256": "<sha256 of shared SQLite store>",
  "sourceProducerReceipts": []
}
```


The verifier executes each test and checks process success, final SHA, source hashes, actual test imports, nonzero original runner invocations and durable readbacks. K must inspect full exact-head logs, source producer authenticity, source-time evidence and the acceptance contract before marking any manifest item implemented. The verifier does **not** accept a copied fixture or JSON alone as proof.

## Missing/blocked gates and K integration instructions

1. **A01–A03:** authenticate original normal C-01/player input and source-time native owners; K must wire real accepted/terminal adapters into the original runner. The baseline currently uses an older M2 capture binder.
2. **A04–A05:** wire the real durable accepted-command gate and single PS4 frame, revalidated on retries. Replays must prove that ambiguous commands and corrected/deleted sources never become model context.
3. **A06:** T6 must provide the transactional M6 `readM6Checkpoint/readM6JournalPage/ackM6Checkpoint` adapter. Current B P2 replay cursor is not this atomic interface. Keep the negative test until positive crash points pass.
4. **A07–A08:** genuine compiled original native idle/gameplay producer, consent/budget/queue recovery and PS6 cooldown/player-priority callbacks are prerequisites. Simulated quiet/current flags are insufficient.
5. **A09:** ensure pinned original binaries are accessible to CI, populate `tools/memory-sim/closure-native-producers.v1.json` with audited T1/T2/T7/T8 main-project source paths, build exact AST patch, compile registered native **production** modules, and inspect Windows/Linux test steps. Missing host references or unavailable pinned metadata is BLOCKED, not passed.
6. **A10:** implement all ten independent original-runner test files, expand source fixture matrix to late/duplicate playback receipts, recycled ped handles, corrections, prepromotion, crash windows between SQLite commit/cursor ack/curation queue, source hashes and cost/queue failures. For every case verify exact final SHA and the source receipt. Re-run on K's reconciled final integration head, not this specialist feature head.
7. **A11/GTA:** entirely separate K decision. No physical GTA assertion, GTA install, main merge or paid API call.

## Verification disclosure

Source modifications were created through the connected GitHub repository. The execution environment did not have a cloned repository, networked git or .NET runtime to execute Node 24 + native harnesses locally. Do **not** classify these tests as locally passed. CI job results and artifacts (once GitHub publishes them) are authoritative for what executed. Every pending/failed gate must remain visible. The precise final feature head must be taken from the draft PR after this handoff commit.
