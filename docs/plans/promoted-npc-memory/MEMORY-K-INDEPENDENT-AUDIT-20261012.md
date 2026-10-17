# Memory K — independent production audit (2026-10-12)

**Role:** independent read-only architecture, integration, security and correctness review.
**Audited head:** `f78970a3cd191f2d861dcba90423099e21183378` — [PR #131](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/131) (`integration/memory-k-d01-d02-d03-complete-20261012`).
**D01 work reviewed:** `215fc7d307ea5eedccb8dc3add78ff87a5d4432f` — draft [PR #132](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/132) (Section D).
**Baseline:** `main` `3ef6c52`. **Authority:** the original promoted-NPC memory plan at `c493133` ([PR #49](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/49)): `approved-decisions.md`, `implementation-roadmap.md`, `architecture-study-20261011.md`; M0 scenario corpus `tools/memory-sim/scenarios.v0.json` (`ab8e424`).

This document is a review. It is not an implementation claim, a merge approval, or GTA acceptance. Evidence labels: **SOURCE VERIFIED** (read in code at the audited SHA), **OFFLINE TESTED** (reproduced by running real modules or suites), **GTA VERIFIED** (physical game evidence; none exists), **BLOCKED**, **UNTESTED**.

## Readiness board

| Dimension | Verdict | Basis |
| --- | --- | --- |
| Source implementation readiness | **NO-GO** | No production path reads memory (K-02). At `f78970a` nothing writes either (K-03); PR #132 adds an offline-tested player-line write path. |
| Offline integration readiness | **NO-GO** | 11 non-gate failures in suites no workflow runs (K-08); privacy regressions (K-05, K-06). |
| Native packaging readiness | **NO-GO** | The packaged backend's first import fails (K-01); the net481 production plugin has never compiled in CI. |
| GTA deployment readiness | **NO-GO** | Installing any Memory K integration build disables the whole LSA backend (K-01). |
| Original S01–S10 production acceptance | **0 / 10** | The S-tests are hard-coded red gates (K-19); no GTA receipts. |

## A. Executive assessment

**Architectural health: sound core, not connected.** Memory K has a substantial, mostly well-designed library on one P2 SQLite v4 store. It includes:

- an immutable dialogue/event journal with envelope hashes;
- explicit-memory commands with a seven-day trash, corrections and tombstones;
- an append-only replay feed with CAS cursors;
- a Luna curator that can only add opinion (it must echo the deterministic `groundedSummary` verbatim);
- a reduced M8 interpretation layer and M9 event classifiers;
- native D02 owner/player corroboration and the fail-closed D03 single-transaction join.

That is about 29,000 added lines across 234 files, and most modules have tests.

**Genuinely finished (OFFLINE TESTED):**

- the M0 contracts and decisions;
- the M1 store, JSON import with backup, timeline guard and host-epoch fencing;
- byte-exact journal append and exact-quote lookup;
- per-NPC read isolation;
- unified-player semantics in the replay cursor, privacy receipts and recall;
- the fail-closed D03 transaction;
- a patched candidate bundle that builds.

**Not finished, in the production runtime at the audited head:**

- **Nothing writes.** D03 stays inert: D01 always returns `null`, and the `originalActor` ledger it needs is defined nowhere. NPC lines have no wired writer. The M3 recorder requires a source-time proof the production native authority never supplies.
- **Nothing reads.** No production code passes M4 recall or M8 opinions into the PS4 frame; only tests do. There is no M5 dispatcher, no M6 or M7 orchestrator, and no M9 producer or callback. CONVERSE is still the 12-message RAM history.
- **It cannot ship.** The built bundle starts with `await import("./e1/bootstrap.mjs")`, which imports `../../lsa-shared-brain/…`. The package does not contain that path, so all LSA dialogue would go down.

**Root causes:**

1. Each specialist PR deferred its production seam to the integrator ("K"), and K spent its effort on source-authority proofs instead of wiring.
2. PR #97 raised the acceptance bar ("the original Essential Core owns accepted input") above the original plan. The original plan defines an accepted player line as "the accepted input exactly as committed at `commitPlayerInput`". Production uses the fork's OpenAI sequential runner, yet PR #129 audited the stock Gemini path.
3. The #128 integration copied files instead of merging them, which dropped interfaces. CI runs hand-picked file lists, so the failures stayed hidden.
4. The ElevenLabs line carries a divergent fork of the same store and turn runner.

**Can it reach production without major rearchitecture?** Yes for the data model and storage core. The remaining work is substantial integration, not a rewrite:

- re-base acceptance on the original definition through an in-runtime issuer;
- redesign the D02 lease lifetime;
- build the read paths;
- fix packaging;
- close the privacy defects;
- consolidate the duplicate writers and authorities;
- reconcile the ElevenLabs store fork.

**The D01 subagent confirmed this for the write side.** Draft PR #132 adds the in-runtime issuer, the original-actor ledger and the D02 lease redesign without changing the store. It is OFFLINE TESTED end to end against the real patched bundle (Section D). It is not GTA verified, and production stays blocked by K-01 and K-02.

**Complexity.** The system is over-fenced:

- overlapping authorities: D01, D02, the C-01 v2 path in `nativeMemoryAuthority`, the W03 ports, D03's triple verification, and a second protagonist authority in the ElevenLabs line;
- two player-line writers plus one unfenced public writer, and a duplicated turn-hash derivation;
- dead adapters;
- about 54 open Memory PRs across six stacked integration layers;
- 20 fragmented memory workflows.

Section E removes the duplicates and keeps the independent boundaries: native owner proof, the single writer, and the timeline fence.

## B. Prioritized defect register

`src/` means `lsa-essential-e1-candidate/src/` and `brain/` means `lsa-shared-brain/src/`. Line numbers are at `f78970a3`.

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| K-01 | P0 | Packaged backend fails to start: shared imports not rewritten | OFFLINE TESTED |
| K-02 | P0 | No production read path (M4/M8 recall, M5, M6, M7, M9 unwired) | SOURCE VERIFIED |
| K-03 | P0 | No production write path can commit (player, NPC or event); player side partly addressed in PR #132 | SOURCE VERIFIED |
| K-04 | P1 | D02 lease lifetime makes the D03 join unreachable for most turns; addressed in PR #132 | OFFLINE TESTED |
| K-05 | P1 | Forget, then purge, resurrects the source line into recall | OFFLINE TESTED |
| K-06 | P1 | Curation can recreate a forgotten memory; it resurfaces after purge | OFFLINE TESTED |
| K-07 | P1 | M5 compound commands and clarification replies broken by lossy integration | OFFLINE TESTED |
| K-08 | P1 | Failing suites hidden by fragmented CI | OFFLINE TESTED |
| K-09 | P1 | ElevenLabs line forks the P2 store, turn runner and protagonist authority | SOURCE VERIFIED |
| K-10 | P1 | Stale writer lock after a crash disables the whole P2 SQLite store | OFFLINE TESTED |
| K-11 | P1 | Acceptance requirement escalated beyond the original plan; D01 audited the non-production path; issuer in PR #132, decision unrecorded | SOURCE VERIFIED |
| K-12 | P2 | Player counter-claims hide witnessed facts | SOURCE VERIFIED |
| K-13 | P2 | No certified negative coverage, so no grounded "I didn't see that" | SOURCE VERIFIED |
| K-14 | P2 | Timeline re-confirmation every session and save load, in a browser only | SOURCE VERIFIED |
| K-15 | P2 | Public unfenced journal writers bypass D01/D03/W03 | SOURCE VERIFIED |
| K-16 | P2 | Retention windows, quotas and snapshots missing | SOURCE VERIFIED |
| K-17 | P2 | One-human decision not recorded; decision #4 still says "separate" | SOURCE VERIFIED |
| K-18 | P2 | M8 and M9 at reduced scope; M9 native code not compiled | SOURCE VERIFIED |
| K-19 | P2 | S01–S10 tests are red gates, not executable scenarios | SOURCE VERIFIED |
| K-21 | P2 | Native D02 owner sample is all-or-nothing; one bad owned anchor nulls the whole frame | SOURCE VERIFIED |
| K-20 | P3 | Minor lifecycle, UX and dead-code issues | SOURCE VERIFIED |

### K-01 (P0) — Packaged backend fails to start

- **Location:** `lsa-essential-e1-candidate/tools/stageSharedMemory.mjs:8-12` rewrites only four `characters/` adapters. These imports reach the payload unchanged:
  - `src/bootstrap.mjs:25`
  - `src/memory/d03OriginalDialogueJoin.mjs:5-6`
  - `src/memory/m2EssentialCapture.mjs:4`
  - `src/memory/lunaCurationBridge.mjs`

  `brain/memory/recallSchemaV1.mjs:5` also reads `../../../contracts/memory.v1.json`, which is not packaged. Line 1 of the built `server.bundle.mjs` is `await import("./e1/bootstrap.mjs")`.
- **Failure:** In GTA, `plugins/LosSantosAliveServer/e1/bootstrap.mjs` resolves `plugins/lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs`. `deployment/install-e1.ps1` never installs that path, so the import throws `ERR_MODULE_NOT_FOUND`. The top-level await then rejects and the LSA server never starts. Introduced by `80cd044` (2026-10-11) on the #94 line (similar imports since #75); present in #128 and #131.
- **Evidence:** `tools/buildCandidate.mjs` exits 0 with 70 patches applied. Importing the dist `e1/bootstrap.mjs`, `e1/memory/d03OriginalDialogueJoin.mjs` or `e1/_shared/memory/ps4RecallContribution.mjs` fails. No workflow imports the packaged bundle.
- **Repair:**
  - Rewrite every `lsa-shared-brain/src/` specifier in all staged files at any depth.
  - Stage or embed the runtime contracts.
  - Fail the build if any dist file still contains `lsa-shared-brain/src`.
- **Tests:** A packaged-import smoke job on Node 24 (Windows and Linux). It copies `dist/plugins` into an empty directory with no repository tree, then imports `e1/bootstrap.mjs` and every `e1/**/*.mjs`.

### K-02 (P0) — No production memory read path

- **Location:**
  - `src/integration/essentialGlue.mjs:116-125` — `finalizeKnowledgeFrame` omits `preparedRecall`, `recallAuthorization`, `preparedM8` and `m8Authorization`, all of which `src/context/knowledgeRenderer.mjs:65` accepts. Only tests supply them (`tests/memory-k-w05-one-frame.test.mjs:41`, `tests/memory-m4-closure.test.mjs:31`).
  - No production import of `ps4RecallContribution`, `recallEngine`, `m5RuntimeCoordinator`, `m6Coordinator` or `m8Interpretation`.
  - `src/memory/lunaCurationBridge.mjs` and `src/perception/m9DirectorCueAdmission.mjs` are imported by nothing.
  - `DialogueHistory` remains RAM-only.
- **Failure:** Even with journaled rows, Nathan cannot answer "what did I tell you to say?". He cannot carry a conversation across a session close or execute "remember this" or "forget that". Nothing consolidates, curates or calls back. No PR ever wired this; the W05 handoff states it is "not a production-wiring claim".
- **Repair:**
  - Implement the W05 seam in the glue: prepare M4 and M8 after the accepted-line readback and before the model call.
  - Dispatch M5 in `runSequentialTurn` after the durable receipt and before the model.
  - Rebuild the "earlier conversation" block from the journal.
- **Tests:** A runner test on real P2 SQLite:
  - turn N journals a line, and turn N+1's frame contains the byte-exact quote in RECALLED;
  - after forget, the line is absent at send and at retry;
  - after a session close, the earlier block is present.

### K-03 (P0) — No production write path can commit

- **Location:**
  - (a) `src/memory/originalBackendAcceptedInput.mjs`: `verifyAccepted` always returns `null`, `hasAuthenticatedSource` always returns false.
  - (b) `src/integration/essentialGlue.mjs:78-82` reads `runtime.host.memorySourceLedgers.originalActor`, which nothing defines.
  - (c) NPC lines: `essentialGlue.mjs:97-107` calls `m2Capture.admitSpeechSegment` and `completeNpc`. The D03 object (`src/memory/d03OriginalDialogueJoin.mjs:182`) does not provide them, and the W03 `createM2EssentialCapture` is unused.
  - (d) Events: `brain/events/m3Ps2ObserverAdapter.mjs:25` requires source-time proof, but `src/memory/nativeMemoryAuthority.mjs:194-210` never returns `sourceAtObservation`. `native/intelligence/memory-m3/SourceTimeWitnessLedger.cs` is not in `PromotedCharacters.csproj`.
  - (e) `verifyNativeCoverage` and `resolvePrepromotion` are stubs returning `null` (`nativeMemoryAuthority.mjs:259-262`).
  - (f) Both production `profileForAlias` callbacks (`src/bootstrap.mjs:170-175` for M3 and `:205-215` for D02) require `p.worldProfileId===memoryStore.worldProfileId`, but P2 profile objects have no `worldProfileId` field (`brain/characters/profileSchema.mjs:14`). So `resolveNativeOwner` and D02 lease binding can never succeed. The D01 subagent found and fixed the D02 instance; the M3 instance remains.
- **Failure:** Zero player, NPC and event rows in production. `tools/memory-sim/closure-native-producers.v1.json` lists all four required production native producers (C-01, M3 source time, M7 idle, M9 events) with empty `sourcePaths`.
- **Repair:**
  - Positive D01 issuer (Section D).
  - An original-actor ledger written at turn creation.
  - NPC capture through the W03 adapter, which already shares D03's `memory.turn.v1` turn hash.
  - For M3, either compile and register the source-time ledger or accept observation-time ownership proven by incarnation and encounter.
- **Tests:** Positive and negative runner tests for each write path, plus a 2,500-event M3 run through the production adapter.
- **Status in PR #132 (OFFLINE TESTED):** (a) is addressed for the OpenAI path, (b) is addressed, and the D02 copy of (f) is fixed. (c), (d), (e) and the M3 copy of (f) (`src/bootstrap.mjs:174` at `215fc7d`) remain.

### K-04 (P1) — D02 lease lifetime makes the D03 join unreachable

- **Location:**
  - `src/memory/nativeCurrentOwnerPlayerAuthority.mjs:46-53` sets `leaseMs=1000`, and the constructor rejects anything larger.
  - Lines `160-161` require the lease to be younger than `leaseMs` and a newer native sample to exist.
  - `clear()` wipes every lease (`:72`).
  - `src/perception/intelligenceClient.mjs:624-629` triggers a roster retire on every `anchors`, `observer_index`, `retire` or `retire_batch` frame.
  - `native/intelligence/IntelligenceIntegration.cs:416-418` and `247-290` resend the whole roster every 1000 ms.
  - D03 verifies three times: before the transaction, inside it, and at readback.
- **Failure:**
  - A typed turn verifies about 40 ms after bind: `null`, because no newer sample exists yet.
  - An STT turn longer than 1 s: `null`.
  - Any periodic roster refresh between bind and accept: `null`.

  Only 250–1000 ms windows that miss the refresh succeed, so even with a positive D01 most turns would silently go unrecorded.
- **Evidence:** The real module with scripted frames:

  | Case | Result |
  | --- | --- |
  | A — typed, 40 ms | null |
  | B — 250 ms, newer sample | OK |
  | C — roster refresh between bind and accept | null |
  | D — STT 1.4 s | null |
  | E — STT 0.9 s | OK |
- **Repair:**
  - Key the lease to `(observerCaptureRef, incarnationId, encounterId, nativeActorPedId, avatar, stream, epoch)`.
  - On roster refresh, revoke only removed or changed refs.
  - At accept time, re-validate against the newest sample, and tie lifetime to turn currency instead of a 1 s wall clock.
  - Keep the vetoes for recycled peds, avatar switches and epoch changes.
- **Tests:** Runner timing tests: typed 40 ms, STT 3 s, roster refresh mid-turn, recycled ped mid-turn, avatar switch mid-turn.
- **Status in PR #132 (OFFLINE TESTED):** addressed.
  - A roster refresh now unsettles verification instead of wiping leases.
  - The lease is a 60 s backstop, revoked at turn end.
  - D03 waits up to 750 ms for the next owner sample.
  - Its end-to-end tests cover typed turns, an STT turn over 1 s across three roster refreshes, a recycled ped mid-turn and an avatar switch mid-turn. My probe re-run adds a 3 s STT turn (Section D).

### K-05 (P1) — Forget, then purge, resurrects the source line

- **Location:** `brain/memory/m5SqlitePrivacy.mjs:448-470` — `trash` tombstones only `dependentIds`, the downward closure. `:591-656` — `purge` deletes the memory and its tombstone (`:649`). `brain/memory/sqliteIntegratedRecallProjection.mjs:24-40` suppresses sources only while the forgotten memory row exists.
- **Failure:** "Remember that I ordered ramen", then "forget that", then purge after 7 days: `readIntegratedRecall` returns the original line again. The original §4.5 requires evidence-key plus content-hash tombstones.
- **Evidence:** Probe: suppressed during trash = true; after purge = false, still journaled, returned by recall. Also the failing assertion `lsa-shared-brain/tests/memory-k-production-w04-sqlite.test.mjs:182`.
- **Repair:** Add the upward source closure to the trash bundle, or keep a permanent evidence-key and content-hash suppression record that purge never deletes.
- **Tests:** The existing W04 privacy test, plus recall-after-purge and replay-after-purge assertions.

### K-06 (P1) — Curation can recreate a forgotten memory

- **Location:** `brain/memory/integratedSqlite.mjs:231-235` (`persistDeterministicMemory`) and `brain/memory/curationSqlite.mjs:143-146` (`completeCuration`) check only direct tombstones. The read path uses a transitive closure.
- **Failure:** A durable curation job queued before "forget that", or replayed after a restart, cites the forgotten memory's evidence. The insert succeeds (`inserted:true`). The new memory is hidden while the original is in trash and becomes visible after purge.
- **Repair:** Gate writes on the same suppression set as reads, and reject with `curation_source_forgotten`.
- **Tests:** Forget, then enqueue, claim and complete a proposal: rejected. After purge: still absent. Repeat through the Luna appraisal path.

### K-07 (P1) — M5 compound commands and clarifications broken by integration

- **Location:** `brain/memory/m5SqlitePrivacy.mjs:334-372` — `bindCommands()` lost the `commitCommandBatch` and `findPendingClarification` members that [PR #104](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/104) exposed when integration commit `6da0194` merged it with #123. `brain/memory/m5RuntimeCoordinator.mjs:75-76` and `:155-156` still call them.
- **Failure:** "Remember X; forget Y" returns `atomic_writer_unavailable`. Clarification replies ("the first one") never resolve, which breaks the S04 path. Both fail closed (no false "saved"), but the features are gone.
- **Repair:** Restore both members; keep #123's cross-avatar hashing.
- **Tests:** `memory-k-production-w04-sqlite.test.mjs` (3 of 8 currently fail), run in CI.

### K-08 (P1) — Failing suites hidden by fragmented CI

- **Location:** 20 memory workflows (21 workflow files in total) with hand-picked file lists; none runs a full suite. Not referenced by any workflow:
  - `lsa-shared-brain/tests/`: `memory-k-production-w04-sqlite.test.mjs`, `memory-m6-p2-production.test.mjs`, `memory-agent-a-storage-recall.test.mjs`, `memory-m5-agent-b-cross-avatar.test.mjs`
  - `lsa-essential-e1-candidate/tests/`: `memory-k-w03-m2-receipts.test.mjs`, `memory-k-w05-one-frame.test.mjs`, `m3-closure-agent-d.test.mjs`, `nativeC01Authority.test.mjs`
- **Failure:** The integrated head carries 11 failures that are not intentional gates, while PRs report green CI:
  - 6 × W03: the fixture omits `hostContextVersion` (`tests/memory-k-w03-m2-receipts.test.mjs:28-29`), so the NPC-capture adversarial tests exercise nothing;
  - 3 × W04;
  - 1 × W06 (error precedence);
  - 1 × the M1 editor test under the runner's fetch stub.
- **Permanently red jobs teach people to ignore red.** On PR #131, four jobs fail by design or by stale configuration, and the same four fail on PR #132:
  - two HARD A10 S-gate jobs;
  - `m0-scenario-gate`;
  - the W09 pinned-package job. Its packaging gate fails on `independent-ast-hook-reconciliation` (48 manifest edits against 70 built). It hash-checks staged files but never imports the package, so it cannot catch K-01.
- **Repair:** One required `memory-all` workflow running every shared-brain and e1 test by glob on Node 24 (Windows and Linux). Mark the S-gates expected-fail rather than red, and reconcile the W09 manifest so that a red job means a regression.

### K-09 (P1) — ElevenLabs line forks the P2 store and turn runner

- **Location:** `integration/elevenlabs-emotional-acting-consolidated-20261012` ([PR #118](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/118)):
  - divergent copies of `brain/memory/{journalSqlite,integratedSqlite,m5SqlitePrivacy,p2ReplayCursor,curationSqlite}.mjs` and `brain/characters/{sqliteFoundation,sqliteProfileStore}.mjs`;
  - its `p2ReplayCursor.mjs:11-12` keys cursors by `protagonist_key`;
  - no `m6_p2_*` tables and no `p2_memory_replay_player_cursors`;
  - its `runSequentialTurn` has no M2 hooks;
  - a separate protagonist authority (`native/intelligence/NativeProtagonistSensor.cs`, `src/perception/protagonistAuthority.mjs`) alongside K's `MemoryProtagonistSource.cs` and D02;
  - 37 non-doc files changed by both lines.
- **Failure:** Merging the ElevenLabs line after K, or running its build on a database K wrote:
  - reintroduces per-avatar replay partitioning;
  - skips K's tables when a character is unpromoted.

  PR #114 (its one-human change) is not in that line.
- **Repair:** One owner module for the P2 store. Rebase the ElevenLabs line onto K's store, with one protagonist authority whose native sample feeds both emotional mood and D02. Merge K's store first.
- **Tests:** Both builds open one database; unpromote purges all tables; the replay cursor continues across avatars.

### K-10 (P1) — Stale writer lock disables the P2 store after a crash

- **Location:** `brain/characters/sqliteProfileStore.mjs:86-98` — opens the lock with `'wx'`; `EEXIST` yields `sqlite_writer_busy` and marks the store unavailable. No reclaim path and no documentation.
- **Failure:** A GTA or Node crash leaves `profiles.v2.sqlite.writer.lock` behind. On the next launch, promoted profiles and memory are both unavailable until the player deletes the file by hand.
- **Repair:** Write `{pid, hostRunId, startedAt}` into the lock. On `EEXIST`, reclaim the lock if that process is dead (or hold an OS-level lock). Show the status in the editor.
- **Tests:** Restart after a simulated crash; a concurrent second process is still refused.

### K-11 (P1) — Acceptance requirement escalated; D01 audited the wrong path

- **Location:** PR #97 plan invariant 1. `PRODUCTION-D01-FINAL.md` analyses Gemini `NK`, `AP` and `SK`. Production (`provider: "openai"`) runs `essentialGlue.createTransport`, then `src/openai/openaiConnection.mjs`, then `src/openai/runSequentialTurn.mjs:183-214`: one final STT result, the `check()` currency fence, then `commitPlayerInput`.
- **Failure:** M2, the original plan's "first major player win", has been blocked on a transition the original plan never required. The production commit decision is fork-owned code that nobody evaluated.
- **Evidence:** Original architecture study §3.3 (player lines are "the accepted input exactly as committed at `commitPlayerInput`"), §3.6 G1, and §5.5 ("If the turn is later interrupted, the memory stands").
- **Repair:** Re-base acceptance on the original definition with an unforgeable in-runtime issuer at the commit decision point (Section D), and record the decision.
- **Status:** the issuer is implemented in PR #132 (OFFLINE TESTED). The decision record is still missing (WS-3).

### K-12 (P2) — Player counter-claims hide witnessed facts

- **Location:**
  - `brain/memory/explicitCommands.mjs:59-61` and `69-86`: `counter_claim` may target a `journal_event`.
  - `sqliteIntegratedRecallProjection.mjs:71` and `94-96`, and `integratedSqlite.mjs:117` and `247`: corrected targets are dropped.
- **Failure:** "That's not what happened, it was a bus" removes Nathan's witnessed crash from recall. The original §5.6 says witnessed facts stay unchanged and the counter-claim is linked.
- **Repair:** Only STT transcript corrections supersede. Counter-claims become linked `reported_claim` overlays without revoking evidence.

### K-13 (P2) — No certified negative coverage

- **Location:** `sqliteIntegratedRecallProjection.mjs:192-194` always returns `coverageComplete:false`. `nativeMemoryAuthority.mjs:259` returns `null` from `verifyNativeCoverage`.
- **Failure:** No grounded "No, I didn't see you shoot anyone". G5 and the M3 acceptance clause are unmet.
- **Repair:** Native-receipted coverage per observer window, exposed in the RecallBundle. **Tests:** S02 and S03 negatives.

### K-14 (P2) — Timeline re-confirmation every session and save load

- **Location:** `brain/characters/sqliteProfileStore.mjs:49-67` clears confirmation on any `hostRunId` or `worldEpoch` change. `native/promoted-characters/HostContext.cs:14-35` issues a new run ID per launch and advances the epoch on a tick regression. `src/characters/editorServer.mjs:19-25` and `58-62` are the only UI.
- **Failure:** After every launch and save load, writes stay suspended until the player alt-tabs to the localhost editor. There is no in-game prompt; the original plan asks for "the editor and F11", and only after a suspected rollback.
- **Repair:** Continue the timeline automatically on `host_reload` when the lineage marker matches; prompt in game only on `clock_regression` or ambiguity. GTA UNTESTED.

### K-15 (P2) — Public unfenced journal writers

- **Location:** `brain/characters/sqliteProfileStore.mjs:317-324` (`appendDialogueLine`) and `brain/memory/conversationRecorder.mjs:43-81`.
- **Failure:** Any holder of `characterService.store` can journal an `accepted` player line or a `completed` NPC line after shape validation only. The W04 fixtures use exactly this bypass.
- **Repair:** Require an opaque capability minted only by D03 or W03, and move the fixtures into `tests/`.

### K-16 (P2) — Retention, quotas and snapshots missing

- **Gap:** `lsa-shared-brain/src` has none of the following:
  - `VACUUM INTO` snapshots;
  - per-character caps (25,000 events or 64 MiB);
  - a 1 GiB global cap;
  - a free-recall (≥200 lines) or archive window.
- **Repair:** Implement original §3.2, §3.4 and §8.4. **Tests:** The M10 soak.

### K-17 (P2) — One-human decision not recorded

- **Gap:** `docs/plans/promoted-npc-memory/approved-decisions.md` decision #4 still says "Keep Franklin, Michael and Trevor separate when reliably identifiable". `docs/research/DECISIONS.md` ends at D-020.
- **Repair:** Add a D-021 one-human scope (avatar kept as provenance only) and amend #4.

### K-18 (P2) — M8 and M9 at reduced scope

- **M8:** `brain/memory/m8Interpretation.mjs` tracks trust, affection and familiarity and classifies with regexes. It has no beliefs, grudges, respect, annoyance or storytelling settings.
- **M9:** `brain/events/m9EventProducers.mjs` and `native/intelligence/m9/*.cs` cover collision, airborne, water and wanted level. There is no rollover, Wasted or Busted producer, and the native files are not in `PromotedCharacters.csproj:7-10`.

### K-19 (P2) — S01–S10 are red gates

- **Gap:** `lsa-essential-e1-candidate/tests/memory-k-original-S01.test.mjs` through `S10` assert `durableAcceptedRows===0` and then call `assert.fail`.
- **Repair:** Rewrite them as positive runner scenarios with fixtures only at the native and protocol boundary, plus a GTA receipt checklist.

### K-21 (P2) — Native D02 owner sample is all-or-nothing

- **Location:** `native/promoted-characters/MemoryOwnerAuthority.cs:22-95` (`SampleMemoryCurrentOwnerPlayer`). Any owned observer anchor without exactly one live registered encounter, any suspended encounter (`PromotedCharactersIntegration.cs:182-189`), or any failed P1 or lifetime check returns `null` for the whole frame. The protagonist sampler is `null` during switches, cutscenes and death.
- **Failure:** One suspended or half-registered promoted NPC stops D02 for every NPC, so no player line is journaled. Fail-closed, but availability may be poor.
- **Repair:** Omit only the failing anchors, or mark them unavailable per owner, and keep the per-owner checks.
- **Tests:** A native harness case with one healthy and one suspended NPC. GTA UNTESTED.

### K-20 (P3) — Minor issues

- Clarifications are stored per avatar, so an avatar switch mid-clarification loses them.
- The replay page permanently skips suppressed items (`brain/memory/p2ReplayCursor.mjs:131-136`), so an item restored after the cursor moves on is never consolidated.
- The STT model is recorded as `'unknown'` (`src/integration/essentialGlue.mjs:94`).
- A latent turn abort: `runSequentialTurn.mjs:210` and `:418` emit the unregistered event `memory_journal_not_committed` inside a `catch`. `createTelemetryRecord` throws for it (`src/observability/eventContract.mjs:150`), so a journal failure would abort the player's turn when telemetry is on. Found by the D01 subagent and guarded in `6e050a6`.
- `npm test` is red: `tests/m1-shared-memory-parity.test.mjs:174` uses `fetch` under the runner stub.
- Extension DDL runs outside the v4 migration transaction (`brain/characters/sqliteFoundation.mjs:206-216`).
- Dead or duplicate code:
  - unused: `m2EssentialCapture`, `lunaCurationBridge`, `m9DirectorCueAdmission`;
  - `fixtureMemoryCommandStore.mjs` sits in `src`;
  - legacy `m4_recall_records_v1` path in `sqliteRecallReadAdapter`;
  - the turn hash is duplicated in D03 and `conversationRecorder`;
  - the C-01 v2 path is "unavailable with pinned ABI".

## C. Master-plan traceability

**Library** means the code exists and has offline tests. **Production** means it is wired and active at `f78970a3`. K-01 additionally blocks every production row.

| ID | Original requirement | Library | Production | Verification | Deviation / remediation |
| --- | --- | --- | --- | --- | --- |
| AD-1 | Natural recall plus accurate on-demand retrieval | PARTIAL | MISSING | Offline M4/W05 | Never reaches the frame (K-02); no spontaneous path |
| AD-2 | One P2 SQLite store; backup, rollback, editor parity; FTS5 | COMPLETE | PARTIAL | M1 tests | Opt-in; K-10, K-09, K-16 |
| AD-3 | Luna curation by default; no local LLM; deterministic fallback | COMPLETE | MISSING | Mocked | Off by default with persisted consent (PR #97), unrecorded; bridge unused |
| AD-4 | Protagonists separate when identifiable | SUPERSEDED | SUPERSEDED | Unified tests | Reversed by the one-human requirement; unrecorded (K-17); ElevenLabs line still partitions (K-09) |
| AD-5 | Prompt after rollback; suspend writes | COMPLETE | PARTIAL | Guard tests | K-14 |
| AD-6 | Archive; ≥200-line free recall; no expiry; delete/export | PARTIAL | MISSING | Offline | K-16; no inspector UI |
| AD-7 | D-018–D-020 plus C-04 recall contribution | COMPLETE | MISSING | Docs | K-02 |
| AD-8 | Two-minute promotion grace, same ped | BLOCKED | BLOCKED | None | `resolvePrepromotion` returns `null` |
| G1 | Accepted line committed before the model; exact quote | COMPLETE | BLOCKED | D03 synthetic | K-03, K-04, Section D |
| G2 | Every qualified observation journaled | COMPLETE | BLOCKED | M3 tests, 2,501-event replay | K-03d |
| G3 | All matches, or best plus a count | PARTIAL | MISSING | Offline | No count; coverage incomplete |
| G4 | Claims and opinions labelled | COMPLETE | MISSING | W05 | Nothing rendered |
| G5 | Abstention with coverage | MISSING | MISSING | None | K-13 |
| M0 | Decisions, contract, scenario corpus | COMPLETE | COMPLETE | Contract test | K-19 |
| M1 | Store, import, TimelineGuard (editor + F11), SubjectRef | COMPLETE | PARTIAL | M1 tests | No F11; K-10; K-01 |
| M2 | Journal at commit, playback and interruption; cross-session CONVERSE; quote | PARTIAL | BLOCKED | D03 unit; W03 broken | K-11, K-03c, K-02 |
| M3 | Attribution, subjects, scenes, coverage | PARTIAL | BLOCKED | Offline | Negatives and prepromotion missing |
| M4 | Retrieval, fusion, budgets, abstention; ≥95% / ≥98%; p95 ≤40 ms | PARTIAL | MISSING | Unit tests only; harness never measured | K-02, K-13 |
| M5 | Commands, clarification, forget/correct, inspector | PARTIAL | MISSING | W04 5/8 | K-05, K-06, K-07, K-12 |
| M6 | Deterministic notability, frozen evidence, durable queue | PARTIAL | MISSING | M6 tests (W06: 1 fail) | No orchestrator |
| M7 | Luna curation, queue, budget, grounding, no VRAM | COMPLETE | MISSING | Mocked | Native idle not compiled; bridge unused |
| M8 | Personality, beliefs, relationships, jokes | PARTIAL | MISSING | M8 tests | K-18 |
| M9 | 13b callbacks plus fun-event producers | PARTIAL | MISSING | M9 tests | K-18 |
| M10 | Standalone adapters; 4-hour soak | MISSING | MISSING | None | — |
| S01 | Exact utterance across reconnect | PARTIAL | BLOCKED | Red gate | K-02, K-03, K-04 |
| S02 | Boring firing recalled after 3 min | PARTIAL | BLOCKED | Red gate | K-03d, K-02 |
| S03 | Observer without witness proof gains no memory | PARTIAL | BLOCKED | Red gate | K-03d |
| S04 | Ambiguous "remember this" clarifies | PARTIAL | MISSING | W04 clarification fails | K-07, K-02 |
| S05 | Luna offline; facts persist | PARTIAL | MISSING | Mocked | K-02 |
| S06 | Two personalities, identical facts | PARTIAL | MISSING | M8/W05 | K-18, K-02 |
| S07 | Clock regression pauses writes | COMPLETE | PARTIAL | Offline | K-14; GTA untested |
| S08 | Promotion grace ≤120 s, same ped | BLOCKED | BLOCKED | None | Native reserved owner needed |
| S09 | STT correction links original and correction | PARTIAL | MISSING | W04 correction passes | No STT lines; no dispatcher |
| S10 | Spontaneous callback under Director rules | PARTIAL | MISSING | None | "No spontaneous M9 memory callback is possible" |

**Implementation completeness (library), 33 rows excluding the superseded AD-4:**

| Complete | Partial | Missing | Blocked |
| --- | --- | --- | --- |
| 11 | 18 | 2 | 2 |

**Production readiness, same 33 rows:**

| Complete | Partial | Blocked | Missing | GTA verified |
| --- | --- | --- | --- | --- |
| 1 (M0 docs) | 4 | 9 | 19 | 0 |

**Effect of PR #132:** no tally changes. It removes the D01, ledger and D02 blockers from G1, M2 and S01. G1 stays blocked in production by K-01. M2 and S01 also stay blocked by K-02 and, for M2, by the missing NPC capture.

**Silently dropped, weakened or reinterpreted:**

- **Acceptance semantics.** "Accepted at `commitPlayerInput`" became "the original Core must emit final acceptance" (K-11).
- **Protagonist policy.** "Separate" became one human, without a recorded decision (K-17).
- **Curation default.** "Luna by default" became off by default with consent; this should be recorded.
- **Corrections.** "Witnessed facts unchanged" became counter-claims that revoke them (K-12).
- **Forgetting.** "Evidence-key plus content-hash tombstone" became a target-only tombstone deleted at purge (K-05, K-06).
- **Narrowed journal.** No interrupted "possibly not heard" NPC lines and no `reply_to` link (`brain/memory/journalSqlite.mjs:20-27` accepts only `completed` NPC lines).
- **Scaffolding instead of behaviour.**
  - S01–S10 are red gates (K-19).
  - These are interfaces with no production caller (K-02):
    - M2 NPC capture;
    - M4/M8 frame admission;
    - M5 dispatch;
    - M6/M7 orchestration;
    - M9 callbacks.
  - The required native producers are listed with empty sources.
- **Deferred indefinitely:**
  - G5;
  - AD-8;
  - retention and snapshots (K-16);
  - the inspector UI;
  - F11;
  - M10.

## D. D01 subagent assessment

**Reviewed:** draft [PR #132](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/132), branch `claude/beautiful-cray-0q8ln4` at `215fc7d3`, based on `f78970a3`. Four commits, 20 files, +1,582/−111. Line endings are preserved: the raw diff equals the whitespace-insensitive diff.

**Verdict:** the approach is legitimate and the implementation is sound for its scope. Integrate it into the K branch together with the packaging fix (WS-1), a full-suite CI run (WS-2) and a recorded decision (WS-3). It does not change any production verdict.

**What it builds.** A positive accepted-input source for the production OpenAI path only. The stock Gemini path stays denial-only.

- `src/memory/openaiRuntimeAcceptedInput.mjs` is a one-shot issuer, opened per turn launch. `runSequentialTurn` calls it right after a first `history.commitPlayerInput` (`:211`, `:218`), and awaits D03 before the model request (`:223-224`). At that instant the issuer re-checks, without trusting the caller:
  - the launch is not aborted and the connection is not closed;
  - the patched original registry still reports this exact tuple as the current OpenAI turn of the session this connection object is registered for, and the record's `input.transcript` equals the committed bytes (new bridge method `originalTurnFacts`, `tools/buildCandidate.mjs:87`);
  - P1 identity currency;
  - the ledger entry written at turn creation names the same native ped and source, and typed text is player-authored (this rejects the stock greeting substitution and `testPrompt`);
  - the text is valid UTF-16, already trimmed, and at most 12,000 units.
- `src/memory/originalTurnActorLedger.mjs` is the missing original-actor ledger (K-03b).
- `src/memory/memoryD02Port.mjs` and `nativeCurrentOwnerPlayerAuthority.mjs` redesign the D02 lease (K-04) and fix the D02 `profileForAlias` predicate (K-03f).
- D03 gains:
  - a closed allowlist of receipt sources, selected by the verifier's pin;
  - a P1/D02 incarnation cross-check;
  - a bounded wait for a newer native owner sample;
  - post-acceptance validity governed by the receipt rather than turn currency (§5.5).

The receipt names its true origin, `essential_openai_runtime_commit_decision`. It does not claim that the original Core emitted acceptance.

**Why this is not a forbidden proxy.** The original plan (§3.3) defines a player line as "the accepted input exactly as committed at `commitPlayerInput`". The issuer runs inside that commit, after the single final STT result and the currency fence.

- `SendTextPrompt`, `SendMicStop`, transport success and the provisional `input_transcript` all come earlier, and none of them can mint.
- Model completion comes later and plays no part.
- A history write alone is not enough: the original registry's own record must also agree.
- Caller flags, model text and config cannot reach the issuer. It lives in private fields of `OpenAITransport` and `OpenAIConnection`, never on `runtime`, `services`, the bridge or config.

**Independently verified by this review:**

| Claim | Check | Label |
| --- | --- | --- |
| Typed adoption and runner order | Bundle `5d81de42…`: `Fr` is `String(t??"").trim()`; `ib` adopts `Fr(t.text)` or the greeting into `Xi({input:{transcript}, metadata:{originalMessage}})`. Runner: one `transcribe` (`:191`), `input_transcript` (`:193`), commit (`:211`), accept (`:218`), D03 awaited (`:223-224`), release in `finally` (`:475`). | SOURCE VERIFIED |
| Least authority | The issuer is reachable only through private connection fields, and the bridge refuses unregistered connections. The forged-input test covers a rogue connection, receipt-shaped model text and caller flags. | SOURCE VERIFIED, OFFLINE TESTED |
| D02 redesign | My K-04 probe, re-run against the new module: cases B–E now return OK, and so do F (typed 40 ms, then the next sample) and G (STT 3 s across three roster refreshes). A (typed, verified at 40 ms with no newer sample) is still `null` by design, because D03 now waits for that sample. H (this owner retired mid-turn) is `null`, as it should be. | OFFLINE TESTED |
| Native cadence | `IntelligenceIntegration.cs:418` resends the roster every 1000 ms; `:423` samples the owner every 250 ms. | SOURCE VERIFIED |
| No regressions | memory 98/98; e1 1040 tests, 1022 pass, 17 fail; shared-brain 211/215. Both failure sets are identical to the base. | OFFLINE TESTED |
| CI on `215fc7d` | 25 of 29 checks pass, including the new D01 workflow on Windows and Ubuntu. The 4 failures (HARD A10 ×2, `m0-scenario-gate`, W09 pinned package) fail identically on PR #131. | OFFLINE TESTED (GitHub Actions) |
| Packaging | The candidate builds with 70 edits, and the three new modules import from an isolated package copy. `e1/bootstrap.mjs` and D03 still fail with `ERR_MODULE_NOT_FOUND`: K-01 is unchanged, not widened. | OFFLINE TESTED |
| End-to-end harness | Runs the real patched pinned bundle in a VM, with the real runtime, `IntelligenceClient`, D02 port, D03 and SQLite. Harness constants match the bundle. Native frames, the P1 pipe, providers and playback ACKs are scripted. | OFFLINE TESTED, not GTA |

**Closed offline:**

- K-03(a) on the OpenAI path, K-03(b), and the D02 copy of K-03(f);
- K-04;
- the K-20 telemetry throw;
- the implementation side of K-11. Its decision record is still missing.

**Residual findings from this review:**

1. **Production is unchanged.**
   - K-01 still stops the packaged backend.
   - K-02 means journaled lines are never read back; memory is write-only.
   - NPC lines (K-03c) and events (K-03d, K-03e) still have no writer.
   - The M3 copy of the predicate remains at `src/bootstrap.mjs:174`.
2. **The latency ceiling is understated.** D03 waits for the next 250 ms native owner sample before the model request (about 125 ms on average).
   - The pre-transaction wait is bounded at 750 ms, but the readback starts a fresh 750 ms budget (`d03OriginalDialogueJoin.mjs:239-240`). The hard ceiling is therefore about 1.5 s plus P2 queue time, not the 750 ms the PR body states.
   - The wait ends early when D02 liveness lapses (`maxAgeMs` 750), so a silent native sampler (K-21) costs memory, not latency.
   - Product decision: keep G1 ordering, or corroborate after the model request.
3. **A post-COMMIT revocation returns `not_stored`.** A revocation between COMMIT and readback gives `d03_durable_readback_unverified` while the row stays journaled. That matches §5.5, but callers and telemetry must read `not_stored` as "no durable receipt", not as "absent".
4. **In-process trust.** Code holding `globalThis.__LSA_E1_RUNTIME` remains trusted. A rogue in-process connection cannot mint, but it can pre-commit words into RAM history for a live turn, which suppresses the real line's receipt. Nothing false is journaled; this is pre-existing.
5. **The decision is unrecorded.** PR #97 invariant 1 is still formally in force. WS-3 must record the re-based definition and the new receipt source before integration.
6. **GTA-only facts are untested:**
   - native frame cadence and ordering;
   - `PedId` equal to `Ped.Handle`;
   - P1 pipe timing;
   - real STT latency;
   - the net481 build.

**Recommendation:**

- Merge PR #132 into the K integration branch with a merge commit, once WS-1 has landed, a `memory-all` run is green on the merged head, and the decision is recorded.
- Treat it as the foundation of WS-5.
- Do not deploy it to GTA on its own.

## E. Repair workstreams and acceptance plan

**Target:** the original plan's first player win as one vertical slice. Use one integration branch built with merge commits (not file copies), and stop opening per-sub-feature PRs. Once content equivalence is checked, close the superseded drafts (#55–#90, #98–#105, #115–#117, #119–#123).

| Workstream | Scope | Depends on | Parallel |
| --- | --- | --- | --- |
| WS-1 Packaging | K-01 import rewrite, staged contracts, packaged-import smoke | — | Start now |
| WS-2 CI integrity | K-08, K-19: `memory-all` glob workflow; W03 fixture fix; expected-fail S-gates; positive scenarios as slices land | — | Start now |
| WS-3 Decisions | K-11, K-17: acceptance definition; D-021 one-human scope; M7 consent default | — | Start now |
| WS-4 Store and privacy | K-05, K-06, K-07, K-10, K-12, K-15, K-20 store items | WS-2 | With WS-5 |
| WS-5 Write path | Merge PR #132 (D01 issuer, original-actor ledger, K-04 lease redesign); then W03 NPC capture (completed playback only), the M3 predicate at `bootstrap.mjs:174`, and the M3 source-time decision | WS-1, WS-2, WS-3 | With WS-4 |
| WS-6 Read path | K-02: M4/M8 frame admission, journal CONVERSE and earlier block, M5 dispatch before the model | WS-4, WS-5 | No |
| WS-7 Background | M6 orchestrator, M7 with consent, M9, K-13, K-16, K-18 | WS-6 | Partly |
| WS-8 ElevenLabs reconcile | K-09: rebase the ElevenLabs line onto K's store; one protagonist authority | WS-4 stable | After WS-4 |

```text
WS-1 Packaging ─┐
WS-2 CI ────────┼─▶ WS-4 Store/privacy ─┐
WS-3 Decisions ─┘   WS-5 Write path ────┴─▶ WS-6 Read path ─▶ [Controlled GTA: S01, S07, S09] ─▶ WS-7 ─▶ WS-8 ─▶ M10 soak
```

**Acceptance plan:**

1. **Offline gate:**
   - `memory-all` green on Node 24 (Windows and Linux);
   - packaged-import smoke green;
   - positive runner scenarios S01, S07 and S09;
   - the K-04 timing tests;
   - all privacy tests.
2. **Native gate** on the user's machine: net481 `PromotedCharacters.csproj` built against the real RPH, DamageTracker and Essential references, with hash-pinned packaging.
3. **Controlled GTA, explicitly authorized:**
   - S01: say a line, walk away 2 min, pause 30 s, and Nathan quotes it exactly; after a restart he says "last time".
   - S09: correct a misheard STT line.
   - S07: load an older save; writes suspend until confirmation.

   Keep JSONL telemetry and SQLite rows as receipts.
4. Then WS-7, the remaining scenarios, and the M10 soak.

## F. Final production verdict

| Dimension | Verdict |
| --- | --- |
| Source implementation readiness | **NO-GO** (K-02; K-03 for NPC lines and events; player-line writes exist only in PR #132, offline) |
| Offline integration readiness | **NO-GO** (K-07, K-08, K-05, K-06) |
| Native packaging readiness | **NO-GO** (K-01; net481 never compiled; M3/M7/M9/C-01 native sources not in the production project) |
| GTA deployment readiness | **NO-GO** (do not install any Memory K integration build; keep the deployed `main`-based build) |
| Original S01–S10 acceptance | **0 / 10** (no positive executable scenarios; 0 GTA receipts) |

## Method and evidence

**Suites, run locally on Node v22.22.0 (CI uses Node 24):**

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `lsa-shared-brain/tests/*.test.mjs` | 215 | 211 | 4 |
| e1 `tools/runTests.mjs` | 1009 | 991 | 17 (10 S-gates, 6 W03, 1 M1 editor) |
| e1 `tests/memory/*.test.mjs` | 65 | 65 | 0 |
| `tools/memory-sim/tests` | 7 | 7 | 0 |

**The same suites at the D01 head `215fc7d`:**

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `lsa-shared-brain/tests/*.test.mjs` | 215 | 211 | 4 (same set) |
| e1 `tools/runTests.mjs` | 1040 | 1022 | 17 (same set) |
| e1 `tests/memory/*.test.mjs` | 98 | 98 | 0 |

**Probes** (real modules, temporary SQLite):

- compound M5 command → `atomic_writer_unavailable` (K-07);
- forget, then purge → the line returns in recall (K-05);
- curation from forgotten evidence → `inserted:true`, visible after purge (K-06);
- D02 lease timing, cases A–E (K-04);
- stale lock → `sqlite_writer_busy` (K-10);
- candidate build plus dist import → `ERR_MODULE_NOT_FOUND` (K-01), at both heads;
- D02 lease timing re-run against PR #132, cases A–H (Section D).

**Not done:** no GTA run, no paid provider calls, no installation. The reviewer's only repository write is this document.

**Scope read:**

- the original plan, M0, the PR #97 plan, and the D01/D02/D03/W05/K handoffs;
- all of `lsa-shared-brain/src`;
- the e1 memory, integration, turn-runner, bootstrap and transport modules;
- the native memory authority, protagonist source, host context, intelligence integration and csproj;
- content-level containment of PRs #98–#130 in #131, and the overlap with the ElevenLabs line (#118);
- all 20 files of PR #132, its CI logs, and the base CI for comparison.
