# Memory K T9-REPLAY — original M0 source-bound tests and anti-forgery handoff

**2026-10-12 · PARTIAL / A09 BLOCKED / A10 BLOCKED / controlled GTA NO-GO.**

- Repository: ComradeGenosse/LSA-Enhanced-essential-fork.
- Exact source baseline: T9 PR #111 at 00aaa4e3a9a16dc7ac9a97a90155d047e7775baa.
- Specialist branch: feature/memory-k-t9-original-replay-repair-20261012.
- Draft PR base: feature/memory-k-t9-integrated-replay-harness-20261011.
- Plan: PR #113 D04, PR #97 W09/A09/A10, and PR #111 source review.
- K exclusive files were NOT modified: original runSequentialTurn, essentialGlue, bootstrap, P2 production, verify-pinned-production, producer inventory, workflows.
- Current handoff is not a success receipt. All scenarios.v0.json implemented flags remain false.

## Delivered

1. Ten executable original-runner files: lsa-essential-e1-candidate/tests/memory-k-original-S01.test.mjs through S10.test.mjs. Every file invokes *the original production runSequentialTurn* via a shared specialist test probe (memory-k-original-runner-probe.mjs) and creates/reads *actual P2 SQLite*. A deliberately denied native playback / synthetic provider host is employed to test negative execution, NEVER to claim source acceptance. On the pinned baseline, every scenario *explicitly fails* with a descriptive SOURCE_BLOCKED gate. This code is a real-runner execution probe, not a finished ten-case production replay.
2. tools/memory-sim/replay-evidence-verifier.mjs: parent-process, independently collected Node V8 function-entry evidence for actual original-runner and P2 constructor/method execution, read-only SQLite inspection after the child exits, PRAGMA quick_check, actual dialogue/event record IDs, UTF-8 SHA-256 integrity and committed source hashes. It never promotes stdout values or import-string matches.
3. closure-acceptance-replay.mjs now launches each original test in a separate process with a parent-owned temporary P2 database path and NODE_V8_COVERAGE directory, calls the independent evidence verifier, records stdout/stderr hashes for diagnostics only, and fails A10 absent actual source-bound provenance. It checks original runner/P2, test files, harness and verifier file bytes against git show HEAD:path to detect dirty source substitution. The full exact checkout SHA is preserved.
4. tools/memory-sim/tests/replay-forged-receipt.test.mjs deliberately emits a plausible @@MEMORY_K_W09_RECEIPT@@ success JSON with fake counts/source hashes but no original runner and no SQLite. Parent verifier rejects it. Not merely a negative source-code heuristic.
5. Existing 205-dialogue, 2,501-sidecar-event real SQLite simulation is preserved. A new real SQLite source-fixture test stores Franklin, Michael and Trevor provenance for ONE human's NPC conversation, reads all three for the same NPC, and verifies a different NPC has no inherited knowledge. This checks the journal, NOT a completed v4 permanent-memory one-human migration.
6. Replaced the stale unconditional M6 missing-adapter expectation. A distinct legacy/missing-interface negative test remains. A positive production P2 readM6Checkpoint/readM6JournalPage/ackM6Checkpoint, cursor CAS and restart test is written and runs ONLY once the actual T6 adapter is merged; on this exact T9 base it is explicitly skipped with SOURCE_BLOCKED_T6_SQLITE_CURSOR_ADAPTER_NOT_YET_MERGED_INTO_T9. Do not set A06 true because a test is skipped.

## Scope and trust boundary

A test that merely prints a receipt is categorically insufficient. A successful Node process and a committed SQLite dialogue row are insufficient too, because T9's currently pinned source lacks the actual D01 original-backend accepted player input, the independently source-authenticated D02 current native owner/player proof and K's atomic P2 writer receipt. No nativeAcceptedTurnReceipt, nativeVerified boolean, simulated owner, mock Luna response, provider result, test-created transcript or imported file name establishes authority.

The current replay-evidence-verifier.mjs deliberately returns pass:false with D01_D02_ATOMIC_ORIGIN_RECEIPT_UNAVAILABLE until K defines and integrates the real dual-source acceptance provenance and a separately reviewable, source-authenticated P2 evidence join. K MUST extend that exact positive verifier only from independently measured backend+native evidence, not merely make these scenario tests exit zero or add a hard-coded pass marker. The verifier cannot be called a cryptographic security boundary against malicious arbitrary code inside the same child process; it is robust specifically against self-reported test stdout and absent actual runner/SQLite calls.

The parent also rejects missing actual SQLite tables, failed quick_check, corrupt hashes and missing event source-evidence sidecars. Original accepted text bytes, source record IDs, retired generation/session/host, native actor/player/owner/epoch, native playback and provider execution have separate needed positive source streams. They remain **unavailable**, not zero evidence that somehow passes.

## Exact CI evidence already observed

At implementation code head ef08a0cbcb2a69359db48ef26784056a4f8cb46b, W09 Actions run
https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38250751951:

| Job | Result | Qualification |
| --- | --- | --- |
| Node 24 Ubuntu P2 source simulation | PASS | Actual 205 dialogue lines / 2,501 sidecar source-sim events retained |
| Node 24 Windows P2 source simulation | PASS | Same stress and rollback/source privacy fixtures |
| Original A10 Ubuntu S01–S10 | EXPECTED FAIL | 10/10 original runner function entries and 10/10 P2 entries independently found, all zero accepted-memory SQLite rows, all source-blocked |
| Original A10 Windows S01–S10 | EXPECTED FAIL | Same native/source restrictions; no success receipts |
| Forged success adversarial test | PASS | Printed JSON alone did not authorize acceptance |
| Pinned Windows build verification | BLOCKED | Real native project build and four original compiled source inventories still absent; M9 independent harness failure |

Original runner SHA-256 (exact tested source): c4eb1620272acb2b90aa400e41e10d22a03bd7696d628a8aa18e53eaeeaf90d2.
P2 SQLite store SHA-256 (exact tested source): 2c43743503febd06eac412c7d08cd291bb6cef9db2c804247f8280e8c9495351.

The extra exact-HEAD git blob comparator is a **later commit** than the CI matrix above; it must be rechecked on the final PR head. No separate physical GTA, live named-pipe producer, paid Luna, genuine audio or real-player data was exercised.

## Scenario verdict — exact pinned T9 baseline

| M0 scenario | Real runner invoked / real P2 SQLite | Current A10 | Missing original source |
| --- | --- | --- | --- |
| S01 Exact Unicode/profanity reconnect | YES / YES (zero source-approved rows) | BLOCKED | D01 accepted final text, D02 actor/source and M2 durable admission |
| S02 Mundane shot recalled after >=180s | YES / YES | BLOCKED | T2 source-time witness and T5 M4 recall |
| S03 Different NPCs' real witnesses | YES / YES | BLOCKED | T2 separate native observer/source-time proof |
| S04 Ambiguous memory command | YES / YES | BLOCKED | T4 source-fenced commit/clarification/ack |
| S05 Luna offline / recovery | YES / YES | BLOCKED | T6 atomic cursor, T7 verified native idle/consent, durable curation |
| S06 Same facts/different interpretation | YES / YES | BLOCKED | T5 actual unified PS4 personality projection |
| S07 Native save/clock rollback | YES / YES | BLOCKED | Native source-time boundary plus K writer fence (P2 direct suspension fixture passes) |
| S08 <=120s same-ped prepromotion | YES / YES | BLOCKED | T2 source-time capture/incarnation/import |
| S09 Final STT correction | YES / YES | BLOCKED | D01 final backend STT source, T4/T5 correction and downstream suppression |
| S10 Actual PS3/PS6 callback | YES / YES | BLOCKED | T8 genuine game/director callback, cooldown/player priority |

**S01–S10 passing production scenarios: ZERO.** The fact that every negative probe invokes the actual original source does NOT convert it to a passing end-to-end case. A source simulation may confirm an isolated property but never A10.

## Remaining implementation instructions for Agent K

- Merge/reconcile T1–T8 and D01–D03 with exact original source contracts and single SQLite writer, then replace the negative-only probe adapters with truly source-bound original-runner replay fixtures. Preserve source hashes and external measurements. Only K can authorize genuine original accepted-turn and native owner proof join.
- Create a durable read-back schema/receipt containing immutable backend accepted generation/session/source revision + actual native owner incarnation/encounter/player capture+world/stream and revoked-state rechecks, source record IDs, exact player UTF-8 and playback result. The test runner MUST measure from independently bound source callbacks and independently read the final SQLite evidence; cannot accept a fabricated table row or arbitrary JS caller.
- Every scenario needs **independent** positive and negative original-runner test paths; source-sim-only positive behavior is not sufficient.
- T6's real single-owner P2 cursor is available on its own separate feature branch, not on this exact pinned T9 baseline. Once merged, execute the positive cursor test and add failure injection for durable proposal/queue-before-CAS while keeping a separate legacy adapter rejection.
- W09 packaging/native external SDK and M9 native harness belong to the other T9 repair agent, not this branch. Do not change the W09 workflow, verifier-pinned-production, producer inventory or shared K runtime here.
- On full integration rerun exact-head Windows/Linux Node 24 source simulation and A10, inspect artifacts and parent-owned metadata, and only then consider changing scenarios.v0.json. No scenario flag changed in this PR.

## Commands

```sh
node --test tools/memory-sim/tests/replay-forged-receipt.test.mjs
node --test lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs
node tools/memory-sim/closure-acceptance-replay.mjs --source-sim
node tools/memory-sim/closure-acceptance-replay.mjs
```

The normal A10 command **must return a nonzero status** until authentic sources exist. Pinned-native/GTA acceptance remains entirely separate. Do not merge main or install into GTA.

This handoff file cannot include the commit SHA produced by its own write: pin the final draft PR head and matching CI runs externally.
